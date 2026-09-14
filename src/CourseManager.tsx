import { useEffect, useRef, useState } from 'react'
import { AttendanceExportView } from './AttendanceExportView'
import { AttendanceRecordView } from './AttendanceRecordView'
import { db } from './firebase/config'
import {
  addCourseTeacher,
  DEFAULT_CUSTOM_STATUSES,
  removeCourseTeacher,
  updateCustomStatuses,
  updateQrExpirySeconds,
  type Course,
} from './firebase/coursesService'
import { addRosterStudent, importRoster, listRoster, removeRosterStudent } from './firebase/rosterService'
import { ProjectionView } from './ProjectionView'
import { describeError } from './errors'

export interface CourseMenuProps {
  courses: Course[]
  onSelect: (courseId: string) => void
  onCreateClick: () => void
}

export function CourseMenu({ courses, onSelect, onCreateClick }: CourseMenuProps) {
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

export interface CreateCourseDialogProps {
  isCreating: boolean
  onCreate: (name: string) => void
  onCancel: () => void
}

export function CreateCourseDialog({ isCreating, onCreate, onCancel }: CreateCourseDialogProps) {
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

export interface CourseSettingsProps {
  course: Course
  teacherEmail: string
  onChanged: () => Promise<void>
  // Notified whenever this course enters/leaves 投影 mode, so App.tsx
  // can hide the navbar/toolbar while it's projected on a classroom
  // screen. Reset to false on unmount too (see the effect below) so
  // switching courses or navigating away never leaves the chrome
  // stuck hidden.
  onProjectingChange: (isProjecting: boolean) => void
}

export function CourseSettings({ course, teacherEmail, onChanged, onProjectingChange }: CourseSettingsProps) {
  const [newTeacherEmail, setNewTeacherEmail] = useState('')
  const [qrExpirySeconds, setQrExpirySeconds] = useState(course.qrExpirySeconds)
  const [lastSeenQrExpirySeconds, setLastSeenQrExpirySeconds] = useState(course.qrExpirySeconds)
  const [error, setError] = useState<string | null>(null)
  const [isProjecting, setIsProjecting] = useState(false)
  const [isManagingAttendance, setIsManagingAttendance] = useState(false)
  const [isEditingSettings, setIsEditingSettings] = useState(false)

  useEffect(() => {
    onProjectingChange(isProjecting)
    return () => onProjectingChange(false)
  }, [isProjecting, onProjectingChange])

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
        qrExpirySeconds={course.qrExpirySeconds}
        onClose={() => setIsProjecting(false)}
      />
    )
  }

  if (isManagingAttendance) {
    return (
      <AttendanceRecordView
        courseId={course.id}
        customStatuses={course.customStatuses ?? DEFAULT_CUSTOM_STATUSES}
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

          <StatusOptionsManager
            courseId={course.id}
            customStatuses={course.customStatuses ?? DEFAULT_CUSTOM_STATUSES}
            onChanged={onChanged}
          />

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
          出席紀錄
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setIsEditingSettings(true)}>
          課程設定
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

interface StatusOptionsManagerProps {
  courseId: string
  customStatuses: string[]
  onChanged: () => Promise<void>
}

// 出席/缺席 are fixed system statuses (see isValidAttendanceStatus in
// firestore.rules) and never appear here — this only manages the
// extra options a teacher can freely rename, add to, or remove.
function StatusOptionsManager({ courseId, customStatuses, onChanged }: StatusOptionsManagerProps) {
  const [draft, setDraft] = useState(customStatuses)
  const [lastSeenCustomStatuses, setLastSeenCustomStatuses] = useState(customStatuses)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Adjust local draft state when the underlying course document changes
  // (e.g. another teacher edited it), without discarding an in-progress
  // edit on every unrelated re-render — mirrors CourseSettings'
  // qrExpirySeconds handling above.
  if (customStatuses !== lastSeenCustomStatuses) {
    setLastSeenCustomStatuses(customStatuses)
    setDraft(customStatuses)
  }

  function updateDraftItem(index: number, value: string) {
    setDraft((current) => current.map((item, i) => (i === index ? value : item)))
  }

  function removeDraftItem(index: number) {
    setDraft((current) => current.filter((_, i) => i !== index))
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    const cleaned = draft.map((item) => item.trim()).filter((item) => item.length > 0)
    setError(null)
    setIsSaving(true)
    try {
      await updateCustomStatuses(db, courseId, cleaned)
      setDraft(cleaned)
      await onChanged()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="panel">
      <h4>出席狀態選項</h4>
      <p style={{ marginTop: 0, fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>
        「出席」與「缺席」由系統自動記錄，無法修改。
      </p>

      <form onSubmit={handleSave}>
        <ul className="list">
          {draft.map((status, index) => (
            <li key={index} className="list-item">
              <input value={status} onChange={(event) => updateDraftItem(index, event.target.value)} />
              <button
                type="button"
                className="btn btn-destructive btn-sm"
                onClick={() => removeDraftItem(index)}
              >
                移除
              </button>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setDraft((current) => [...current, ''])}>
            新增狀態
          </button>
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="status-message status-message--error">
          {error}
        </p>
      )}
    </div>
  )
}

interface RosterManagerProps {
  courseId: string
}

function RosterManager({ courseId }: RosterManagerProps) {
  const [roster, setRoster] = useState<{ email: string; name: string }[]>([])
  const [isManaging, setIsManaging] = useState(false)
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

      <button type="button" className="btn btn-secondary" onClick={() => setIsManaging(true)}>
        管理名單（{roster.length} 位學生）
      </button>

      {isManaging && (
        <RosterListDialog
          roster={roster}
          onRemove={handleRemoveStudent}
          onClose={() => setIsManaging(false)}
        />
      )}

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

interface RosterListDialogProps {
  roster: { email: string; name: string }[]
  onRemove: (email: string) => void
  onClose: () => void
}

// 新增學生/批次匯入 deliberately stay in the panel behind this dialog,
// not inside it — this only handles viewing/removing the existing
// list.
function RosterListDialog({ roster, onRemove, onClose }: RosterListDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose}>
      <h3>選課名單</h3>
      <ul className="list list--scroll">
        {roster.map((entry) => (
          <li key={entry.email} className="list-item">
            <span>{entry.name ? `${entry.name}（${entry.email}）` : entry.email}</span>
            <button type="button" className="btn btn-destructive btn-sm" onClick={() => onRemove(entry.email)}>
              移除
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-secondary" onClick={() => dialogRef.current?.close()}>
        關閉
      </button>
    </dialog>
  )
}
