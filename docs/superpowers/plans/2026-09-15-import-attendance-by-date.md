# 匯入點名記錄（補登指定日期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a course teacher paste an `email,狀態` list plus a date into the course settings page to backfill (補登) attendance records for a day they forgot to take attendance.

**Architecture:** A new pure parsing/validation function classifies every line of pasted text as valid or as one of three "abort the whole import" errors (malformed line, invalid status text, duplicate email); a second orchestration function runs it, looks up the course roster, skips (but doesn't abort on) lines with no matching student, and — only if at least one line will be written — creates a brand-new, pre-dated, already-ended `session` document and batch-writes `attendance` records into it. `firestore.rules` gains a second allowed shape for session creation (backdated + pre-ended) alongside the existing live "開始點名" shape.

**Tech Stack:** TypeScript, React 19, Firebase Firestore (client SDK v12), Vitest (+ `@firebase/rules-unit-testing` against the Firestore emulator for rules-backed tests).

**Spec:** [docs/specs/2026-09-15-import-attendance-by-date.md](../../specs/2026-09-15-import-attendance-by-date.md) — the plan below argues from that spec; read both.

## Global Constraints

- Status text is matched against the exact display label a teacher sees on screen (`statusLabel('present')`/`statusLabel('absent')`, or a raw `customStatuses` entry) — never an internal code like `present`/`absent` typed literally.
- No file upload / CSV parsing — paste-text only, one line per record: `email,狀態文字`.
- No preview-before-commit step — the importer validates and writes in one submit, then reports results.
- Blank lines in the pasted text are always ignored, never an error.
- A "hard" error on any line (malformed line, invalid status text, duplicate email anywhere in the paste) aborts the **entire** import — nothing is written, every hard-error line is reported together.
- A "soft" error (email not found in the course roster) only skips that one line; the rest still writes, and skipped emails are reported.
- Every import creates a brand-new `session` — never matched against, merged into, or compared with an existing session for that date.
- The new session's `createdAt` and every written `attendance.timestamp` are set to **noon (12:00) local time on the chosen date** — never "now", never midnight.
- The new session's `endedAt` is set equal to `createdAt` at creation time — it is never left "open".
- The date input cannot select a future date (`max` = today) — an import only backfills the past.

---

## File Structure

- **Modify** `firestore.rules` — add a second allowed shape for `sessions` creation (backdated + pre-ended), alongside the existing live-session shape.
- **Modify** `src/firebase/sessionsService.ts` — add `createImportSession()`.
- **Modify** `src/firebase/sessionsService.rules.test.ts` — add rules-backed tests for `createImportSession()`.
- **Create** `src/firebase/attendanceImportService.ts` — `parseAttendanceImportText()` (pure) and `importAttendanceForDate()` (Firestore-touching orchestration) + `AttendanceImportValidationError`.
- **Create** `src/firebase/attendanceImportService.test.ts` — pure unit tests for `parseAttendanceImportText()`.
- **Create** `src/firebase/attendanceImportService.rules.test.ts` — rules-backed tests for `importAttendanceForDate()`.
- **Create** `src/AttendanceImportView.tsx` — the settings-page panel component (mirrors `src/AttendanceExportView.tsx`).
- **Modify** `src/CourseManager.tsx` — import and render `AttendanceImportView` inside `CourseSettings`'s `.settings-grid`.

---

### Task 1: Allow backdated, pre-ended sessions (firestore.rules + createImportSession)

**Files:**
- Modify: `firestore.rules:124-128`
- Modify: `src/firebase/sessionsService.ts` (imports at 1-16, new export after `startOrResumeSession`, ~line 63)
- Test: `src/firebase/sessionsService.rules.test.ts`

**Interfaces:**
- Produces: `createImportSession(db: Firestore, courseId: string, teacherEmail: string, date: Date): Promise<string>` — creates a new `sessions/{id}` doc with `createdAt = endedAt = date` and returns its id. Later tasks (`importAttendanceForDate`) call this.

- [ ] **Step 1: Write the failing rules test**

Add `createImportSession` to the existing import line at the top of `src/firebase/sessionsService.rules.test.ts`:

```ts
import { createImportSession, createToken, endSession, listSessionsForCourse, startOrResumeSession } from './sessionsService'
```

Add this new `describe` block right after the `'lets a course teacher create a token under a session'` / `'denies a non-course-teacher from creating a token under a session'` pair (after line 118, before `describe('listSessionsForCourse', ...)`):

```ts
  describe('createImportSession (補登指定日期)', () => {
    it('creates an already-ended session backdated to the given date', async () => {
      await seedCourse('course-1', [TEACHER])
      const teacherDb = dbAs(TEACHER)
      const date = new Date('2026-01-05T12:00:00')

      const sessionId = await assertSucceeds(createImportSession(teacherDb, 'course-1', TEACHER, date))

      const sessionSnap = await getDoc(doc(teacherDb, 'sessions', sessionId))
      expect(sessionSnap.data()?.createdAt.toDate()).toEqual(date)
      expect(sessionSnap.data()?.endedAt.toDate()).toEqual(date)
      expect(sessionSnap.data()?.createdBy).toBe(TEACHER)
    })

    it('denies a non-course-teacher from creating an import session', async () => {
      await seedCourse('course-1', [TEACHER])

      await assertFails(
        createImportSession(dbAs(OTHER_TEACHER), 'course-1', OTHER_TEACHER, new Date('2026-01-05T12:00:00')),
      )
    })

    it('denies backdating to a future date', async () => {
      await seedCourse('course-1', [TEACHER])
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000)

      await assertFails(createImportSession(dbAs(TEACHER), 'course-1', TEACHER, future))
    })

    it("never touches the activeSessions pointer used by 開始點名 (doesn't get resumed, doesn't steal the live session's slot)", async () => {
      await seedCourse('course-1', [TEACHER])
      const teacherDb = dbAs(TEACHER)
      const liveSessionId = await startOrResumeSession(teacherDb, 'course-1', TEACHER)

      const importSessionId = await createImportSession(
        teacherDb,
        'course-1',
        TEACHER,
        new Date('2026-01-05T12:00:00'),
      )

      expect(importSessionId).not.toBe(liveSessionId)
      await expect(startOrResumeSession(teacherDb, 'course-1', TEACHER)).resolves.toBe(liveSessionId)
    })
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:rules`
Expected: FAIL — `createImportSession` is not exported from `./sessionsService` (TypeScript/import error), or (once the import is stubbed) the emulator rejects every create because `firestore.rules` doesn't have `isValidImportSessionCreate` yet.

- [ ] **Step 3: Add `setDoc` to sessionsService.ts's Firestore import and implement `createImportSession`**

In `src/firebase/sessionsService.ts`, change the import block (lines 1-15) to add `setDoc`:

```ts
import {
  addDoc,
  collection,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
```

Add this new function right after `startOrResumeSession` (after line 62, before the `SessionSummary` interface):

```ts
// 匯入點名記錄 (補登): unlike startOrResumeSession, always creates a
// brand-new session — an import never merges into or resumes an
// existing one — pre-dated to `date` and immediately marked ended,
// since it only exists to carry backfilled records rather than a live
// 點名 activity. Bypasses the activeSessions/{courseId} pointer
// entirely: an import session must never be something 開始點名 resumes
// or endSession ends again.
export async function createImportSession(
  db: Firestore,
  courseId: string,
  teacherEmail: string,
  date: Date,
): Promise<string> {
  const sessionRef = doc(collection(db, 'sessions'))
  await setDoc(sessionRef, {
    courseId,
    createdBy: teacherEmail,
    createdAt: date,
    endedAt: date,
  })
  return sessionRef.id
}
```

- [ ] **Step 4: Update firestore.rules**

In `firestore.rules`, insert two new functions immediately before `match /sessions/{sessionId} {` (currently line 124), and change the `allow create` line inside that match block (currently lines 125-128):

Replace:

```
    match /sessions/{sessionId} {
      allow create: if isTeacherOfCourse(request.resource.data.courseId) &&
        request.resource.data.createdBy == request.auth.token.email &&
        request.resource.data.createdAt == request.time &&
        request.resource.data.endedAt == null;
```

With:

```
    function isValidLiveSessionCreate() {
      return request.resource.data.createdAt == request.time &&
        request.resource.data.endedAt == null;
    }

    // 匯入點名記錄 (補登): a teacher backfilling a past day's attendance
    // creates a session that's pre-dated and already ended, instead of
    // the live "開始點名" flow's request.time/null pair. createdAt may
    // be any timestamp no later than now (never a future date — this
    // only backfills the past) and endedAt must equal createdAt exactly
    // (no "created but still open" state for an import session).
    function isValidImportSessionCreate() {
      return request.resource.data.createdAt is timestamp &&
        request.resource.data.createdAt <= request.time &&
        request.resource.data.endedAt == request.resource.data.createdAt;
    }

    match /sessions/{sessionId} {
      allow create: if isTeacherOfCourse(request.resource.data.courseId) &&
        request.resource.data.createdBy == request.auth.token.email &&
        (isValidLiveSessionCreate() || isValidImportSessionCreate());
```

Leave the rest of the `sessions` match block (list/get/update/delete/tokens, currently lines 129-166) unchanged — `update` still requires `resource.data.endedAt == null` before it'll touch `endedAt`, so an import session (created with `endedAt` already set) is correctly unreachable by `endSession()`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:rules`
Expected: PASS — all 4 new tests in `createImportSession (補登指定日期)`, plus every pre-existing test in the file (regression check that the live-session path still works unchanged).

- [ ] **Step 6: Commit**

```bash
git add firestore.rules src/firebase/sessionsService.ts src/firebase/sessionsService.rules.test.ts
git commit -m "feat: allow creating backdated, pre-ended sessions for attendance import

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Parse and validate pasted import text (pure function)

**Files:**
- Create: `src/firebase/attendanceImportService.ts`
- Test: `src/firebase/attendanceImportService.test.ts`

**Interfaces:**
- Consumes: `statusLabel(status: string): string` from `src/attendanceStatusLabels.ts`; `normalizeEmail(email: string): string` from `src/email.ts`; `isValidEmail(email: string): boolean` from `src/firebase/rosterService.ts`.
- Produces: `parseAttendanceImportText(text: string, customStatuses: string[]): AttendanceImportParseResult`, `AttendanceImportLineError { lineNumber: number; line: string; reason: 'malformed' | 'invalid-status' | 'duplicate-email' }`, `AttendanceImportEntry { lineNumber: number; email: string; status: string }`. Task 3 (`importAttendanceForDate`) consumes all three.

- [ ] **Step 1: Write the failing tests**

Create `src/firebase/attendanceImportService.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseAttendanceImportText } from './attendanceImportService'

