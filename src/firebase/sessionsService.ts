import {
  addDoc,
  collection,
  doc,
  type Firestore,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'

export interface Session {
  id: string
  courseId: string
  createdBy: string
}

// Resumes any session for this course that hasn't been ended yet,
// regardless of when it was created — see the ticket write-up for why
// this deliberately avoids a "same calendar day" check.
//
// Runs as a transaction against a per-course activeSessions/{courseId}
// pointer document: a plain query-then-create has a race (two
// co-teachers starting at once, or even a single React StrictMode
// double-effect-invoke in dev) where both calls see "no open session"
// and both create one. The transaction serializes concurrent callers
// through the pointer doc instead.
export async function startOrResumeSession(
  db: Firestore,
  courseId: string,
  teacherEmail: string,
): Promise<string> {
  return runTransaction(db, async (transaction) => {
    const pointerRef = doc(db, 'activeSessions', courseId)
    const pointerSnap = await transaction.get(pointerRef)

    if (pointerSnap.exists()) {
      const existingSessionId = pointerSnap.data().sessionId as string
      const sessionRef = doc(db, 'sessions', existingSessionId)
      const sessionSnap = await transaction.get(sessionRef)
      if (sessionSnap.exists() && sessionSnap.data().endedAt === null) {
        return existingSessionId
      }
    }

    const newSessionRef = doc(collection(db, 'sessions'))
    transaction.set(newSessionRef, {
      courseId,
      createdBy: teacherEmail,
      createdAt: serverTimestamp(),
      endedAt: null,
    })
    transaction.set(pointerRef, { sessionId: newSessionRef.id })
    return newSessionRef.id
  })
}

export async function createToken(db: Firestore, sessionId: string): Promise<string> {
  const tokenRef = await addDoc(collection(db, 'sessions', sessionId, 'tokens'), {
    createdAt: serverTimestamp(),
  })
  return tokenRef.id
}
