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

export interface RosterEntry {
  email: string
  name: string
}

// Each line is "email,name" (name optional — defaults to '' when a line
// has no comma, e.g. an email-only list pasted from somewhere else).
export function parseRosterList(text: string): RosterEntry[] {
  const seen = new Set<string>()
  const entries: RosterEntry[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const commaIndex = rawLine.indexOf(',')
    const rawEmail = commaIndex === -1 ? rawLine : rawLine.slice(0, commaIndex)
    const rawName = commaIndex === -1 ? '' : rawLine.slice(commaIndex + 1)
    const email = normalizeEmail(rawEmail)
    const name = rawName.trim()
    if (email.length === 0 || seen.has(email) || !isValidEmail(email)) continue
    seen.add(email)
    entries.push({ email, name })
  }
  return entries
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

// Firestore caps a single batched write at 20 total get()/exists() calls
// across every document it writes — much tighter than the 500-write-
// per-batch limit this used to be sized against. Each roster doc
// written below only evaluates isTeacherOfCourse() (1 call: the course
// document), so 15 docs/batch (15 calls) leaves a safety margin below
// 20 rather than cutting it exactly.
const ROSTER_WRITE_BATCH_LIMIT = 15

export async function importRoster(
  db: Firestore,
  courseId: string,
  rosterText: string,
): Promise<RosterEntry[]> {
  const entries = parseRosterList(rosterText)
  for (let start = 0; start < entries.length; start += ROSTER_WRITE_BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const entry of entries.slice(start, start + ROSTER_WRITE_BATCH_LIMIT)) {
      batch.set(rosterDoc(db, courseId, entry.email), { name: entry.name })
    }
    await batch.commit()
  }
  return entries
}

export async function addRosterStudent(
  db: Firestore,
  courseId: string,
  email: string,
  name: string,
): Promise<void> {
  await setDoc(rosterDoc(db, courseId, normalizeEmailOrThrow(email)), { name: name.trim() })
}

export async function removeRosterStudent(
  db: Firestore,
  courseId: string,
  email: string,
): Promise<void> {
  await deleteDoc(rosterDoc(db, courseId, normalizeEmailOrThrow(email)))
}

export async function listRoster(db: Firestore, courseId: string): Promise<RosterEntry[]> {
  const snapshot = await getDocs(collection(db, 'courses', courseId, 'roster'))
  return snapshot.docs
    .map((docSnapshot) => ({
      email: docSnapshot.id,
      name: (docSnapshot.data().name as string | undefined) ?? '',
    }))
    .sort((a, b) => a.email.localeCompare(b.email))
}
