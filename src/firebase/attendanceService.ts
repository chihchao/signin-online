import {
  collection,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { normalizeEmail } from '../email'

export type SubmitAttendanceResult =
  | { status: 'success' }
  | { status: 'already-checked-in' }
  | { status: 'not-in-roster' }
  | { status: 'session-ended' }
  | { status: 'expired' }

function isPermissionDeniedError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'permission-denied'
}

function alreadyCheckedInQuery(db: Firestore, sessionId: string, studentEmail: string) {
  return query(
    collection(db, 'attendance'),
    where('sessionId', '==', sessionId),
    where('studentEmail', '==', studentEmail),
    limit(1),
  )
}

export async function submitAttendance(
  db: Firestore,
  sessionId: string,
  tokenId: string,
  studentEmailRaw: string,
): Promise<SubmitAttendanceResult> {
  const studentEmail = normalizeEmail(studentEmailRaw)

  const alreadyCheckedIn = await getDocs(alreadyCheckedInQuery(db, sessionId, studentEmail))
  if (!alreadyCheckedIn.empty) {
    return { status: 'already-checked-in' }
  }

  // Reading a session is scoped to that course's teachers and enrolled
  // students (see firestore.rules) — a signed-in user who can't even
  // read it is neither, which also means the read throws for a
  // nonexistent/garbage session id, not a clean "not found". Either
  // way there's nothing this student can check in to.
  let sessionSnap
  try {
    sessionSnap = await getDoc(doc(db, 'sessions', sessionId))
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      return { status: 'not-in-roster' }
    }
    throw err
  }
  if (sessionSnap.data()!.endedAt !== null) {
    return { status: 'session-ended' }
  }
  const courseId = sessionSnap.data()!.courseId as string

  try {
    await setDoc(doc(db, 'attendance', `${sessionId}_${studentEmail}`), {
      sessionId,
      courseId,
      studentEmail,
      tokenId,
      status: 'present',
      timestamp: serverTimestamp(),
    })
    return { status: 'success' }
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      throw err
    }
    // The write's rules re-validate everything from scratch, so a
    // denial here has a few possible causes beyond simple token
    // expiry: a concurrent submission that just committed (this
    // student, another tab or a double-tap), or the teacher ending
    // the session in the window between the checks above and this
    // write. Re-check what's actually true now rather than assume.
    const recheck = await getDocs(alreadyCheckedInQuery(db, sessionId, studentEmail))
    if (!recheck.empty) {
      return { status: 'already-checked-in' }
    }
    const sessionRecheck = await getDoc(doc(db, 'sessions', sessionId)).catch(() => null)
    if (sessionRecheck?.exists() && sessionRecheck.data().endedAt !== null) {
      return { status: 'session-ended' }
    }
    return { status: 'expired' }
  }
}
