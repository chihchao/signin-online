// @vitest-environment node
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { submitAttendance } from './attendanceService'
import { createToken, endSession, startOrResumeSession } from './sessionsService'

const TEACHER = 'teacher@example.com'
const OTHER_TEACHER = 'other-teacher@example.com'
const ENROLLED_STUDENT = 'enrolled-student@example.com'
const UNRELATED_USER = 'unrelated-user@example.com'

describe('sessionsService (against Firestore rules via emulator)', () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'signin-online-sessions-rules-test',
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

  async function seedCourse(courseId: string, teacherEmails: string[]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await setDoc(doc(db, 'courses', courseId), {
        name: '測試課程',
        teacherEmails,
        qrExpirySeconds: 25,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        createdBy: teacherEmails[0],
      })
    })
  }

  it('lets a course teacher start a new session', async () => {
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)

    const sessionId = await assertSucceeds(startOrResumeSession(db, 'course-1', TEACHER))
    expect(sessionId).toBeTruthy()
  })

  it('resumes the same session on a second start call instead of creating a new one', async () => {
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)

    const first = await startOrResumeSession(db, 'course-1', TEACHER)
    const second = await startOrResumeSession(db, 'course-1', TEACHER)

    expect(second).toBe(first)
  })

  it('resolves concurrent start calls to a single session (no duplicate created)', async () => {
    await seedCourse('course-1', [TEACHER, OTHER_TEACHER])

    const [a, b, c] = await Promise.all([
      startOrResumeSession(dbAs(TEACHER), 'course-1', TEACHER),
      startOrResumeSession(dbAs(OTHER_TEACHER), 'course-1', OTHER_TEACHER),
      startOrResumeSession(dbAs(TEACHER), 'course-1', TEACHER),
    ])

    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('denies a non-course-teacher from starting a session', async () => {
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(OTHER_TEACHER)

    await assertFails(startOrResumeSession(db, 'course-1', OTHER_TEACHER))
  })

  it('lets a course teacher create a token under a session', async () => {
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)
    const sessionId = await startOrResumeSession(db, 'course-1', TEACHER)

    await assertSucceeds(createToken(db, sessionId))
  })

  it('denies a non-course-teacher from creating a token under a session', async () => {
    await seedCourse('course-1', [TEACHER])
    const sessionId = await startOrResumeSession(dbAs(TEACHER), 'course-1', TEACHER)

    await assertFails(createToken(dbAs(OTHER_TEACHER), sessionId))
  })

  it('lets an enrolled student read a session (needed for the check-in flow)', async () => {
    await seedCourse('course-1', [TEACHER])
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await setDoc(doc(db, 'courses', 'course-1', 'roster', ENROLLED_STUDENT), {})
    })
    const sessionId = await startOrResumeSession(dbAs(TEACHER), 'course-1', TEACHER)

    await assertSucceeds(getDoc(doc(dbAs(ENROLLED_STUDENT), 'sessions', sessionId)))
  })

  it('denies a signed-in user unrelated to the course from reading its session', async () => {
    await seedCourse('course-1', [TEACHER])
    const sessionId = await startOrResumeSession(dbAs(TEACHER), 'course-1', TEACHER)

    await assertFails(getDoc(doc(dbAs(UNRELATED_USER), 'sessions', sessionId)))
  })

  it('cleanly denies (rather than erroring) a read of a session id that does not exist', async () => {
    await assertFails(getDoc(doc(dbAs(UNRELATED_USER), 'sessions', 'no-such-session')))
  })

  async function seedRoster(courseId: string, ...emails: string[]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await Promise.all(emails.map((email) => setDoc(doc(db, 'courses', courseId, 'roster', email), {})))
    })
  }

  describe('endSession', () => {
    const PRESENT_STUDENT = 'present-student@example.com'
    const ABSENT_STUDENT_1 = 'absent-student-1@example.com'
    const ABSENT_STUDENT_2 = 'absent-student-2@example.com'

    it("sets endedAt and batch-marks roster members with no attendance record as 'absent', without touching existing records", async () => {
      await seedCourse('course-1', [TEACHER])
      await seedRoster('course-1', PRESENT_STUDENT, ABSENT_STUDENT_1, ABSENT_STUDENT_2)
      const teacherDb = dbAs(TEACHER)
      const sessionId = await startOrResumeSession(teacherDb, 'course-1', TEACHER)
      const tokenId = await createToken(teacherDb, sessionId)
      const checkin = await submitAttendance(dbAs(PRESENT_STUDENT), sessionId, tokenId, PRESENT_STUDENT)
      expect(checkin.status).toBe('success')

      await assertSucceeds(endSession(teacherDb, sessionId, 'course-1'))

      const sessionSnap = await getDoc(doc(teacherDb, 'sessions', sessionId))
      expect(sessionSnap.data()?.endedAt).toBeTruthy()

      // Reading back the full attendance list to verify outcomes isn't
      // something this ticket gives teachers a way to do as themselves
      // (see the rules comment on the attendance match block) — bypass
      // rules here purely to inspect state for the assertion.
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore() as unknown as Firestore
        const attendanceSnap = await getDocs(collection(db, 'attendance'))
        const byStudent = Object.fromEntries(
          attendanceSnap.docs.map((d) => [d.data().studentEmail, d.data().status]),
        )
        expect(byStudent).toEqual({
          [PRESENT_STUDENT]: 'present',
          [ABSENT_STUDENT_1]: 'absent',
          [ABSENT_STUDENT_2]: 'absent',
        })
      })
    })

    it('denies a student check-in after the session has ended', async () => {
      await seedCourse('course-1', [TEACHER])
      const teacherDb = dbAs(TEACHER)
      const sessionId = await startOrResumeSession(teacherDb, 'course-1', TEACHER)
      const tokenId = await createToken(teacherDb, sessionId)
      await endSession(teacherDb, sessionId, 'course-1')

      // Added to the roster *after* the session ended, so endSession's
      // batch-absent pass never touched them — isolates "the session
      // itself is over" from "already got auto-marked absent by it".
      const LATE_ADD_STUDENT = 'late-add-student@example.com'
      await seedRoster('course-1', LATE_ADD_STUDENT)

      const result = await submitAttendance(dbAs(LATE_ADD_STUDENT), sessionId, tokenId, LATE_ADD_STUDENT)
      expect(result.status).toBe('session-ended')
    })

    it('is safe to call a second time (e.g. retrying after a partial failure) without throwing', async () => {
      await seedCourse('course-1', [TEACHER])
      await seedRoster('course-1', ABSENT_STUDENT_1)
      const teacherDb = dbAs(TEACHER)
      const sessionId = await startOrResumeSession(teacherDb, 'course-1', TEACHER)
      await endSession(teacherDb, sessionId, 'course-1')

      await expect(endSession(teacherDb, sessionId, 'course-1')).resolves.toBeUndefined()

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore() as unknown as Firestore
        const snapshot = await getDocs(collection(db, 'attendance'))
        expect(snapshot.size).toBe(1)
      })
    })

    it('denies a non-course-teacher from ending a session', async () => {
      await seedCourse('course-1', [TEACHER])
      const sessionId = await startOrResumeSession(dbAs(TEACHER), 'course-1', TEACHER)

      await assertFails(endSession(dbAs(OTHER_TEACHER), sessionId, 'course-1'))
    })

    it('denies ending an already-ended session a second time', async () => {
      await seedCourse('course-1', [TEACHER])
      const teacherDb = dbAs(TEACHER)
      const sessionId = await startOrResumeSession(teacherDb, 'course-1', TEACHER)
      await endSession(teacherDb, sessionId, 'course-1')

      await assertFails(updateDoc(doc(teacherDb, 'sessions', sessionId), { endedAt: serverTimestamp() }))
    })
  })
})
