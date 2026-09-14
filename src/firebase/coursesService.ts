import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  query,
  type QueryDocumentSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { isPermissionDeniedError } from './errors'

export interface Course {
  id: string
  name: string
  teacherEmails: string[]
  qrExpirySeconds: number
  // Absent on a course created before this field existed — callers
  // should fall back to DEFAULT_CUSTOM_STATUSES, as CourseManager does.
  customStatuses?: string[]
}

const DEFAULT_QR_EXPIRY_SECONDS = 25

// The additional 狀態 options offered beyond the fixed 出席/缺席 system
// statuses (see isValidAttendanceStatus in firestore.rules) — a
// starting point a teacher can freely rename, add to, or remove from
// via 課程設定.
export const DEFAULT_CUSTOM_STATUSES = ['請假', '公假', '免簽']

export async function createCourse(
  db: Firestore,
  teacherEmail: string,
  name: string,
): Promise<string> {
  const courseRef = doc(collection(db, 'courses'))
  await setDoc(courseRef, {
    name,
    teacherEmails: [teacherEmail],
    qrExpirySeconds: DEFAULT_QR_EXPIRY_SECONDS,
    customStatuses: DEFAULT_CUSTOM_STATUSES,
    createdAt: serverTimestamp(),
    createdBy: teacherEmail,
  })
  return courseRef.id
}

export async function listMyCourses(db: Firestore, teacherEmail: string): Promise<Course[]> {
  const coursesQuery = query(
    collection(db, 'courses'),
    where('teacherEmails', 'array-contains', teacherEmail),
  )
  const snapshot = await getDocs(coursesQuery)
  return snapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    ...(docSnapshot.data() as Omit<Course, 'id'>),
  }))
}

// Fetches a single course by id (e.g. to show its name on the
// self-check page) rather than listMyCourses' teacher-only query. A
// student who was later removed from the roster can still have old
// attendance records pointing at this course but can no longer read
// it (isEnrolledStudent() rules check) — treated the same as "not
// found" rather than surfacing a permission error to the caller.
export async function getCourse(db: Firestore, courseId: string): Promise<Course | null> {
  let snapshot
  try {
    snapshot = await getDoc(doc(db, 'courses', courseId))
  } catch (err) {
    if (isPermissionDeniedError(err)) return null
    throw err
  }
  if (!snapshot.exists()) return null
  return { id: snapshot.id, ...(snapshot.data() as Omit<Course, 'id'>) }
}

export async function addCourseTeacher(
  db: Firestore,
  courseId: string,
  email: string,
): Promise<void> {
  await updateDoc(doc(db, 'courses', courseId), { teacherEmails: arrayUnion(email) })
}

export async function removeCourseTeacher(
  db: Firestore,
  courseId: string,
  email: string,
): Promise<void> {
  await updateDoc(doc(db, 'courses', courseId), { teacherEmails: arrayRemove(email) })
}

export async function updateQrExpirySeconds(
  db: Firestore,
  courseId: string,
  seconds: number,
): Promise<void> {
  await updateDoc(doc(db, 'courses', courseId), { qrExpirySeconds: seconds })
}

export async function updateCustomStatuses(
  db: Firestore,
  courseId: string,
  customStatuses: string[],
): Promise<void> {
  await updateDoc(doc(db, 'courses', courseId), { customStatuses })
}

const FIRESTORE_BATCH_LIMIT = 500

async function deleteAllInBatches(db: Firestore, docs: QueryDocumentSnapshot[]): Promise<void> {
  for (let start = 0; start < docs.length; start += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const docSnapshot of docs.slice(start, start + FIRESTORE_BATCH_LIMIT)) {
      batch.delete(docSnapshot.ref)
    }
    await batch.commit()
  }
}

// 刪除課程: removes the course and everything scoped to it — every
// session (and each session's QR tokens), every attendance record,
// the roster, and the activeSessions pointer — since none of those
// remain reachable by anyone once the course document is gone (their
// rules all re-check isTeacherOfCourse(courseId), which needs the
// course to still exist). Deletes children first, in that dependency
// order, so a failure partway through still leaves whatever's left
// reachable by the same teacher to retry, instead of stranding
// orphaned documents nobody can reach or clean up.
export async function deleteCourse(db: Firestore, courseId: string): Promise<void> {
  const sessionsSnapshot = await getDocs(
    query(collection(db, 'sessions'), where('courseId', '==', courseId)),
  )
  await Promise.all(
    sessionsSnapshot.docs.map(async (sessionDoc) => {
      const tokensSnapshot = await getDocs(collection(db, 'sessions', sessionDoc.id, 'tokens'))
      await deleteAllInBatches(db, tokensSnapshot.docs)
    }),
  )
  await deleteAllInBatches(db, sessionsSnapshot.docs)

  const attendanceSnapshot = await getDocs(
    query(collection(db, 'attendance'), where('courseId', '==', courseId)),
  )
  await deleteAllInBatches(db, attendanceSnapshot.docs)

  const rosterSnapshot = await getDocs(collection(db, 'courses', courseId, 'roster'))
  await deleteAllInBatches(db, rosterSnapshot.docs)

  await deleteDoc(doc(db, 'activeSessions', courseId))
  await deleteDoc(doc(db, 'courses', courseId))
}
