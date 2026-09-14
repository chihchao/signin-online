import { describe, expect, it } from 'vitest'
import { parseRosterList } from './rosterService'

describe('parseRosterList', () => {
  it('splits multi-line "email,name" text into roster entries', () => {
    expect(parseRosterList('a@example.com,Alice\nb@example.com,Bob')).toEqual([
      { email: 'a@example.com', name: 'Alice' },
      { email: 'b@example.com', name: 'Bob' },
    ])
  })

  it('defaults name to an empty string when a line has no comma', () => {
    expect(parseRosterList('a@example.com')).toEqual([{ email: 'a@example.com', name: '' }])
  })

  it('trims whitespace around both email and name, and drops blank lines', () => {
    expect(parseRosterList('  a@example.com , Alice  \n\n\tb@example.com,Bob\n   \n')).toEqual([
      { email: 'a@example.com', name: 'Alice' },
      { email: 'b@example.com', name: 'Bob' },
    ])
  })

  it('deduplicates repeated emails while preserving first-seen order and name', () => {
    expect(parseRosterList('a@example.com,Alice\nb@example.com,Bob\na@example.com,Alice2')).toEqual([
      { email: 'a@example.com', name: 'Alice' },
      { email: 'b@example.com', name: 'Bob' },
    ])
  })

  it('handles Windows-style CRLF line endings', () => {
    expect(parseRosterList('a@example.com,Alice\r\nb@example.com,Bob\r\n')).toEqual([
      { email: 'a@example.com', name: 'Alice' },
      { email: 'b@example.com', name: 'Bob' },
    ])
  })

  it('returns an empty list for empty or whitespace-only input', () => {
    expect(parseRosterList('')).toEqual([])
    expect(parseRosterList('   \n  \n')).toEqual([])
  })

  it('lowercases emails so casing differences do not create duplicate roster entries', () => {
    expect(parseRosterList('Student@Example.com,Alice\nstudent@example.com,Alice2')).toEqual([
      { email: 'student@example.com', name: 'Alice' },
    ])
  })

  it('silently drops lines whose email portion is not a plausible email address', () => {
    expect(
      parseRosterList('a@example.com,Alice\nnot-an-email,Nobody\nfoo/bar@example.com,Nobody\nb@example.com,Bob'),
    ).toEqual([
      { email: 'a@example.com', name: 'Alice' },
      { email: 'b@example.com', name: 'Bob' },
    ])
  })
})
