// @vitest-environment node
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { addCourseTeacher, createCourse, listMyCourses, removeCourseTeacher, updateQrExpirySeconds } from './coursesService'

const TEACHER = 'teacher@example.com'
const OTHER_TEACHER = 'other-teacher@example.com'
const NON_WHITELISTED = 'stranger@example.com'
const STUDENT = 'student@example.com'

describe('coursesService (against Firestore rules via emulator)', () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'signin-online-courses-rules-test',
      firestore: {
        rules: readFileSync('firestore.rules', 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    })
  })

  afterEach(async () => {
    await testEnv.clearFirestore()
  })

  afterAll(async () => {
    await testEnv.cleanup()
  })

  function dbAs(email: string): Firestore {
    return testEnv.authenticatedContext(email, { email }).firestore() as unknown as Firestore
  }

  async function seedTeachers(...emails: string[]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await Promise.all(emails.map((email) => setDoc(doc(db, 'teachers', email), {})))
    })
  }

  async function seedCourse(courseId: string, teacherEmails: string[], qrExpirySeconds = 25) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await setDoc(doc(db, 'courses', courseId), {
        name: '測試課程',
        teacherEmails,
        qrExpirySeconds,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        createdBy: teacherEmails[0],
      })
    })
  }

  it('lets a whitelisted teacher create a course and see it in their course list', async () => {
    await seedTeachers(TEACHER)
    const db = dbAs(TEACHER)

    const courseId = await assertSucceeds(createCourse(db, TEACHER, '資料結構'))

    const courses = await listMyCourses(db, TEACHER)
    expect(courses).toEqual([
      expect.objectContaining({ id: courseId, name: '資料結構', teacherEmails: [TEACHER], qrExpirySeconds: 25 }),
    ])
  })

  it('denies a non-whitelisted user from creating a course', async () => {
    const db = dbAs(NON_WHITELISTED)

    await assertFails(createCourse(db, NON_WHITELISTED, '資料結構'))
  })

  it('denies creating a course whose teacherEmails is not just the creator (bypassing the service layer)', async () => {
    await seedTeachers(TEACHER, OTHER_TEACHER)
    const db = dbAs(TEACHER)

    await assertFails(
      setDoc(doc(db, 'courses', 'course-1'), {
        name: '資料結構',
        teacherEmails: [TEACHER, OTHER_TEACHER],
        qrExpirySeconds: 25,
      }),
    )
  })

  it('lets a course teacher add a whitelisted co-teacher', async () => {
    await seedTeachers(TEACHER, OTHER_TEACHER)
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)

    await assertSucceeds(addCourseTeacher(db, 'course-1', OTHER_TEACHER))
  })

  it('denies adding a co-teacher who is not in the global whitelist', async () => {
    await seedTeachers(TEACHER)
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)

    await assertFails(addCourseTeacher(db, 'course-1', NON_WHITELISTED))
  })

  it('denies a non-course-teacher from modifying the course', async () => {
    await seedTeachers(TEACHER, OTHER_TEACHER)
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(OTHER_TEACHER)

    await assertFails(updateQrExpirySeconds(db, 'course-1', 30))
  })

  it('lets a course teacher remove a co-teacher', async () => {
    await seedTeachers(TEACHER, OTHER_TEACHER)
    await seedCourse('course-1', [TEACHER, OTHER_TEACHER])
    const db = dbAs(TEACHER)

    await assertSucceeds(removeCourseTeacher(db, 'course-1', OTHER_TEACHER))
  })

  it('lets a course teacher change qrExpirySeconds', async () => {
    await seedTeachers(TEACHER)
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)

    await assertSucceeds(updateQrExpirySeconds(db, 'course-1', 40))
  })

  it('lets a course teacher read their course but denies a non-teacher from reading it', async () => {
    await seedTeachers(TEACHER)
    await seedCourse('course-1', [TEACHER])

    await assertSucceeds(getDoc(doc(dbAs(TEACHER), 'courses', 'course-1')))
    await assertFails(getDoc(doc(dbAs(STUDENT), 'courses', 'course-1')))
  })

  it('denies clearing teacherEmails to empty (would permanently orphan the course)', async () => {
    await seedTeachers(TEACHER)
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)

    await assertFails(removeCourseTeacher(db, 'course-1', TEACHER))
  })

  it('denies changing immutable fields (name, createdBy, createdAt) via update', async () => {
    await seedTeachers(TEACHER)
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)

    await assertFails(updateDoc(doc(db, 'courses', 'course-1'), { name: '改名' }))
  })

  it('denies setting qrExpirySeconds to a non-positive value', async () => {
    await seedTeachers(TEACHER)
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)

    await assertFails(updateQrExpirySeconds(db, 'course-1', 0))
    await assertFails(updateQrExpirySeconds(db, 'course-1', -5))
  })
})
