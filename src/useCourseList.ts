import { useEffect, useState } from 'react'
import { describeError } from './errors'
import { db } from './firebase/config'
import { createCourse, listMyCourses, type Course } from './firebase/coursesService'

// Owns the teacher's course list + which one is selected. Lifted out
// of a single CourseManager component (rather than owned locally by
// it) so App.tsx can render the course-picker trigger (CourseMenu) in
// the same toolbar row as the 我的出席紀錄 toggle, while CourseSettings
// still renders as its own full-width block below — both need the
// same course-list state, so it has exactly one owner instead of two
// independent fetches that could drift.
export function useCourseList(teacherEmail: string) {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refreshCourses() {
    if (!teacherEmail) return
    setCourses(await listMyCourses(db, teacherEmail))
  }

  useEffect(() => {
    refreshCourses().catch((err) => setError(describeError(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherEmail])

  async function handleCreateCourse(name: string): Promise<boolean> {
    setError(null)
    setIsCreating(true)
    try {
      const courseId = await createCourse(db, teacherEmail, name)
      await refreshCourses()
      setSelectedCourseId(courseId)
      return true
    } catch (err) {
      setError(describeError(err))
      return false
    } finally {
      setIsCreating(false)
    }
  }

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null

  return {
    courses,
    selectedCourse,
    setSelectedCourseId,
    isCreating,
    error,
    refreshCourses,
    handleCreateCourse,
  }
}
