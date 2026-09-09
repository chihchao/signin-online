// @vitest-environment node
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, it } from 'vitest'

describe('firestore.rules', () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'signin-online-rules-test',
      firestore: {
        rules: readFileSync('firestore.rules', 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    })
  })

  afterAll(async () => {
    await testEnv.cleanup()
  })

  it('denies an unauthenticated client from reading or writing any document', async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore()

    await assertFails(unauthedDb.collection('teachers').doc('someone@example.com').get())
    await assertFails(
      unauthedDb.collection('teachers').doc('someone@example.com').set({ addedAt: new Date() }),
    )
  })
})
