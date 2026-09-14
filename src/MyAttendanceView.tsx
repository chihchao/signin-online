import { useEffect, useState } from 'react'
import { statusLabel, statusVariant } from './attendanceStatusLabels'
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

interface CourseGroup {
  courseId: string
  courseName: string
  records: DisplayRecord[]
}

// records is already sorted newest-first, so grouping by first
// appearance naturally orders courses by their most recent activity.
function groupByCourse(records: DisplayRecord[]): CourseGroup[] {
  const groups = new Map<string, CourseGroup>()
  for (const record of records) {
    const existing = groups.get(record.courseId)
    if (existing) {
      existing.records.push(record)
    } else {
      groups.set(record.courseId, { courseId: record.courseId, courseName: record.courseName, records: [record] })
    }
  }
  return [...groups.values()]
}

export function MyAttendanceView({ studentEmail }: MyAttendanceViewProps) {
  const [records, setRecords] = useState<DisplayRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expandedCourseIds, setExpandedCourseIds] = useState<Set<string>>(new Set())

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

  function toggleCourse(courseId: string) {
    setExpandedCourseIds((current) => {
      const next = new Set(current)
      if (next.has(courseId)) {
        next.delete(courseId)
      } else {
        next.add(courseId)
      }
      return next
    })
  }

  const groups = groupByCourse(records)

  return (
    <section className="card">
      <h2>我的出席紀錄</h2>

      {error && (
        <p role="alert" className="status-message status-message--error">
          {error}
        </p>
      )}

      <ul className="list">
        {groups.map((group) => {
          const isExpanded = expandedCourseIds.has(group.courseId)
          return (
            <li key={group.courseId} className="accordion-item">
              <button
                type="button"
                className="accordion-trigger"
                aria-expanded={isExpanded}
                onClick={() => toggleCourse(group.courseId)}
              >
                <span>{group.courseName}</span>
                <span className="accordion-icon" aria-hidden="true">
                  {isExpanded ? '−' : '+'}
                </span>
              </button>
              {isExpanded && (
                <ul className="list accordion-panel">
                  {group.records.map((record) => (
                    <li key={record.sessionId} className="list-item">
                      <span>{formatDate(record.timestamp)}</span>
                      <span className={`badge badge--${statusVariant(record.status)}`}>
                        {statusLabel(record.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
