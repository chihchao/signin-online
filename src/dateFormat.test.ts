import { describe, expect, it } from 'vitest'
import { formatDate } from './dateFormat'

describe('formatDate', () => {
  it('formats a date as YYYY-MM-DD, zero-padding month and day', () => {
    expect(formatDate(new Date('2026-09-03T01:00:00'))).toBe('2026-09-03')
  })

  it('returns an empty string for null', () => {
    expect(formatDate(null)).toBe('')
  })
})
