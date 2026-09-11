import {
  collection,
  deleteDoc,
  doc,
  type Firestore,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { normalizeEmail } from '../email'

// Deliberately simple: just enough to reject obvious junk (no '@', stray
// whitespace, or a '/' that would otherwise be split into extra Firestore
// path segments by doc()). Not a full RFC 5322 validator.
const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email)
}

export function parseEmailList(text: string): string[] {
  const seen = new Set<string>()
  const emails: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const email = normalizeEmail(rawLine)
    if (email.length === 0 || seen.has(email) || !isValidEmail(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

function rosterDoc(db: Firestore, courseId: string, email: string) {
  return doc(db, 'courses', courseId, 'roster', email)
}

function normalizeEmailOrThrow(email: string): string {
  const normalized = normalizeEmail(email)
  if (!isValidEmail(normalized)) {
    throw new Error(`不是有效的 email：${email}`)
  }
  return normalized
}

const FIRESTORE_BATCH_LIMIT = 500

export async function importRoster(
  db: Firestore,
  courseId: string,
  emailsText: string,
): Promise<string[]> {
  const emails = parseEmailList(emailsText)
  for (let start = 0; start < emails.length; start += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const email of emails.slice(start, start + FIRESTORE_BATCH_LIMIT)) {
      batch.set(rosterDoc(db, courseId, email), {})
    }
    await batch.commit()
  }
  return emails
}

export async function addRosterStudent(
  db: Firestore,
  courseId: string,
  email: string,
): Promise<void> {
  await setDoc(rosterDoc(db, courseId, normalizeEmailOrThrow(email)), {})
}

export async function removeRosterStudent(
  db: Firestore,
  courseId: string,
  email: string,
): Promise<void> {
  await deleteDoc(rosterDoc(db, courseId, normalizeEmailOrThrow(email)))
}

export async function listRoster(db: Firestore, courseId: string): Promise<string[]> {
  const snapshot = await getDocs(collection(db, 'courses', courseId, 'roster'))
  return snapshot.docs.map((docSnapshot) => docSnapshot.id).sort()
}
