import { useEffect, useState } from 'react'
import { AttendanceExportView } from './AttendanceExportView'
import { AttendanceRecordView } from './AttendanceRecordView'
import { db } from './firebase/config'
import {
  addCourseTeacher,
  createCourse,
  listMyCourses,
  removeCourseTeacher,
  updateQrExpirySeconds,
  type Course,
} from './firebase/coursesService'
import { addRosterStudent, importRoster, listRoster, removeRosterStudent } from './firebase/rosterService'
import { getCurrentSessionId } from './firebase/sessionsService'
import { ProjectionView } from './ProjectionView'
import { describeError } from './errors'

interface CourseManagerProps {
  teacherEmail: string
}

export function CourseManager({ teacherEmail }: CourseManagerProps) {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refreshCourses() {
    setCourses(await listMyCourses(db, teacherEmail))
  }

  useEffect(() => {
    refreshCourses().catch((err) => setError(describeError(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherEmail])

  async function handleCreateCourse() {
    const name = window.prompt('請輸入課程名稱')
    if (!name || !name.trim() || isCreating) return
    setError(null)
    setIsCreating(true)
    try {
      const courseId = await createCourse(db, teacherEmail, name.trim())
      await refreshCourses()
      setSelectedCourseId(courseId)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setIsCreating(false)
    }
  }

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null

  return (
    <>
      <section className="card">
        <h2>我的課程</h2>
        <ul className="list">
          {courses.map((course) => (
            <li key={course.id}>
              <button
                type="button"
                className="list-item--button"
                onClick={() => setSelectedCourseId(course.id)}
              >
                {course.name}
              </button>
            </li>
          ))}
        </ul>

        <button type="button" className="btn btn-primary" disabled={isCreating} onClick={handleCreateCourse}>
          {isCreating ? '建立中…' : '建立課程'}
        </button>

        {error && (
          <p role="alert" className="status-message status-message--error">
            {error}
          </p>
        )}
      </section>

      {selectedCourse && (
        <CourseSettings
          key={selectedCourse.id}
          course={selectedCourse}
          teacherEmail={teacherEmail}
          onChanged={refreshCourses}
        />
      )}
    </>
  )
}

interface CourseSettingsProps {
  course: Course
  teacherEmail: string
  onChanged: () => Promise<void>
}

function CourseSettings({ course, teacherEmail, onChanged }: CourseSettingsProps) {
  const [newTeacherEmail, setNewTeacherEmail] = useState('')
  const [qrExpirySeconds, setQrExpirySeconds] = useState(course.qrExpirySeconds)
  const [lastSeenQrExpirySeconds, setLastSeenQrExpirySeconds] = useState(course.qrExpirySeconds)
  const [error, setError] = useState<string | null>(null)
  const [isProjecting, setIsProjecting] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [isManagingAttendance, setIsManagingAttendance] = useState(false)
  const [isEditingSettings, setIsEditingSettings] = useState(false)

  useEffect(() => {
    let cancelled = false
    getCurrentSessionId(db, course.id)
      .then((sessionId) => {
        if (!cancelled) setCurrentSessionId(sessionId)
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err))
      })
    return () => {
      cancelled = true
    }
  }, [course.id])

  // Adjust local draft state when the underlying course document changes
  // (e.g. another teacher edited it), without discarding an in-progress
  // edit on every unrelated re-render. See the React docs on adjusting
  // state during render instead of an effect.
  if (course.qrExpirySeconds !== lastSeenQrExpirySeconds) {
    setLastSeenQrExpirySeconds(course.qrExpirySeconds)
    setQrExpirySeconds(course.qrExpirySeconds)
  }

  async function handleAddTeacher(event: React.FormEvent) {
    event.preventDefault()
    if (!newTeacherEmail.trim()) return
    setError(null)
    try {
      await addCourseTeacher(db, course.id, newTeacherEmail.trim())
      setNewTeacherEmail('')
      await onChanged()
    } catch (err) {
      setError(describeError(err))
    }
  }

  async function handleRemoveTeacher(email: string) {
    setError(null)
    try {
      await removeCourseTeacher(db, course.id, email)
      await onChanged()
    } catch (err) {
      setError(describeError(err))
    }
  }

  async function handleSaveQrExpirySeconds(event: React.FormEvent) {
    event.preventDefault()
    if (!Number.isInteger(qrExpirySeconds) || qrExpirySeconds <= 0) {
      setError('QR 過期秒數必須是正整數')
      return
    }
    setError(null)
    try {
      await updateQrExpirySeconds(db, course.id, qrExpirySeconds)
      await onChanged()
    } catch (err) {
      setError(describeError(err))
    }
  }

  const isLastTeacher = course.teacherEmails.length <= 1

  if (isProjecting) {
    return (
      <ProjectionView
        courseId={course.id}
        courseName={course.name}
        teacherEmail={teacherEmail}
        onClose={(sessionId) => {
          setIsProjecting(false)
          // Only overwrite on a genuine new/resumed session — if the
          // projection view closed before startOrResumeSession ever
          // resolved (e.g. an error), sessionId is null here and
          // shouldn't clobber a session this course already had.
          if (sessionId !== null) setCurrentSessionId(sessionId)
        }}
      />
    )
  }

  if (isManagingAttendance && currentSessionId) {
    return (
      <AttendanceRecordView
        courseId={course.id}
        sessionId={currentSessionId}
        onClose={() => setIsManagingAttendance(false)}
      />
    )
  }

  if (isEditingSettings) {
    return (
      <section className="card">
        <h3>{course.name} 設定</h3>
        <button type="button" className="btn btn-secondary" onClick={() => setIsEditingSettings(false)}>
          關閉
        </button>

        {error && (
          <p role="alert" className="status-message status-message--error">
            {error}
          </p>
        )}

        <div className="settings-grid">
          <div className="panel">
            <h4>共同授課教師</h4>
            <ul className="list">
              {course.teacherEmails.map((email) => (
                <li key={email} className="list-item">
                  <span>{email}</span>
                  <button
                    type="button"
                    className="btn btn-destructive btn-sm"
                    disabled={isLastTeacher}
                    title={isLastTeacher ? '課程至少要保留一位教師' : undefined}
                    onClick={() => handleRemoveTeacher(email)}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
            <form onSubmit={handleAddTeacher}>
              <label>
                新增共同授課教師 email
                <input
                  value={newTeacherEmail}
                  onChange={(event) => setNewTeacherEmail(event.target.value)}
                />
              </label>
              <button type="submit" className="btn btn-primary">
                新增
              </button>
            </form>
          </div>

          <div className="panel">
            <h4>QR 過期秒數</h4>
            <form onSubmit={handleSaveQrExpirySeconds}>
              <label>
                QR 過期秒數
                <input
                  type="number"
                  min={1}
                  value={qrExpirySeconds}
                  onChange={(event) => setQrExpirySeconds(Number(event.target.value))}
                />
              </label>
              <button type="submit" className="btn btn-primary">
                儲存
              </button>
            </form>
          </div>

          <RosterManager courseId={course.id} />
          <AttendanceExportView courseId={course.id} courseName={course.name} />
        </div>
      </section>
    )
  }

  return (
    <section className="card">
      <h3>{course.name} 設定</h3>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <button type="button" className="btn btn-primary" onClick={() => setIsProjecting(true)}>
          開始點名
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!currentSessionId}
          title={currentSessionId ? undefined : '尚未開始過點名'}
          onClick={() => setIsManagingAttendance(true)}
        >
          管理出席紀錄
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setIsEditingSettings(true)}>
          設定
        </button>
      </div>

      {error && (
        <p role="alert" className="status-message status-message--error">
          {error}
        </p>
      )}
    </section>
  )
}

interface RosterManagerProps {
  courseId: string
}

function RosterManager({ courseId }: RosterManagerProps) {
  const [roster, setRoster] = useState<string[]>([])
  const [pasteText, setPasteText] = useState('')
  const [newStudentEmail, setNewStudentEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function refreshRoster() {
    setRoster(await listRoster(db, courseId))
  }

  useEffect(() => {
    refreshRoster().catch((err) => setError(describeError(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  async function handleImport(event: React.FormEvent) {
    event.preventDefault()
    if (!pasteText.trim()) return
    setError(null)
    try {
      await importRoster(db, courseId, pasteText)
      setPasteText('')
      await refreshRoster()
    } catch (err) {
      setError(describeError(err))
    }
  }

  async function handleAddStudent(event: React.FormEvent) {
    event.preventDefault()
    if (!newStudentEmail.trim()) return
    setError(null)
    try {
      await addRosterStudent(db, courseId, newStudentEmail.trim())
      setNewStudentEmail('')
      await refreshRoster()
    } catch (err) {
      setError(describeError(err))
    }
  }

  async function handleRemoveStudent(email: string) {
    setError(null)
    try {
      await removeRosterStudent(db, courseId, email)
      await refreshRoster()
    } catch (err) {
      setError(describeError(err))
    }
  }

  return (
    <div className="panel">
      <h4>選課名單</h4>
      <ul className="list list--scroll">
        {roster.map((email) => (
          <li key={email} className="list-item">
            <span>{email}</span>
            <button type="button" className="btn btn-destructive btn-sm" onClick={() => handleRemoveStudent(email)}>
              移除
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleAddStudent}>
        <label>
          新增學生 email
          <input
            value={newStudentEmail}
            onChange={(event) => setNewStudentEmail(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary">
          新增
        </button>
      </form>

      <form onSubmit={handleImport}>
        <label>
          貼上選課名單（每行一個 email）
          <textarea
            rows={4}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary">
          批次匯入
        </button>
      </form>

      {error && (
        <p role="alert" className="status-message status-message--error">
          {error}
        </p>
      )}
    </div>
  )
}
