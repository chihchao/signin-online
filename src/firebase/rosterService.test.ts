import { describe, expect, it } from 'vitest'
import { parseEmailList } from './rosterService'

describe('parseEmailList', () => {
  it('splits multi-line text into a list of emails', () => {
    expect(parseEmailList('a@example.com\nb@example.com\nc@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ])
  })

  it('trims whitespace and drops blank lines', () => {
    expect(parseEmailList('  a@example.com  \n\n\tb@example.com\n   \n')).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('deduplicates repeated emails while preserving first-seen order', () => {
    expect(parseEmailList('a@example.com\nb@example.com\na@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('handles Windows-style CRLF line endings', () => {
    expect(parseEmailList('a@example.com\r\nb@example.com\r\n')).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('returns an empty list for empty or whitespace-only input', () => {
    expect(parseEmailList('')).toEqual([])
    expect(parseEmailList('   \n  \n')).toEqual([])
  })

  it('lowercases emails so casing differences do not create duplicate roster entries', () => {
    expect(parseEmailList('Student@Example.com\nstudent@example.com')).toEqual([
      'student@example.com',
    ])
  })

  it('silently drops lines that are not a plausible email address', () => {
    expect(parseEmailList('a@example.com\nnot-an-email\nfoo/bar@example.com\nb@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })
})
