import { useEffect, useState } from 'react'
import { ALL_STATUSES, STATUS_LABELS } from './attendanceStatusLabels'
import { formatDate } from './dateFormat'
import { describeError } from './errors'
import { db } from './firebase/config'
import {
  addAttendanceRecord,
  deleteAttendanceRecord,
  listAttendanceForSession,
  updateAttendanceStatus,
  type AttendanceStatus,
} from './firebase/attendanceService'
import { listRoster } from './firebase/rosterService'
import { listSessionsForCourse, type SessionSummary } from './firebase/sessionsService'

interface RosterRow {
  email: string
  status: AttendanceStatus | null
}

interface AttendanceRecordViewProps {
  courseId: string
  onClose: () => void
}

function sessionLabel(session: SessionSummary): string {
  const date = formatDate(session.createdAt)
  return session.endedAt === null ? `${date}（進行中）` : date
}

// Owns its own session list (rather than taking a sessionId prop) so
// every entry point — course settings, a live projection — shows the
// same history and picks the same "most recent" default, with no
// separate "what's the current session" state for a caller to keep in
// sync (that used to be a real race: see git history for
// getCurrentSessionId).
export function AttendanceRecordView({ courseId, onClose }: AttendanceRecordViewProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [rows, setRows] = useState<RosterRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyEmail, setBusyEmail] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listSessionsForCourse(db, courseId)
      .then((result) => {
        if (cancelled) return
        setSessions(result)
        setSelectedSessionId((current) => current ?? result[0]?.id ?? null)
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err))
      })
    return () => {
      cancelled = true
    }
  }, [courseId])

  // isStale lets the effect below discard a response that lands after
  // a newer one was already kicked off (e.g. the teacher flips through
  // the session picker faster than each fetch resolves) — without it,
  // an out-of-order response could overwrite the table with the wrong
  // session's data.
  async function refresh(isStale: () => boolean = () => false) {
    if (selectedSessionId === null) {
      setRows([])
      return
    }
    const [emails, records] = await Promise.all([
      listRoster(db, courseId),
      listAttendanceForSession(db, courseId, selectedSessionId),
    ])
    if (isStale()) return
    const statusByEmail = new Map(records.map((record) => [record.studentEmail, record.status]))
    setRows(emails.map((email) => ({ email, status: statusByEmail.get(email) ?? null })))
  }

  useEffect(() => {
    let cancelled = false
    refresh(() => cancelled).catch((err) => {
      if (!cancelled) setError(describeError(err))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, selectedSessionId])

  async function handleStatusChange(row: RosterRow, status: AttendanceStatus) {
    if (selectedSessionId === null) return
    setError(null)
    setBusyEmail(row.email)
    try {
      if (row.status === null) {
        await addAttendanceRecord(db, selectedSessionId, courseId, row.email, status)
      } else {
        await updateAttendanceStatus(db, selectedSessionId, row.email, status)
      }
      await refresh()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusyEmail(null)
    }
  }

  async function handleDelete(row: RosterRow) {
    if (selectedSessionId === null) return
    if (!window.confirm(`確定要刪除 ${row.email} 的出席紀錄嗎？`)) return
    setError(null)
    setBusyEmail(row.email)
    try {
      await deleteAttendanceRecord(db, selectedSessionId, row.email)
      await refresh()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusyEmail(null)
    }
  }

  return (
    <section className="card">
      <h3>出席紀錄</h3>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          關閉
        </button>
        {sessions.length > 1 && (
          <label style={{ width: 'auto' }}>
            查看場次
            <select
              value={selectedSessionId ?? ''}
              onChange={(event) => setSelectedSessionId(event.target.value)}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {sessionLabel(session)}
                </option>
              ))}
            </select>
          </label>
        )}
        {sessions.length === 1 && (
          <span style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>
            {sessionLabel(sessions[0])}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="status-message status-message--error">
          {error}
        </p>
      )}

      {sessions.length === 0 ? (
        <p className="status-message status-message--info" style={{ marginTop: 'var(--space-4)' }}>
          這門課尚未開始過點名
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 'var(--space-4)' }}>
          <table>
            <thead>
              <tr>
                <th>學生</th>
                <th>狀態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.email}>
                  <td>{row.email}</td>
                  <td>
                    <select
                      value={row.status ?? ''}
                      disabled={busyEmail === row.email}
                      onChange={(event) => handleStatusChange(row, event.target.value as AttendanceStatus)}
                    >
                      {row.status === null && <option value="">未簽到</option>}
                      {ALL_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {row.status !== null && (
                      <button
                        type="button"
                        className="btn btn-destructive btn-sm"
                        disabled={busyEmail === row.email}
                        onClick={() => handleDelete(row)}
                      >
                        刪除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
