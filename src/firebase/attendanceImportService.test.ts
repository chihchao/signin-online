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
