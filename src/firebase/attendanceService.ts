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

function isPermissionDeniedError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'permission-denied'
}

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

export async function submitAttendance(
  db: Firestore,
  sessionId: string,
  tokenId: string,
  studentEmailRaw: string,
): Promise<SubmitAttendanceResult> {
  const studentEmail = studentEmailRaw.trim().toLowerCase()

  const [alreadyCheckedIn, sessionSnap] = await Promise.all([
    getDocs(alreadyCheckedInQuery(db, sessionId, studentEmail)),
    getDoc(doc(db, 'sessions', sessionId)),
  ])
  if (!alreadyCheckedIn.empty) {
    return { status: 'already-checked-in' }
  }
  if (!sessionSnap.exists() || sessionSnap.data().endedAt !== null) {
    return { status: 'session-ended' }
  }
  const courseId = sessionSnap.data().courseId as string

  const rosterSnap = await getDoc(doc(db, 'courses', courseId, 'roster', studentEmail))
  if (!rosterSnap.exists()) {
    return { status: 'not-in-roster' }
  }

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
    // Rules deny both an expired token and a write that lost a race to
    // an already-committed duplicate (the doc existed by the time this
    // write reached the server, even though our pre-check above found
    // nothing). Re-check which one actually happened.
    const recheck = await getDocs(alreadyCheckedInQuery(db, sessionId, studentEmail))
    if (!recheck.empty) {
      return { status: 'already-checked-in' }
    }
    return { status: 'expired' }
  }
}
