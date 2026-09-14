// @vitest-environment node
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  addCourseTeacher,
  createCourse,
  DEFAULT_CUSTOM_STATUSES,
  deleteCourse,
  getCourse,
  listMyCourses,
  removeCourseTeacher,
  updateCustomStatuses,
  updateQrExpirySeconds,
} from './coursesService'

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

  it("lets an enrolled student fetch their course's name (needed by the self-check page, issue #9)", async () => {
    await seedTeachers(TEACHER)
    await seedCourse('course-1', [TEACHER])
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await setDoc(doc(db, 'courses', 'course-1', 'roster', STUDENT), {})
    })

    const course = await assertSucceeds(getCourse(dbAs(STUDENT), 'course-1'))
    expect(course).toEqual(expect.objectContaining({ id: 'course-1', name: '測試課程' }))
  })

  it("returns null (not a thrown error) for a course the student is no longer enrolled in — e.g. after they've been removed from the roster but still have an old attendance record pointing at it", async () => {
    await seedTeachers(TEACHER)
    await seedCourse('course-1', [TEACHER])

    await expect(getCourse(dbAs(STUDENT), 'course-1')).resolves.toBeNull()
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

  describe('custom status options', () => {
    it('creates a course with the default custom status options', async () => {
      await seedTeachers(TEACHER)
      const db = dbAs(TEACHER)

      const courseId = await createCourse(db, TEACHER, '資料結構')

      const course = await getDoc(doc(db, 'courses', courseId))
      expect(course.data()).toMatchObject({ customStatuses: DEFAULT_CUSTOM_STATUSES })
    })

    it('lets a course teacher update the custom status options', async () => {
      await seedTeachers(TEACHER)
      await seedCourse('course-1', [TEACHER])
      const db = dbAs(TEACHER)

      await assertSucceeds(updateCustomStatuses(db, 'course-1', ['事假', '喪假']))

      const course = await getCourse(db, 'course-1')
      expect(course?.customStatuses).toEqual(['事假', '喪假'])
    })

    it('denies a non-course-teacher from updating the custom status options', async () => {
      await seedTeachers(TEACHER, OTHER_TEACHER)
      await seedCourse('course-1', [TEACHER])
      const db = dbAs(OTHER_TEACHER)

      await assertFails(updateCustomStatuses(db, 'course-1', ['事假']))
    })

    it('denies setting customStatuses to something other than a list, bypassing the service layer', async () => {
      await seedTeachers(TEACHER)
      await seedCourse('course-1', [TEACHER])
      const db = dbAs(TEACHER)

      await assertFails(updateDoc(doc(db, 'courses', 'course-1'), { customStatuses: '事假' }))
    })

    it('denies duplicate entries in customStatuses, bypassing the service layer', async () => {
      await seedTeachers(TEACHER)
      await seedCourse('course-1', [TEACHER])
      const db = dbAs(TEACHER)

      await assertFails(updateDoc(doc(db, 'courses', 'course-1'), { customStatuses: ['請假', '請假'] }))
    })

    it('denies an empty-string entry in customStatuses, bypassing the service layer', async () => {
      await seedTeachers(TEACHER)
      await seedCourse('course-1', [TEACHER])
      const db = dbAs(TEACHER)

      await assertFails(updateDoc(doc(db, 'courses', 'course-1'), { customStatuses: ['請假', ''] }))
    })

    it('denies an excessively long customStatuses list, bypassing the service layer', async () => {
      await seedTeachers(TEACHER)
      await seedCourse('course-1', [TEACHER])
      const db = dbAs(TEACHER)

      await assertFails(
        updateDoc(doc(db, 'courses', 'course-1'), {
          customStatuses: Array.from({ length: 21 }, (_, i) => `狀態${i}`),
        }),
      )
    })
  })

  describe('deleteCourse', () => {
    async function seedFullCourse(courseId: string, teacherEmails: string[]) {
      await seedCourse(courseId, teacherEmails)
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore() as unknown as Firestore
        await setDoc(doc(db, 'courses', courseId, 'roster', STUDENT), { name: '學生' })
        await setDoc(doc(db, 'activeSessions', courseId), { sessionId: 'session-1' })
        await setDoc(doc(db, 'sessions', 'session-1'), {
          courseId,
          createdBy: teacherEmails[0],
          createdAt: new Date('2026-01-01T00:00:00Z'),
          endedAt: null,
        })
        await setDoc(doc(db, 'sessions', 'session-1', 'tokens', 'token-1'), {
          createdAt: new Date('2026-01-01T00:00:00Z'),
        })
        await setDoc(doc(db, 'attendance', 'session-1_' + STUDENT), {
          sessionId: 'session-1',
          courseId,
          studentEmail: STUDENT,
          status: 'present',
          timestamp: new Date('2026-01-01T00:00:00Z'),
        })
      })
    }

    it('lets a course teacher delete a course, cascading to its roster/sessions/tokens/attendance/activeSessions', async () => {
      await seedTeachers(TEACHER)
      await seedFullCourse('course-1', [TEACHER])
      const db = dbAs(TEACHER)

      await assertSucceeds(deleteCourse(db, 'course-1'))

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore() as unknown as Firestore
        expect((await getDoc(doc(adminDb, 'courses', 'course-1'))).exists()).toBe(false)
        expect((await getDoc(doc(adminDb, 'activeSessions', 'course-1'))).exists()).toBe(false)
        expect((await getDoc(doc(adminDb, 'sessions', 'session-1'))).exists()).toBe(false)
        expect((await getDocs(collection(adminDb, 'sessions', 'session-1', 'tokens'))).empty).toBe(true)
        expect((await getDocs(collection(adminDb, 'courses', 'course-1', 'roster'))).empty).toBe(true)
        expect(
          (await getDoc(doc(adminDb, 'attendance', 'session-1_' + STUDENT))).exists(),
        ).toBe(false)
      })
    })

    it('denies a non-course-teacher from deleting a course', async () => {
      await seedTeachers(TEACHER, OTHER_TEACHER)
      await seedFullCourse('course-1', [TEACHER])
      const db = dbAs(OTHER_TEACHER)

      await assertFails(deleteCourse(db, 'course-1'))

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore() as unknown as Firestore
        expect((await getDoc(doc(adminDb, 'courses', 'course-1'))).exists()).toBe(true)
      })
    })
  })
})
