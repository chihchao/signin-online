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
import { isWhitelistedTeacher } from './teachersService'

const TEACHER = 'teacher@example.com'
const OTHER_USER = 'other-user@example.com'

describe('teachersService (against Firestore rules via emulator)', () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'signin-online-teachers-rules-test',
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

  it('returns true for a signed-in user who is on the teacher whitelist', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await setDoc(doc(db, 'teachers', TEACHER), {})
    })

    await expect(isWhitelistedTeacher(dbAs(TEACHER), TEACHER)).resolves.toBe(true)
  })

  it('returns false (not a thrown error) for a signed-in user who is not on the whitelist', async () => {
    await expect(isWhitelistedTeacher(dbAs(OTHER_USER), OTHER_USER)).resolves.toBe(false)
  })

  it("denies checking a different email than the requester's own", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await setDoc(doc(db, 'teachers', TEACHER), {})
    })

    await assertFails(getDoc(doc(dbAs(OTHER_USER), 'teachers', TEACHER)))
  })

  it('lets a whitelisted teacher read their own entry directly too', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await setDoc(doc(db, 'teachers', TEACHER), {})
    })

    await assertSucceeds(getDoc(doc(dbAs(TEACHER), 'teachers', TEACHER)))
  })
})
