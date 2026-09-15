import { doc, type Firestore, writeBatch } from 'firebase/firestore'
import { statusLabel } from '../attendanceStatusLabels'
import { normalizeEmail } from '../email'
import { attendanceDocId } from './attendanceDocId'
import { isValidEmail, listRoster } from './rosterService'
import { createImportSession } from './sessionsService'

export interface AttendanceImportLineError {
  lineNumber: number
  line: string
  reason: 'malformed' | 'invalid-status' | 'duplicate-email'
}

export interface AttendanceImportEntry {
  lineNumber: number
  email: string
  status: string
}

export type AttendanceImportParseResult =
  | { ok: true; entries: AttendanceImportEntry[] }
  | { ok: false; errors: AttendanceImportLineError[] }

// Maps the status text a teacher sees on screen — 出席/缺席 for the two
// fixed system statuses, or a course's own customStatuses text, which
// is already the label — back to the internal value written to
// attendance.status.
function buildStatusLookup(customStatuses: string[]): Map<string, string> {
  const lookup = new Map<string, string>()
  lookup.set(statusLabel('present'), 'present')
  lookup.set(statusLabel('absent'), 'absent')
  for (const status of customStatuses) {
    lookup.set(status, status)
  }
  return lookup
}

// Each line is "email,狀態文字" (the exact text shown for that status in
// this course's 出席狀態選項 panel). Blank lines are ignored. Any of the
// following makes the *whole* import invalid — see the spec's §3 table:
// a line that isn't "email,status", a status text matching none of this
// course's current status options, or the same email appearing on more
// than one line. A missing roster entry is deliberately NOT checked
// here — that's a per-line skip, decided later by importAttendanceForDate
// once it has the roster to check against.
export function parseAttendanceImportText(
  text: string,
  customStatuses: string[],
): AttendanceImportParseResult {
  const statusLookup = buildStatusLookup(customStatuses)
  const errors: AttendanceImportLineError[] = []
  const entries: AttendanceImportEntry[] = []
  const lineNumbersByEmail = new Map<string, number[]>()

  const rawLines = text.split(/\r?\n/)
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    if (line.trim().length === 0) continue
    const lineNumber = i + 1

    const commaIndex = line.indexOf(',')
    if (commaIndex === -1) {
      errors.push({ lineNumber, line, reason: 'malformed' })
      continue
    }
    const email = normalizeEmail(line.slice(0, commaIndex))
    const statusText = line.slice(commaIndex + 1).trim()
    if (email.length === 0 || !isValidEmail(email) || statusText.length === 0) {
      errors.push({ lineNumber, line, reason: 'malformed' })
      continue
    }

    const status = statusLookup.get(statusText)
    if (status === undefined) {
      errors.push({ lineNumber, line, reason: 'invalid-status' })
      continue
    }

    const lineNumbers = lineNumbersByEmail.get(email) ?? []
    lineNumbers.push(lineNumber)
    lineNumbersByEmail.set(email, lineNumbers)
    entries.push({ lineNumber, email, status })
  }

  for (const lineNumbers of lineNumbersByEmail.values()) {
    if (lineNumbers.length <= 1) continue
    for (const lineNumber of lineNumbers) {
      errors.push({ lineNumber, line: rawLines[lineNumber - 1], reason: 'duplicate-email' })
    }
  }

  if (errors.length > 0) {
    errors.sort((a, b) => a.lineNumber - b.lineNumber)
    return { ok: false, errors }
  }
  return { ok: true, entries }
}

export class AttendanceImportValidationError extends Error {
  readonly lineErrors: AttendanceImportLineError[]

  constructor(lineErrors: AttendanceImportLineError[]) {
    super('匯入內容有格式或狀態錯誤，尚未寫入任何記錄')
    this.name = 'AttendanceImportValidationError'
    this.lineErrors = lineErrors
  }
}

export interface ImportAttendanceResult {
  writtenCount: number
  skippedNotInRoster: string[]
  sessionId: string | null
}

const FIRESTORE_BATCH_LIMIT = 500

// 匯入點名記錄 (補登): validates the whole paste first (parseAttendanceImportText)
// and throws AttendanceImportValidationError without writing anything if
// any line has a hard error. Otherwise looks up the roster, skips lines
// with no matching student (reported, not fatal), and — only if at
// least one line will be written — creates a single new backdated,
// pre-ended session (createImportSession) to hold every record from
// this import.
export async function importAttendanceForDate(
  db: Firestore,
  courseId: string,
  teacherEmail: string,
  customStatuses: string[],
  dateStr: string,
  text: string,
): Promise<ImportAttendanceResult> {
  const parseResult = parseAttendanceImportText(text, customStatuses)
  if (!parseResult.ok) {
    throw new AttendanceImportValidationError(parseResult.errors)
  }

  const roster = await listRoster(db, courseId)
  const rosterEmails = new Set(roster.map((entry) => entry.email))

  const toWrite = parseResult.entries.filter((entry) => rosterEmails.has(entry.email))
  const skippedNotInRoster = parseResult.entries
    .filter((entry) => !rosterEmails.has(entry.email))
    .map((entry) => entry.email)

  if (toWrite.length === 0) {
    return { writtenCount: 0, skippedNotInRoster, sessionId: null }
  }

  const date = new Date(`${dateStr}T12:00:00`)
  const sessionId = await createImportSession(db, courseId, teacherEmail, date)

  for (let start = 0; start < toWrite.length; start += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const entry of toWrite.slice(start, start + FIRESTORE_BATCH_LIMIT)) {
      batch.set(doc(db, 'attendance', attendanceDocId(sessionId, entry.email)), {
        sessionId,
        courseId,
        studentEmail: entry.email,
        status: entry.status,
        timestamp: date,
      })
    }
    await batch.commit()
  }

  return { writtenCount: toWrite.length, skippedNotInRoster, sessionId }
}
