import {
  addDoc,
  collection,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { attendanceDocId } from './attendanceDocId'

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

const FIRESTORE_BATCH_LIMIT = 500

// Ends the session (blocking further student check-ins) and marks
// every roster member who still has no attendance record for it as
// 'absent'. Ends the session *first* so there's no window where a
// late check-in could race the "who's missing" read below.
//
// Safe to call again after a partial failure (e.g. the batch below
// throwing after endedAt already committed): the endedAt update is
// skipped once it's already set, rather than being retried into an
// update the rules would now reject, and the roster/attendance diff
// naturally only fills in whoever is still missing.
export async function endSession(
  db: Firestore,
  sessionId: string,
  courseId: string,
): Promise<void> {
  const sessionSnap = await getDoc(doc(db, 'sessions', sessionId))
  if (sessionSnap.data()?.endedAt === null) {
    await updateDoc(doc(db, 'sessions', sessionId), { endedAt: serverTimestamp() })
  }

  const [rosterSnap, attendanceSnap] = await Promise.all([
    getDocs(collection(db, 'courses', courseId, 'roster')),
    getDocs(
      query(
        collection(db, 'attendance'),
        where('courseId', '==', courseId),
        where('sessionId', '==', sessionId),
      ),
    ),
  ])
  const recordedEmails = new Set(attendanceSnap.docs.map((d) => d.data().studentEmail as string))
  const absentEmails = rosterSnap.docs.map((d) => d.id).filter((email) => !recordedEmails.has(email))

  for (let start = 0; start < absentEmails.length; start += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const studentEmail of absentEmails.slice(start, start + FIRESTORE_BATCH_LIMIT)) {
      batch.set(doc(db, 'attendance', attendanceDocId(sessionId, studentEmail)), {
        sessionId,
        courseId,
        studentEmail,
        status: 'absent',
        timestamp: serverTimestamp(),
      })
    }
    await batch.commit()
  }
}
