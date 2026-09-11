import {
  collection,
  deleteDoc,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { normalizeEmail } from '../email'
import { attendanceDocId } from './attendanceDocId'
import { isPermissionDeniedError } from './errors'

export type AttendanceStatus = 'present' | 'leave' | 'official-leave' | 'exempt' | 'absent'

export interface AttendanceRecord {
  studentEmail: string
  status: AttendanceStatus
  tokenId?: string
}

export type SubmitAttendanceResult =
  | { status: 'success' }
  | { status: 'already-checked-in' }
  // A teacher already recorded *some* status for this student — via
  // endSession's batch-absent pass, or a manual 補登 (issue #8) that
  // can happen while the session is still active. Deliberately not
  // folded into 'session-ended': that would be wrong when the session
  // is still open and a teacher just pre-recorded something.
  | { status: 'already-recorded' }
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

function resultForExistingRecord(status: unknown): SubmitAttendanceResult {
  return status === 'present' ? { status: 'already-checked-in' } : { status: 'already-recorded' }
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
    // student, another tab or a double-tap), or a teacher recording
    // something for this student — batch-absent from ending the
    // session, or a manual 補登 — in the window between the checks
    // above and this write. Re-check what's actually true now rather
    // than assume.
    const recheck = await getDocs(alreadyCheckedInQuery(db, sessionId, studentEmail))
    if (!recheck.empty) {
      return resultForExistingRecord(recheck.docs[0].data().status)
    }
    return { status: 'expired' }
  }
}

// 補登: a teacher records a status for a student who has no record yet
// for this session.
export async function addAttendanceRecord(
  db: Firestore,
  sessionId: string,
  courseId: string,
  studentEmailRaw: string,
  status: AttendanceStatus,
): Promise<void> {
  const studentEmail = normalizeEmail(studentEmailRaw)
  await setDoc(doc(db, 'attendance', attendanceDocId(sessionId, studentEmail)), {
    sessionId,
    courseId,
    studentEmail,
    status,
    timestamp: serverTimestamp(),
  })
}

// 更正狀態: a teacher changes the status of an existing record (their
// own batch/manual entry, or a student's self-check-in) without
// touching which session/student/token it's about.
export async function updateAttendanceStatus(
  db: Firestore,
  sessionId: string,
  studentEmailRaw: string,
  status: AttendanceStatus,
): Promise<void> {
  const studentEmail = normalizeEmail(studentEmailRaw)
  await updateDoc(doc(db, 'attendance', attendanceDocId(sessionId, studentEmail)), { status })
}

export async function deleteAttendanceRecord(
  db: Firestore,
  sessionId: string,
  studentEmailRaw: string,
): Promise<void> {
  const studentEmail = normalizeEmail(studentEmailRaw)
  await deleteDoc(doc(db, 'attendance', attendanceDocId(sessionId, studentEmail)))
}

export async function listAttendanceForSession(
  db: Firestore,
  courseId: string,
  sessionId: string,
): Promise<AttendanceRecord[]> {
  const snapshot = await getDocs(
    query(
      collection(db, 'attendance'),
      where('courseId', '==', courseId),
      where('sessionId', '==', sessionId),
    ),
  )
  return snapshot.docs.map((docSnapshot) => {
    const data = docSnapshot.data()
    return {
      studentEmail: data.studentEmail as string,
      status: data.status as AttendanceStatus,
      tokenId: data.tokenId as string | undefined,
    }
  })
}
