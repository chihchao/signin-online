// @vitest-environment node
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createToken, startOrResumeSession } from './sessionsService'

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
})