const CUSTOM_STATUSES = ['請假', '公假', '免簽']

describe('parseAttendanceImportText', () => {
  it('parses valid lines, mapping display labels to internal status values', () => {
    const result = parseAttendanceImportText(
      'a@example.com,出席\nb@example.com,請假\nc@example.com,缺席',
      CUSTOM_STATUSES,
    )
    expect(result).toEqual({
      ok: true,
      entries: [
        { lineNumber: 1, email: 'a@example.com', status: 'present' },
        { lineNumber: 2, email: 'b@example.com', status: '請假' },
        { lineNumber: 3, email: 'c@example.com', status: 'absent' },
      ],
    })
  })

  it('ignores blank lines without treating them as errors', () => {
    const result = parseAttendanceImportText('\na@example.com,出席\n\n\nb@example.com,缺席\n', CUSTOM_STATUSES)
    expect(result).toEqual({
      ok: true,
      entries: [
        { lineNumber: 2, email: 'a@example.com', status: 'present' },
        { lineNumber: 5, email: 'b@example.com', status: 'absent' },
      ],
    })
  })

  it('normalizes email casing and surrounding whitespace', () => {
    const result = parseAttendanceImportText('  A@Example.com , 出席 ', CUSTOM_STATUSES)
    expect(result).toEqual({
      ok: true,
      entries: [{ lineNumber: 1, email: 'a@example.com', status: 'present' }],
    })
  })

  it('handles Windows-style CRLF line endings', () => {
    const result = parseAttendanceImportText('a@example.com,出席\r\nb@example.com,缺席\r\n', CUSTOM_STATUSES)
    expect(result.ok).toBe(true)
    expect(result.ok && result.entries).toEqual([
      { lineNumber: 1, email: 'a@example.com', status: 'present' },
      { lineNumber: 2, email: 'b@example.com', status: 'absent' },
    ])
  })

  it('reports a line with no comma as malformed', () => {
    const result = parseAttendanceImportText('a@example.com,出席\nnot-a-valid-line', CUSTOM_STATUSES)
    expect(result).toEqual({
      ok: false,
      errors: [{ lineNumber: 2, line: 'not-a-valid-line', reason: 'malformed' }],
    })
  })

  it('reports a line with an empty status as malformed', () => {
    const result = parseAttendanceImportText('a@example.com,', CUSTOM_STATUSES)
    expect(result).toEqual({
      ok: false,
      errors: [{ lineNumber: 1, line: 'a@example.com,', reason: 'malformed' }],
    })
  })

  it('reports a line whose email portion is not a plausible email as malformed', () => {
    const result = parseAttendanceImportText('not-an-email,出席', CUSTOM_STATUSES)
    expect(result).toEqual({
      ok: false,
      errors: [{ lineNumber: 1, line: 'not-an-email,出席', reason: 'malformed' }],
    })
  })

  it('reports a status text that matches no current status option as invalid-status', () => {
    const result = parseAttendanceImportText('a@example.com,遲到', CUSTOM_STATUSES)
    expect(result).toEqual({
      ok: false,
      errors: [{ lineNumber: 1, line: 'a@example.com,遲到', reason: 'invalid-status' }],
    })
  })

  it('reports every line sharing a duplicated email as duplicate-email', () => {
    const result = parseAttendanceImportText(
      'a@example.com,出席\nb@example.com,缺席\na@example.com,請假',
      CUSTOM_STATUSES,
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        { lineNumber: 1, line: 'a@example.com,出席', reason: 'duplicate-email' },
        { lineNumber: 3, line: 'a@example.com,請假', reason: 'duplicate-email' },
      ],
    })
  })

  it('treats emails as duplicates regardless of casing or whitespace differences', () => {
    const result = parseAttendanceImportText('A@Example.com,出席\n a@example.com ,缺席', CUSTOM_STATUSES)
    expect(result.ok).toBe(false)
    expect(result.ok || result.errors.map((e) => e.reason)).toEqual(['duplicate-email', 'duplicate-email'])
  })

  it('collects every hard-error line together, sorted by line number, instead of stopping at the first', () => {
    const result = parseAttendanceImportText(
      'a@example.com,遲到\nnot-a-valid-line\nb@example.com,出席\nb@example.com,缺席',
      CUSTOM_STATUSES,
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        { lineNumber: 1, line: 'a@example.com,遲到', reason: 'invalid-status' },
        { lineNumber: 2, line: 'not-a-valid-line', reason: 'malformed' },
        { lineNumber: 3, line: 'b@example.com,出席', reason: 'duplicate-email' },
        { lineNumber: 4, line: 'b@example.com,缺席', reason: 'duplicate-email' },
      ],
    })
  })

  it('returns an empty entry list for empty or whitespace-only input', () => {
    expect(parseAttendanceImportText('', CUSTOM_STATUSES)).toEqual({ ok: true, entries: [] })
    expect(parseAttendanceImportText('   \n  \n', CUSTOM_STATUSES)).toEqual({ ok: true, entries: [] })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/firebase/attendanceImportService.test.ts`
Expected: FAIL — `./attendanceImportService` doesn't exist yet.

- [ ] **Step 3: Implement `parseAttendanceImportText`**

Create `src/firebase/attendanceImportService.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/firebase/attendanceImportService.test.ts`
Expected: PASS — all cases above.

- [ ] **Step 5: Commit**

```bash
git add src/firebase/attendanceImportService.ts src/firebase/attendanceImportService.test.ts
git commit -m "feat: add parseAttendanceImportText for the attendance import feature

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Orchestrate the import against Firestore

**Files:**
- Modify: `src/firebase/attendanceImportService.ts`
- Test: `src/firebase/attendanceImportService.rules.test.ts`

**Interfaces:**
- Consumes: `parseAttendanceImportText` + types (Task 2); `createImportSession` (Task 1); `listRoster(db, courseId): Promise<RosterEntry[]>` and `RosterEntry { email: string; name: string }` from `./rosterService`; `attendanceDocId(sessionId, studentEmail): string` from `./attendanceDocId`.
- Produces: `importAttendanceForDate(db: Firestore, courseId: string, teacherEmail: string, customStatuses: string[], dateStr: string, text: string): Promise<ImportAttendanceResult>`, `ImportAttendanceResult { writtenCount: number; skippedNotInRoster: string[]; sessionId: string | null }`, `AttendanceImportValidationError` (an `Error` subclass carrying `lineErrors: AttendanceImportLineError[]`). Task 4 (the UI) consumes all three.

- [ ] **Step 1: Write the failing rules tests**

Create `src/firebase/attendanceImportService.rules.test.ts`:

```ts
// @vitest-environment node
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocs, query, setDoc, where, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AttendanceImportValidationError, importAttendanceForDate } from './attendanceImportService'
import { listSessionsForCourse } from './sessionsService'

const TEACHER = 'teacher@example.com'
const OTHER_TEACHER = 'other-teacher@example.com'
const STUDENT_A = 'student-a@example.com'
const STUDENT_B = 'student-b@example.com'
const CUSTOM_STATUSES = ['請假', '公假', '免簽']
const DATE = '2026-01-05'

describe('importAttendanceForDate (against Firestore rules via emulator)', () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'signin-online-attendance-import-rules-test',
      firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    })
  })

  afterEach(async () => {
    await testEnv.clearFirestore()
  })

  afterAll(async () => {
    await testEnv.cleanup()
  })

  function dbAs(email: string): Firestore {
    return testEnv.authenticatedContext(email, { email }).firestore() as unknown as Firestore
  }

  async function seedCourse(courseId: string, teacherEmails: string[]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await setDoc(doc(db, 'courses', courseId), {
        name: '測試課程',
        teacherEmails,
        qrExpirySeconds: 25,
        customStatuses: CUSTOM_STATUSES,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        createdBy: teacherEmails[0],
      })
    })
  }

  async function seedRoster(courseId: string, ...emails: string[]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      await Promise.all(emails.map((email) => setDoc(doc(db, 'courses', courseId, 'roster', email), { name: '' })))
    })
  }

  async function attendanceForCourse(courseId: string) {
    return testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore
      const snapshot = await getDocs(query(collection(db, 'attendance'), where('courseId', '==', courseId)))
      return snapshot.docs.map((d) => d.data())
    })
  }

  it('creates a new session and writes a record for every roster-matched line', async () => {
    await seedCourse('course-1', [TEACHER])
    await seedRoster('course-1', STUDENT_A, STUDENT_B)

    const result = await importAttendanceForDate(
      dbAs(TEACHER),
      'course-1',
      TEACHER,
      CUSTOM_STATUSES,
      DATE,
      `${STUDENT_A},出席\n${STUDENT_B},請假`,
    )

    expect(result.writtenCount).toBe(2)
    expect(result.skippedNotInRoster).toEqual([])
    expect(result.sessionId).toBeTruthy()

    const records = await attendanceForCourse('course-1')
    const byStudent = Object.fromEntries(records.map((r) => [r.studentEmail, r.status]))
    expect(byStudent).toEqual({ [STUDENT_A]: 'present', [STUDENT_B]: '請假' })

    const expectedDate = new Date(`${DATE}T12:00:00`)
    for (const record of records) {
      expect(record.sessionId).toBe(result.sessionId)
      expect(record.timestamp.toDate()).toEqual(expectedDate)
    }
  })

  it('skips a line whose email is not in the roster, without failing the rest', async () => {
    await seedCourse('course-1', [TEACHER])
    await seedRoster('course-1', STUDENT_A)

    const result = await importAttendanceForDate(
      dbAs(TEACHER),
      'course-1',
      TEACHER,
      CUSTOM_STATUSES,
      DATE,
      `${STUDENT_A},出席\n${STUDENT_B},出席`,
    )

    expect(result.writtenCount).toBe(1)
    expect(result.skippedNotInRoster).toEqual([STUDENT_B])
    const records = await attendanceForCourse('course-1')
    expect(records.map((r) => r.studentEmail)).toEqual([STUDENT_A])
  })

  it('creates no session when every line is skipped for not being in the roster', async () => {
    await seedCourse('course-1', [TEACHER])

    const result = await importAttendanceForDate(
      dbAs(TEACHER),
      'course-1',
      TEACHER,
      CUSTOM_STATUSES,
      DATE,
      `${STUDENT_A},出席`,
    )

    expect(result).toEqual({ writtenCount: 0, skippedNotInRoster: [STUDENT_A], sessionId: null })
    await expect(listSessionsForCourse(dbAs(TEACHER), 'course-1')).resolves.toEqual([])
  })

  it('writes nothing and throws AttendanceImportValidationError when any line has a hard error', async () => {
    await seedCourse('course-1', [TEACHER])
    await seedRoster('course-1', STUDENT_A)

    await expect(
      importAttendanceForDate(
        dbAs(TEACHER),
        'course-1',
        TEACHER,
        CUSTOM_STATUSES,
        DATE,
        `${STUDENT_A},出席\n${STUDENT_A},請假`,
      ),
    ).rejects.toBeInstanceOf(AttendanceImportValidationError)

    expect(await attendanceForCourse('course-1')).toEqual([])
    await expect(listSessionsForCourse(dbAs(TEACHER), 'course-1')).resolves.toEqual([])
  })

  it('denies a non-course-teacher from importing', async () => {
    await seedCourse('course-1', [TEACHER])
    await seedRoster('course-1', STUDENT_A)

    await assertFails(
      importAttendanceForDate(dbAs(OTHER_TEACHER), 'course-1', OTHER_TEACHER, CUSTOM_STATUSES, DATE, `${STUDENT_A},出席`),
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — `importAttendanceForDate` and `AttendanceImportValidationError` don't exist yet.

- [ ] **Step 3: Implement `importAttendanceForDate` and `AttendanceImportValidationError`**

Append to `src/firebase/attendanceImportService.ts` (add `doc`, `writeBatch`, and `type Firestore` to a new `firebase/firestore` import, plus the two sibling-module imports):

```ts
import { doc, type Firestore, writeBatch } from 'firebase/firestore'
import { attendanceDocId } from './attendanceDocId'
import { createImportSession } from './sessionsService'
import { listRoster } from './rosterService'

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:rules`
Expected: PASS — all 5 tests above, plus every pre-existing rules test in the suite (regression check).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — unit tests (Task 2) and rules tests (Tasks 1 and 3) all green together.

- [ ] **Step 6: Commit**

```bash
git add src/firebase/attendanceImportService.ts src/firebase/attendanceImportService.rules.test.ts
git commit -m "feat: add importAttendanceForDate orchestration for attendance import

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: UI panel in course settings

**Files:**
- Create: `src/AttendanceImportView.tsx`
- Modify: `src/CourseManager.tsx:1-16` (imports), `src/CourseManager.tsx:313-320` (settings-grid)

**Interfaces:**
- Consumes: `importAttendanceForDate`, `AttendanceImportValidationError`, `AttendanceImportLineError` from `./firebase/attendanceImportService` (Task 3); `statusLabel` from `./attendanceStatusLabels`; `describeError` from `./errors`; `db` from `./firebase/config`.
- Produces: `AttendanceImportView({ courseId, teacherEmail, customStatuses }: { courseId: string; teacherEmail: string; customStatuses: string[] })` — a `.panel` component, rendered by `CourseSettings`.

This task has no automated test: the codebase has no established pattern for testing these settings-page panel components (`RosterManager`, `AttendanceExportView`, `StatusOptionsManager` are all untested — see `src/CourseManager.tsx` and `src/AttendanceExportView.tsx`, and the only `@testing-library/react` usage in the repo is a hook test). Step 3 below is manual browser verification instead, matching how the rest of this settings page is verified.

- [ ] **Step 1: Create the component**

Create `src/AttendanceImportView.tsx`:

```tsx
import { useState } from 'react'
import { statusLabel } from './attendanceStatusLabels'
import { describeError } from './errors'
import {
  AttendanceImportValidationError,
  importAttendanceForDate,
  type AttendanceImportLineError,
} from './firebase/attendanceImportService'
import { db } from './firebase/config'

interface AttendanceImportViewProps {
  courseId: string
  teacherEmail: string
  customStatuses: string[]
}

const REASON_LABELS: Record<AttendanceImportLineError['reason'], string> = {
  malformed: '格式錯誤（不是「email,狀態」的格式）',
  'invalid-status': '狀態文字不是這門課目前的選項之一',
  'duplicate-email': '這個 email 在匯入內容中重複出現',
}

interface ImportSummary {
  writtenCount: number
  skippedNotInRoster: string[]
}

export function AttendanceImportView({ courseId, teacherEmail, customStatuses }: AttendanceImportViewProps) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [pasteText, setPasteText] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [lineErrors, setLineErrors] = useState<AttendanceImportLineError[] | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const statusOptionsText = [statusLabel('present'), ...customStatuses, statusLabel('absent')].join('、')

  async function handleImport(event: React.FormEvent) {
    event.preventDefault()
    if (!pasteText.trim()) return
    setError(null)
    setLineErrors(null)
    setSummary(null)
    setIsImporting(true)
    try {
      const result = await importAttendanceForDate(db, courseId, teacherEmail, customStatuses, date, pasteText)
      setSummary({ writtenCount: result.writtenCount, skippedNotInRoster: result.skippedNotInRoster })
      setPasteText('')
    } catch (err) {
      if (err instanceof AttendanceImportValidationError) {
        setLineErrors(err.lineErrors)
      } else {
        setError(describeError(err))
      }
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="panel">
      <h4>匯入點名記錄</h4>
      <p style={{ marginTop: 0, fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>
        用來補登忘記點名的某一天。每行「email,狀態」，狀態要跟目前的出席狀態選項文字完全相同（{statusOptionsText}）。
      </p>

      <form onSubmit={handleImport}>
        <label>
          日期
          <input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          貼上點名記錄（每行「email,狀態」）
          <textarea
            rows={6}
            placeholder={'student1@example.com,出席\nstudent2@example.com,請假'}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={isImporting}>
          {isImporting ? '匯入中…' : '匯入'}
        </button>
      </form>

      {summary && (
        <div role="status" className="status-message status-message--success">
          <p>成功匯入 {summary.writtenCount} 筆。</p>
          {summary.skippedNotInRoster.length > 0 && (
            <>
              <p>以下 email 不在選課名單中，已略過：</p>
              <ul className="list">
                {summary.skippedNotInRoster.map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {lineErrors && (
        <div role="alert" className="status-message status-message--error">
          <p>匯入內容有錯誤，尚未寫入任何記錄，請修正後再試一次：</p>
          <ul className="list">
            {lineErrors.map((lineError) => (
              <li key={lineError.lineNumber}>
                第 {lineError.lineNumber} 行「{lineError.line}」：{REASON_LABELS[lineError.reason]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="status-message status-message--error">
          {error}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `CourseSettings`**

In `src/CourseManager.tsx`, add the import alongside the other local imports (near line 2-16):

```ts
import { AttendanceImportView } from './AttendanceImportView'
```

Then in the `.settings-grid` (currently lines 313-320), add the new panel right after `RosterManager` and before `AttendanceExportView`:

```tsx
          <RosterManager courseId={course.id} />
          <AttendanceImportView
            courseId={course.id}
            teacherEmail={teacherEmail}
            customStatuses={course.customStatuses ?? DEFAULT_CUSTOM_STATUSES}
          />
          <AttendanceExportView courseId={course.id} courseName={course.name} />
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`

In the browser:
1. Sign in as a course teacher, open a course, go to 課程設定.
2. Confirm the new 「匯入點名記錄」panel appears between 選課名單 and 匯出出席資料.
3. Pick a past date, paste `<a roster email>,出席` plus one line with an email not on the roster, submit — confirm the success message shows the written count and lists the skipped email.
4. Submit again with a duplicate email on two lines — confirm nothing is written and the per-line error list appears.
5. Submit with an invalid status word — confirm the same per-line error behavior.
6. Open 出席紀錄 for the course and confirm the imported session/records show up with the chosen date.

- [ ] **Step 4: Run the full test suite once more**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/AttendanceImportView.tsx src/CourseManager.tsx
git commit -m "feat: add 匯入點名記錄 panel to course settings

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
