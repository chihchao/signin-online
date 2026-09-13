import { useEffect, useState } from 'react'
import { STATUS_LABELS, STATUS_VARIANTS } from './attendanceStatusLabels'
import { formatDate } from './dateFormat'
import { describeError } from './errors'
import { db } from './firebase/config'
import { listAttendanceForStudent, type StudentAttendanceRecord } from './firebase/attendanceService'
import { getCourse } from './firebase/coursesService'

interface MyAttendanceViewProps {
  studentEmail: string
}

interface DisplayRecord extends StudentAttendanceRecord {
  courseName: string
}

export function MyAttendanceView({ studentEmail }: MyAttendanceViewProps) {
  const [records, setRecords] = useState<DisplayRecord[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const rawRecords = await listAttendanceForStudent(db, studentEmail)
      const courseIds = [...new Set(rawRecords.map((record) => record.courseId))]
      const courses = await Promise.all(courseIds.map((courseId) => getCourse(db, courseId)))
      const nameByCourseId = new Map(courseIds.map((courseId, index) => [courseId, courses[index]?.name ?? courseId]))

      const sorted = [...rawRecords].sort(
        (a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0),
      )
      if (!cancelled) {
        setRecords(
          sorted.map((record) => ({
            ...record,
            courseName: nameByCourseId.get(record.courseId) ?? record.courseId,
          })),
        )
      }
    }

    load().catch((err) => {
      if (!cancelled) setError(describeError(err))
    })

    return () => {
      cancelled = true
    }
  }, [studentEmail])

  return (
    <section className="card">
      <h2>我的出席紀錄</h2>

      {error && (
        <p role="alert" className="status-message status-message--error">
          {error}
        </p>
      )}

      <ul className="list">
        {records.map((record) => (
          <li key={record.sessionId} className="list-item">
            <div>
              <div>{record.courseName}</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-muted-foreground)' }}>
                {formatDate(record.timestamp)}
              </div>
            </div>
            <span className={`badge badge--${STATUS_VARIANTS[record.status]}`}>
              {STATUS_LABELS[record.status]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
