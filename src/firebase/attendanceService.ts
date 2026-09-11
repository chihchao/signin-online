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
import { attendanceDocId } from './attendanceDocId'
import { isPermissionDeniedError } from './errors'

export type SubmitAttendanceResult =
  | { status: 'success' }
  | { status: 'already-checked-in' }
  | { status: 'not-in-roster' }
  | { status: 'session-ended' }
  | { status: 'expired' }

function alreadyCheckedInQuery(db: Firestore, sessionId: string, studentEmail: string) {
  return query(
    collection(db, 'attendance'),
    where('sessionId', '==', sessionId),
    where('studentEmail', '==', studentEmail),
    limit(1),
  )
}

// Only 'present' (a real self-check-in) reads as "already checked in".
// Any other status can currently only be 'absent', and the only way a
// student acquires one is endSession's batch pass — so it means the
// session ended before/as they got here, not that they did anything
// themselves. (If #8 adds teacher-authored statuses reachable while a
// session is still active, this mapping will need revisiting.)
function resultForExistingRecord(status: unknown): SubmitAttendanceResult {
  return status === 'present' ? { status: 'already-checked-in' } : { status: 'session-ended' }
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
    return resultForExistingRecord(alreadyCheckedIn.docs[0].data().status)
  }

  // Reading a session is scoped to that course's teachers and enrolled
  // students (see firestore.rules) — a signed-in user who can't even
  // read it isn't enrolled — which also means the read throws for a
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
    await setDoc(doc(db, 'attendance', attendanceDocId(sessionId, studentEmail)), {
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
    // the session — and batch-marking this student absent — in the
    // window between the checks above and this write. Re-check what's
    // actually true now rather than assume.
    const recheck = await getDocs(alreadyCheckedInQuery(db, sessionId, studentEmail))
    if (!recheck.empty) {
      return resultForExistingRecord(recheck.docs[0].data().status)
    }
    return { status: 'expired' }
  }
}
