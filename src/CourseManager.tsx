import { useEffect, useState } from 'react'
import { db } from './firebase/config'
import {
  addCourseTeacher,
  createCourse,
  listMyCourses,
  removeCourseTeacher,
  updateQrExpirySeconds,
  type Course,
} from './firebase/coursesService'

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface CourseManagerProps {
  teacherEmail: string
}

export function CourseManager({ teacherEmail }: CourseManagerProps) {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [newCourseName, setNewCourseName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refreshCourses() {
    setCourses(await listMyCourses(db, teacherEmail))
  }

  useEffect(() => {
    refreshCourses().catch((err) => setError(describeError(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherEmail])

  async function handleCreateCourse(event: React.FormEvent) {
    event.preventDefault()
    if (!newCourseName.trim() || isCreating) return
    setError(null)
    setIsCreating(true)
    try {
      await createCourse(db, teacherEmail, newCourseName.trim())
      setNewCourseName('')
      await refreshCourses()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setIsCreating(false)
    }
  }

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null

  return (
    <section>
      <h2>我的課程</h2>
      <ul>
        {courses.map((course) => (
          <li key={course.id}>
            <button type="button" onClick={() => setSelectedCourseId(course.id)}>
              {course.name}
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreateCourse}>
        <label>
          課程名稱
          <input
            value={newCourseName}
            disabled={isCreating}
            onChange={(event) => setNewCourseName(event.target.value)}
          />
        </label>
        <button type="submit" disabled={isCreating}>
          建立課程
        </button>
      </form>

      {error && <p role="alert">{error}</p>}

      {selectedCourse && (
        <CourseSettings
          key={selectedCourse.id}
          course={selectedCourse}
          onChanged={refreshCourses}
        />
      )}
    </section>
  )
}

interface CourseSettingsProps {
  course: Course
  onChanged: () => Promise<void>
}

function CourseSettings({ course, onChanged }: CourseSettingsProps) {
  const [newTeacherEmail, setNewTeacherEmail] = useState('')
  const [qrExpirySeconds, setQrExpirySeconds] = useState(course.qrExpirySeconds)
  const [lastSeenQrExpirySeconds, setLastSeenQrExpirySeconds] = useState(course.qrExpirySeconds)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <section>
      <h3>{course.name} 設定</h3>

      <h4>共同授課教師</h4>
      <ul>
        {course.teacherEmails.map((email) => (
          <li key={email}>
            {email}
            <button
              type="button"
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
        <button type="submit">新增</button>
      </form>

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
        <button type="submit">儲存</button>
      </form>

      {error && <p role="alert">{error}</p>}
    </section>
  )
}
