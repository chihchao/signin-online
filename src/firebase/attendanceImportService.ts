import { statusLabel } from '../attendanceStatusLabels'
import { normalizeEmail } from '../email'
import { isValidEmail } from './rosterService'

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
