import { useEffect, useState } from 'react'
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

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: '出席',
  leave: '請假',
  'official-leave': '公假',
  exempt: '免簽',
  absent: '缺席',
}

const ALL_STATUSES = Object.keys(STATUS_LABELS) as AttendanceStatus[]

interface RosterRow {
  email: string
  status: AttendanceStatus | null
}

interface AttendanceRecordViewProps {
  courseId: string
  sessionId: string
  onClose: () => void
}

export function AttendanceRecordView({ courseId, sessionId, onClose }: AttendanceRecordViewProps) {
  const [rows, setRows] = useState<RosterRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyEmail, setBusyEmail] = useState<string | null>(null)

  async function refresh() {
    const [emails, records] = await Promise.all([
      listRoster(db, courseId),
      listAttendanceForSession(db, courseId, sessionId),
    ])
    const statusByEmail = new Map(records.map((record) => [record.studentEmail, record.status]))
    setRows(emails.map((email) => ({ email, status: statusByEmail.get(email) ?? null })))
  }

  useEffect(() => {
    refresh().catch((err) => setError(describeError(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, sessionId])

  async function handleStatusChange(row: RosterRow, status: AttendanceStatus) {
    setError(null)
    setBusyEmail(row.email)
    try {
      if (row.status === null) {
        await addAttendanceRecord(db, sessionId, courseId, row.email, status)
      } else {
        await updateAttendanceStatus(db, sessionId, row.email, status)
      }
      await refresh()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusyEmail(null)
    }
  }

  async function handleDelete(row: RosterRow) {
    if (!window.confirm(`確定要刪除 ${row.email} 的出席紀錄嗎？`)) return
    setError(null)
    setBusyEmail(row.email)
    try {
      await deleteAttendanceRecord(db, sessionId, row.email)
      await refresh()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusyEmail(null)
    }
  }

  return (
    <section>
      <h3>出席紀錄</h3>
      <button type="button" onClick={onClose}>
        關閉
      </button>

      {error && <p role="alert">{error}</p>}

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
                  <button type="button" disabled={busyEmail === row.email} onClick={() => handleDelete(row)}>
                    刪除
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
