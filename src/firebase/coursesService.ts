import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { isPermissionDeniedError } from './errors'

export interface Course {
  id: string
  name: string
  teacherEmails: string[]
  qrExpirySeconds: number
}

const DEFAULT_QR_EXPIRY_SECONDS = 25

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
