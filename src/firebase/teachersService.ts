import { doc, getDoc, type Firestore } from 'firebase/firestore'

// Whether the signed-in user (email must be their own — see the
// teachers/{email} rule) is on the global teacher whitelist. The
// whitelist itself is Console-managed by hand; this just lets the UI
// check membership instead of only Firestore rules enforcing it on
// write, so non-teachers never see teacher-only controls to begin
// with.
export async function isWhitelistedTeacher(db: Firestore, email: string): Promise<boolean> {
  const snapshot = await getDoc(doc(db, 'teachers', email))
  return snapshot.exists()
}
