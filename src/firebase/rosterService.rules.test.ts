// @vitest-environment node
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  addRosterStudent,
  importRoster,
  listRoster,
  removeRosterStudent,
} from './rosterService'

const TEACHER = 'teacher@example.com'
const OTHER_TEACHER = 'other-teacher@example.com'
const STUDENT = 'student@example.com'
const STUDENT_2 = 'student2@example.com'

describe('rosterService (against Firestore rules via emulator)', () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'signin-online-roster-rules-test',
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

  it('lets a course teacher bulk-import a roster via pasted emails', async () => {
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)

    await assertSucceeds(
      importRoster(db, 'course-1', `${STUDENT}\n${STUDENT_2}`),
    )

    expect(await listRoster(db, 'course-1')).toEqual([STUDENT, STUDENT_2].sort())
  })

  it('lets a course teacher add a single student individually', async () => {
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)

    await assertSucceeds(addRosterStudent(db, 'course-1', STUDENT))

    expect(await listRoster(db, 'course-1')).toEqual([STUDENT])
  })

  it('lets a course teacher remove a single student', async () => {
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(TEACHER)
    await addRosterStudent(db, 'course-1', STUDENT)

    await assertSucceeds(removeRosterStudent(db, 'course-1', STUDENT))

    expect(await listRoster(db, 'course-1')).toEqual([])
  })

  it('denies a non-course-teacher from importing, adding, or removing roster entries', async () => {
    await seedCourse('course-1', [TEACHER])
    await addRosterStudent(dbAs(TEACHER), 'course-1', STUDENT)
    const db = dbAs(OTHER_TEACHER)

    await assertFails(importRoster(db, 'course-1', STUDENT_2))
    await assertFails(addRosterStudent(db, 'course-1', STUDENT_2))
    await assertFails(removeRosterStudent(db, 'course-1', STUDENT))

    expect(await listRoster(dbAs(TEACHER), 'course-1')).toEqual([STUDENT])
  })

  it('denies a student (not a course teacher) from reading or writing the roster', async () => {
    await seedCourse('course-1', [TEACHER])
    const db = dbAs(STUDENT)

    await assertFails(addRosterStudent(db, 'course-1', STUDENT))
    await assertFails(listRoster(db, 'course-1'))
  })
})
