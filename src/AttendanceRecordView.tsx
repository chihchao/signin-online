import { useEffect, useState } from 'react'
import { orderedStatusOptions, statusLabel } from './attendanceStatusLabels'
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
  name: string
  status: AttendanceStatus | null
}

interface AttendanceRecordViewProps {
  courseId: string
  customStatuses: string[]
  onClose: () => void
}

// Sessions sharing the same calendar date (e.g. a morning and an
// afternoon 點名, or a live session plus a 補登 import for that day)
// would otherwise render with an identical label — this assigns each a
// 1-based "第 N 堂" ordinal, oldest first, but only among dates that
// actually have more than one session; a lone session that day keeps
// the plain date label unchanged.
function dailyOrdinals(sessions: SessionSummary[]): Map<string, number> {
  const byDate = new Map<string, SessionSummary[]>()
  for (const session of sessions) {
    const dateKey = formatDate(session.createdAt)
    const group = byDate.get(dateKey)
    if (group) {
      group.push(session)
    } else {
      byDate.set(dateKey, [session])
    }
  }
  const ordinals = new Map<string, number>()
  for (const group of byDate.values()) {
    if (group.length <= 1) continue
    const sorted = [...group].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
    sorted.forEach((session, index) => ordinals.set(session.id, index + 1))
  }
  return ordinals
}

function sessionLabel(session: SessionSummary, ordinal?: number): string {
  const date = formatDate(session.createdAt)
  const base = ordinal === undefined ? date : `${date} 第 ${ordinal} 堂`
  if (session.endedAt === null) return `${base}（進行中）`
  if (session.source === 'import') return `${base}（補登）`
  return base
}

// Owns its own session list (rather than taking a sessionId prop) so
// every entry point — course settings, a live projection — shows the
// same history and picks the same "most recent" default, with no
// separate "what's the current session" state for a caller to keep in
// sync (that used to be a real race: see git history for
// getCurrentSessionId).
export function AttendanceRecordView({ courseId, customStatuses, onClose }: AttendanceRecordViewProps) {
  const statusOptions = orderedStatusOptions(customStatuses)
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
    const [roster, records] = await Promise.all([
      listRoster(db, courseId),
      listAttendanceForSession(db, courseId, selectedSessionId),
    ])
    if (isStale()) return
    const statusByEmail = new Map(records.map((record) => [record.studentEmail, record.status]))
    setRows(
      roster.map((entry) => ({
        email: entry.email,
        name: entry.name,
        status: statusByEmail.get(entry.email) ?? null,
      })),
    )
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
        // Backdate a fresh 補登 to the session's own date once that
        // session has ended — otherwise (still 進行中) "now" is a real
        // class moment and addAttendanceRecord's default is correct.
        const selectedSession = sessions.find((session) => session.id === selectedSessionId)
        const backdateTo =
          selectedSession && selectedSession.endedAt !== null ? selectedSession.createdAt : null
        await addAttendanceRecord(db, selectedSessionId, courseId, row.email, status, backdateTo ?? undefined)
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

  const ordinals = dailyOrdinals(sessions)

  return (
    <section className="card">
      <h3>出席紀錄</h3>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          關閉
        </button>
        {sessions.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <label htmlFor="session-select" style={{ width: 'auto', margin: 0 }}>
              查看場次
            </label>
            <select
              id="session-select"
              value={selectedSessionId ?? ''}
              onChange={(event) => setSelectedSessionId(event.target.value)}
              style={{ marginTop: 0 }}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {sessionLabel(session, ordinals.get(session.id))}
                </option>
              ))}
            </select>
          </div>
        )}
        {sessions.length === 1 && (
          <span style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>
            {sessionLabel(sessions[0], ordinals.get(sessions[0].id))}
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
                <th>姓名</th>
                <th>狀態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.email}>
                  <td>{row.email}</td>
                  <td>{row.name}</td>
                  <td>
                    <select
                      value={row.status ?? ''}
                      disabled={busyEmail === row.email}
                      onChange={(event) => handleStatusChange(row, event.target.value as AttendanceStatus)}
                    >
                      {row.status === null && <option value="">未簽到</option>}
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {statusLabel(status)}
                        </option>
                      ))}
                      {/* A record's status can predate the course's current
                          customStatuses (a legacy status, or one since
                          renamed/removed in 課程設定) — without its own
                          <option>, the <select> would silently fall back to
                          showing a different status than what's stored. */}
                      {row.status !== null && !statusOptions.includes(row.status) && (
                        <option value={row.status}>{statusLabel(row.status)}</option>
                      )}
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
