import { useEffect, useRef, useState } from 'react'
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
import { ProjectionView } from './ProjectionView'
import { describeError } from './errors'

interface CourseManagerProps {
  teacherEmail: string
}

export function CourseManager({ teacherEmail }: CourseManagerProps) {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refreshCourses() {
    setCourses(await listMyCourses(db, teacherEmail))
  }

  useEffect(() => {
    refreshCourses().catch((err) => setError(describeError(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherEmail])

  async function handleCreateCourse(name: string) {
    setError(null)
    setIsCreating(true)
    try {
      const courseId = await createCourse(db, teacherEmail, name)
      await refreshCourses()
      setSelectedCourseId(courseId)
      setIsCreateDialogOpen(false)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setIsCreating(false)
    }
  }

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
        <CourseMenu
          courses={courses}
          onSelect={setSelectedCourseId}
          onCreateClick={() => setIsCreateDialogOpen(true)}
        />
      </div>

      {error && (
        <p role="alert" className="status-message status-message--error">
          {error}
        </p>
      )}

      {isCreateDialogOpen && (
        <CreateCourseDialog
          isCreating={isCreating}
          onCreate={handleCreateCourse}
          onCancel={() => setIsCreateDialogOpen(false)}
        />
      )}

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

interface CourseMenuProps {
  courses: Course[]
  onSelect: (courseId: string) => void
  onCreateClick: () => void
}

function CourseMenu({ courses, onSelect, onCreateClick }: CourseMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div className="dropdown" ref={containerRef}>
      <button type="button" className="btn btn-secondary" onClick={() => setIsOpen((current) => !current)}>
        課程管理 ▾
      </button>
      {isOpen && (
        <div className="dropdown-panel">
          <ul className="list">
            {courses.map((course) => (
              <li key={course.id}>
                <button
                  type="button"
                  className="list-item--button"
                  onClick={() => {
                    onSelect(course.id)
                    setIsOpen(false)
                  }}
                >
                  {course.name}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              onCreateClick()
              setIsOpen(false)
            }}
          >
            建立課程
          </button>
        </div>
      )}
    </div>
  )
}

interface CreateCourseDialogProps {
  isCreating: boolean
  onCreate: (name: string) => void
  onCancel: () => void
}

function CreateCourseDialog({ isCreating, onCreate, onCancel }: CreateCourseDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || isCreating) return
    onCreate(name.trim())
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <h3>建立課程</h3>
        <label>
          課程名稱
          <input autoFocus value={name} disabled={isCreating} onChange={(event) => setName(event.target.value)} />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <button type="button" className="btn btn-secondary" onClick={() => dialogRef.current?.close()}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={isCreating}>
            {isCreating ? '建立中…' : '建立'}
          </button>
        </div>
      </form>
    </dialog>
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
  const [isManagingAttendance, setIsManagingAttendance] = useState(false)
  const [isEditingSettings, setIsEditingSettings] = useState(false)

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
        onClose={() => setIsProjecting(false)}
      />
    )
  }

  if (isManagingAttendance) {
    return <AttendanceRecordView courseId={course.id} onClose={() => setIsManagingAttendance(false)} />
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
        <button type="button" className="btn btn-secondary" onClick={() => setIsManagingAttendance(true)}>
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
  const [roster, setRoster] = useState<{ email: string; name: string }[]>([])
  const [pasteText, setPasteText] = useState('')
  const [newStudentEmail, setNewStudentEmail] = useState('')
  const [newStudentName, setNewStudentName] = useState('')
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
      await addRosterStudent(db, courseId, newStudentEmail.trim(), newStudentName.trim())
      setNewStudentEmail('')
      setNewStudentName('')
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
        {roster.map((entry) => (
          <li key={entry.email} className="list-item">
            <span>
              {entry.name ? `${entry.name}（${entry.email}）` : entry.email}
            </span>
            <button
              type="button"
              className="btn btn-destructive btn-sm"
              onClick={() => handleRemoveStudent(entry.email)}
            >
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
        <label>
          學生姓名
          <input
            value={newStudentName}
            onChange={(event) => setNewStudentName(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary">
          新增
        </button>
      </form>

      <form onSubmit={handleImport}>
        <label>
          貼上選課名單（每行「email,姓名」）
          <textarea
            rows={4}
            placeholder={'student1@example.com,王小明\nstudent2@example.com,陳小華'}
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
