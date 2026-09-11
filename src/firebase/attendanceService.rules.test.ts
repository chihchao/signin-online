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
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  addAttendanceRecord,
  deleteAttendanceRecord,
  listAttendanceForSession,
  submitAttendance,
  updateAttendanceStatus,
} from './attendanceService'

const TEACHER = 'teacher@example.com'
const STUDENT = 'student@example.com'
const OTHER_STUDENT = 'other-student@example.com'
const COURSE_ID = 'course-1'
const SESSION_ID = 'session-1'
const QR_EXPIRY_SECONDS = 25

describe('attendanceService (against Firestore rules via emulator)', () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'signin-online-attendance-rules-test',
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

  async function seedScenario(options: {
    tokenAgeSeconds?: number
    sessionEndedAt?: Date | null
    enrollStudent?: boolean
  } = {}) {
    const {
      tokenAgeSeconds = 5,
      sessionEndedAt = null,
      enrollStudent = true,
    } = options

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await setDoc(doc(db, 'courses', COURSE_ID), {
        name: '測試課程',
        teacherEmails: [TEACHER],
        qrExpirySeconds: QR_EXPIRY_SECONDS,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        createdBy: TEACHER,
      })
      if (enrollStudent) {
        await setDoc(doc(db, 'courses', COURSE_ID, 'roster', STUDENT), {})
      }
      await setDoc(doc(db, 'sessions', SESSION_ID), {
        courseId: COURSE_ID,
        createdBy: TEACHER,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        endedAt: sessionEndedAt,
      })
      await setDoc(doc(db, 'sessions', SESSION_ID, 'tokens', 'token-1'), {
        createdAt: new Date(Date.now() - tokenAgeSeconds * 1000),
      })
    })
  }

  it('lets an enrolled student check in with a fresh token', async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    const db = dbAs(STUDENT)

    const result = await submitAttendance(db, SESSION_ID, 'token-1', STUDENT)

    expect(result.status).toBe('success')

    const snapshot = await getDocs(
      query(
        collection(db, 'attendance'),
        where('sessionId', '==', SESSION_ID),
        where('studentEmail', '==', STUDENT),
      ),
    )
    expect(snapshot.size).toBe(1)
    expect(snapshot.docs[0].data()).toMatchObject({
      sessionId: SESSION_ID,
      courseId: COURSE_ID,
      studentEmail: STUDENT,
      status: 'present',
      tokenId: 'token-1',
    })
  })

  it('returns not-in-roster for a student who is not enrolled, without writing anything', async () => {
    await seedScenario({ enrollStudent: false })
    const db = dbAs(STUDENT)

    const result = await submitAttendance(db, SESSION_ID, 'token-1', STUDENT)

    expect(result.status).toBe('not-in-roster')
  })

  it('returns expired for a token older than the course qrExpirySeconds', async () => {
    await seedScenario({ tokenAgeSeconds: QR_EXPIRY_SECONDS + 10 })
    const db = dbAs(STUDENT)

    const result = await submitAttendance(db, SESSION_ID, 'token-1', STUDENT)

    expect(result.status).toBe('expired')
  })

  it('returns session-ended once the session has been ended', async () => {
    await seedScenario({ sessionEndedAt: new Date() })
    const db = dbAs(STUDENT)

    const result = await submitAttendance(db, SESSION_ID, 'token-1', STUDENT)

    expect(result.status).toBe('session-ended')
  })

  it("returns already-recorded, not already-checked-in, when an existing record is a teacher-marked absence (not this student's own check-in)", async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await setDoc(doc(db, 'attendance', `${SESSION_ID}_${STUDENT}`), {
        sessionId: SESSION_ID,
        courseId: COURSE_ID,
        studentEmail: STUDENT,
        status: 'absent',
        timestamp: new Date(),
      })
    })

    const result = await submitAttendance(dbAs(STUDENT), SESSION_ID, 'token-1', STUDENT)

    expect(result.status).toBe('already-recorded')
  })

  it("returns already-recorded, not session-ended, when a teacher pre-records a status while the session is still active", async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    await addAttendanceRecord(dbAs(TEACHER), SESSION_ID, COURSE_ID, STUDENT, 'leave')

    const result = await submitAttendance(dbAs(STUDENT), SESSION_ID, 'token-1', STUDENT)

    expect(result.status).toBe('already-recorded')
  })

  it('returns already-checked-in on a second submission and does not create a duplicate document', async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    const db = dbAs(STUDENT)

    const first = await submitAttendance(db, SESSION_ID, 'token-1', STUDENT)
    expect(first.status).toBe('success')

    const second = await submitAttendance(db, SESSION_ID, 'token-1', STUDENT)
    expect(second.status).toBe('already-checked-in')

    const snapshot = await getDocs(
      query(
        collection(db, 'attendance'),
        where('sessionId', '==', SESSION_ID),
        where('studentEmail', '==', STUDENT),
      ),
    )
    expect(snapshot.size).toBe(1)
  })

  it('denies a raw write at a document id other than sessionId_studentEmail', async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    const db = dbAs(STUDENT)

    await assertFails(
      setDoc(doc(db, 'attendance', 'some-other-doc-id'), {
        sessionId: SESSION_ID,
        courseId: COURSE_ID,
        studentEmail: STUDENT,
        tokenId: 'token-1',
        status: 'present',
        timestamp: serverTimestamp(),
      }),
    )
  })

  it('denies a raw write with unexpected extra fields', async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    const db = dbAs(STUDENT)

    await assertFails(
      setDoc(doc(db, 'attendance', `${SESSION_ID}_${STUDENT}`), {
        sessionId: SESSION_ID,
        courseId: COURSE_ID,
        studentEmail: STUDENT,
        tokenId: 'token-1',
        status: 'present',
        timestamp: serverTimestamp(),
        note: 'injected field',
      }),
    )
  })

  it('resolves two concurrent check-in attempts to one success and one already-checked-in, with only one document', async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    const db = dbAs(STUDENT)

    const [a, b] = await Promise.all([
      submitAttendance(db, SESSION_ID, 'token-1', STUDENT),
      submitAttendance(db, SESSION_ID, 'token-1', STUDENT),
    ])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual(['already-checked-in', 'success'])

    const snapshot = await getDocs(
      query(
        collection(db, 'attendance'),
        where('sessionId', '==', SESSION_ID),
        where('studentEmail', '==', STUDENT),
      ),
    )
    expect(snapshot.size).toBe(1)
  })

  it('checks in successfully even when the signed-in email has different casing than the roster entry', async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    const mixedCaseDb = testEnv
      .authenticatedContext('mixed-case-user', { email: 'Student@Example.com' })
      .firestore() as unknown as Firestore

    const result = await submitAttendance(mixedCaseDb, SESSION_ID, 'token-1', 'Student@Example.com')

    expect(result.status).toBe('success')
  })

  it('denies a raw write that forges the timestamp instead of using request.time', async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    const db = dbAs(STUDENT)

    await assertFails(
      setDoc(doc(db, 'attendance', `${SESSION_ID}_${STUDENT}`), {
        sessionId: SESSION_ID,
        courseId: COURSE_ID,
        studentEmail: STUDENT,
        tokenId: 'token-1',
        status: 'present',
        timestamp: new Date('2020-01-01'),
      }),
    )
  })

  it('denies a raw write claiming to be a different student than the requester', async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    const db = dbAs(STUDENT)

    await assertFails(
      setDoc(doc(db, 'attendance', `${SESSION_ID}_${OTHER_STUDENT}`), {
        sessionId: SESSION_ID,
        courseId: COURSE_ID,
        studentEmail: OTHER_STUDENT,
        tokenId: 'token-1',
        status: 'present',
        timestamp: new Date(),
      }),
    )
  })

  it('denies a student from reading another student\'s attendance record', async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    await submitAttendance(dbAs(STUDENT), SESSION_ID, 'token-1', STUDENT)

    await assertFails(
      getDocs(
        query(
          collection(dbAs(OTHER_STUDENT), 'attendance'),
          where('sessionId', '==', SESSION_ID),
          where('studentEmail', '==', STUDENT),
        ),
      ),
    )
  })

  it('lets a student read their own attendance record', async () => {
    await seedScenario({ tokenAgeSeconds: 5 })
    await submitAttendance(dbAs(STUDENT), SESSION_ID, 'token-1', STUDENT)

    const snapshot = await assertSucceeds(
      getDocs(
        query(
          collection(dbAs(STUDENT), 'attendance'),
          where('sessionId', '==', SESSION_ID),
          where('studentEmail', '==', STUDENT),
        ),
      ),
    )
    expect(snapshot.size).toBe(1)
  })

  describe('teacher manual edits (issue #8)', () => {
    it('lets a course teacher add a record for a student with any of the five statuses', async () => {
      await seedScenario()
      const statuses = ['present', 'leave', 'official-leave', 'exempt', 'absent'] as const
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore() as unknown as Firestore
        await Promise.all(
          statuses.map((status) =>
            setDoc(doc(db, 'courses', COURSE_ID, 'roster', `${status}-student@example.com`), {}),
          ),
        )
      })
      const teacherDb = dbAs(TEACHER)

      for (const status of statuses) {
        const email = `${status}-student@example.com`
        await assertSucceeds(addAttendanceRecord(teacherDb, SESSION_ID, COURSE_ID, email, status))
      }

      const records = await listAttendanceForSession(teacherDb, COURSE_ID, SESSION_ID)
      const byStudent = Object.fromEntries(records.map((r) => [r.studentEmail, r.status]))
      expect(byStudent).toEqual({
        'present-student@example.com': 'present',
        'leave-student@example.com': 'leave',
        'official-leave-student@example.com': 'official-leave',
        'exempt-student@example.com': 'exempt',
        'absent-student@example.com': 'absent',
      })
    })

    it('denies a non-course-teacher from adding a record', async () => {
      await seedScenario()

      await assertFails(
        addAttendanceRecord(dbAs(OTHER_STUDENT), SESSION_ID, COURSE_ID, STUDENT, 'absent'),
      )
    })

    it("denies addAttendanceRecord from silently overwriting a student's existing self-check-in (stale-read protection)", async () => {
      await seedScenario({ tokenAgeSeconds: 5 })
      await submitAttendance(dbAs(STUDENT), SESSION_ID, 'token-1', STUDENT)

      // A teacher's UI reading the roster before this check-in landed
      // would see STUDENT as 未簽到 and attempt a 補登 — this must be
      // rejected, not silently strip the student's tokenId/timestamp.
      await assertFails(addAttendanceRecord(dbAs(TEACHER), SESSION_ID, COURSE_ID, STUDENT, 'absent'))

      const records = await listAttendanceForSession(dbAs(TEACHER), COURSE_ID, SESSION_ID)
      expect(records).toEqual([
        expect.objectContaining({ studentEmail: STUDENT, status: 'present', tokenId: 'token-1' }),
      ])
    })

    it('lets a course teacher change the status of an existing record without touching its other fields', async () => {
      await seedScenario({ tokenAgeSeconds: 5 })
      const teacherDb = dbAs(TEACHER)
      await submitAttendance(dbAs(STUDENT), SESSION_ID, 'token-1', STUDENT)

      await assertSucceeds(updateAttendanceStatus(teacherDb, SESSION_ID, STUDENT, 'leave'))

      const records = await listAttendanceForSession(teacherDb, COURSE_ID, SESSION_ID)
      expect(records).toEqual([
        expect.objectContaining({ studentEmail: STUDENT, status: 'leave', tokenId: 'token-1' }),
      ])
    })

    it('lets a course teacher change status even for an ended session (no timestamp == request.time requirement)', async () => {
      await seedScenario({ sessionEndedAt: new Date() })
      const teacherDb = dbAs(TEACHER)
      await addAttendanceRecord(teacherDb, SESSION_ID, COURSE_ID, STUDENT, 'absent')

      await assertSucceeds(updateAttendanceStatus(teacherDb, SESSION_ID, STUDENT, 'official-leave'))
    })

    it('denies a non-course-teacher from updating a status', async () => {
      await seedScenario({ tokenAgeSeconds: 5 })
      await submitAttendance(dbAs(STUDENT), SESSION_ID, 'token-1', STUDENT)

      await assertFails(updateAttendanceStatus(dbAs(OTHER_STUDENT), SESSION_ID, STUDENT, 'leave'))
    })

    it('lets a course teacher delete any attendance record', async () => {
      await seedScenario({ tokenAgeSeconds: 5 })
      const teacherDb = dbAs(TEACHER)
      await submitAttendance(dbAs(STUDENT), SESSION_ID, 'token-1', STUDENT)

      await assertSucceeds(deleteAttendanceRecord(teacherDb, SESSION_ID, STUDENT))

      const records = await listAttendanceForSession(teacherDb, COURSE_ID, SESSION_ID)
      expect(records).toEqual([])
    })

    it('denies a non-course-teacher from deleting a record', async () => {
      await seedScenario({ tokenAgeSeconds: 5 })
      await submitAttendance(dbAs(STUDENT), SESSION_ID, 'token-1', STUDENT)

      await assertFails(deleteAttendanceRecord(dbAs(OTHER_STUDENT), SESSION_ID, STUDENT))
    })

    it("denies a teacher's update from smuggling in a change to sessionId/courseId/studentEmail", async () => {
      await seedScenario({ tokenAgeSeconds: 5 })
      const teacherDb = dbAs(TEACHER)
      await submitAttendance(dbAs(STUDENT), SESSION_ID, 'token-1', STUDENT)

      await assertFails(
        updateDoc(doc(teacherDb, 'attendance', `${SESSION_ID}_${STUDENT}`), {
          studentEmail: OTHER_STUDENT,
        }),
      )
    })
  })
})
