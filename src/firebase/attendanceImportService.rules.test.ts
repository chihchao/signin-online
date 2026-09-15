// @vitest-environment node
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, type DocumentData, doc, getDocs, query, setDoc, where, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AttendanceImportValidationError, importAttendanceForDate } from './attendanceImportService'
import { listSessionsForCourse } from './sessionsService'

const TEACHER = 'teacher@example.com'
const OTHER_TEACHER = 'other-teacher@example.com'
const STUDENT_A = 'student-a@example.com'
const STUDENT_B = 'student-b@example.com'
const CUSTOM_STATUSES = ['請假', '公假', '免簽']
const DATE = '2026-01-05'

describe('importAttendanceForDate (against Firestore rules via emulator)', () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'signin-online-attendance-import-rules-test',
      firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
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
        customStatuses: CUSTOM_STATUSES,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        createdBy: teacherEmails[0],
      })
    })
  }

  async function seedRoster(courseId: string, ...emails: string[]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await Promise.all(emails.map((email) => setDoc(doc(db, 'courses', courseId, 'roster', email), { name: '' })))
    })
  }

  async function attendanceForCourse(courseId: string): Promise<DocumentData[]> {
    let records: DocumentData[] = []
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      const snapshot = await getDocs(query(collection(db, 'attendance'), where('courseId', '==', courseId)))
      records = snapshot.docs.map((d) => d.data())
    })
    return records
  }

  it('creates a new session and writes a record for every roster-matched line', async () => {
    await seedCourse('course-1', [TEACHER])
    await seedRoster('course-1', STUDENT_A, STUDENT_B)

    const result = await importAttendanceForDate(
      dbAs(TEACHER),
      'course-1',
      TEACHER,
      CUSTOM_STATUSES,
      DATE,
      `${STUDENT_A},出席\n${STUDENT_B},請假`,
    )

    expect(result.writtenCount).toBe(2)
    expect(result.skippedNotInRoster).toEqual([])
    expect(result.sessionId).toBeTruthy()

    const records = await attendanceForCourse('course-1')
    const byStudent = Object.fromEntries(records.map((r) => [r.studentEmail, r.status]))
    expect(byStudent).toEqual({ [STUDENT_A]: 'present', [STUDENT_B]: '請假' })

    const expectedDate = new Date(`${DATE}T12:00:00`)
    for (const record of records) {
      expect(record.sessionId).toBe(result.sessionId)
      expect(record.timestamp.toDate()).toEqual(expectedDate)
    }
  })

  it('skips a line whose email is not in the roster, without failing the rest', async () => {
    await seedCourse('course-1', [TEACHER])
    await seedRoster('course-1', STUDENT_A)

    const result = await importAttendanceForDate(
      dbAs(TEACHER),
      'course-1',
      TEACHER,
      CUSTOM_STATUSES,
      DATE,
      `${STUDENT_A},出席\n${STUDENT_B},出席`,
    )

    expect(result.writtenCount).toBe(1)
    expect(result.skippedNotInRoster).toEqual([STUDENT_B])
    const records = await attendanceForCourse('course-1')
    expect(records.map((r) => r.studentEmail)).toEqual([STUDENT_A])
  })

  it('creates no session when every line is skipped for not being in the roster', async () => {
    await seedCourse('course-1', [TEACHER])

    const result = await importAttendanceForDate(
      dbAs(TEACHER),
      'course-1',
      TEACHER,
      CUSTOM_STATUSES,
      DATE,
      `${STUDENT_A},出席`,
    )

    expect(result).toEqual({ writtenCount: 0, skippedNotInRoster: [STUDENT_A], sessionId: null })
    await expect(listSessionsForCourse(dbAs(TEACHER), 'course-1')).resolves.toEqual([])
  })

  it('writes nothing and throws AttendanceImportValidationError when any line has a hard error', async () => {
    await seedCourse('course-1', [TEACHER])
    await seedRoster('course-1', STUDENT_A)

    await expect(
      importAttendanceForDate(
        dbAs(TEACHER),
        'course-1',
        TEACHER,
        CUSTOM_STATUSES,
        DATE,
        `${STUDENT_A},出席\n${STUDENT_A},請假`,
      ),
    ).rejects.toBeInstanceOf(AttendanceImportValidationError)

    expect(await attendanceForCourse('course-1')).toEqual([])
    await expect(listSessionsForCourse(dbAs(TEACHER), 'course-1')).resolves.toEqual([])
  })

  it('denies a non-course-teacher from importing', async () => {
    await seedCourse('course-1', [TEACHER])
    await seedRoster('course-1', STUDENT_A)

    await assertFails(
      importAttendanceForDate(dbAs(OTHER_TEACHER), 'course-1', OTHER_TEACHER, CUSTOM_STATUSES, DATE, `${STUDENT_A},出席`),
    )
  })
})
