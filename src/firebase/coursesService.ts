import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  type Firestore,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'

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
