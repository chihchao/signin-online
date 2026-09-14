import { describe, expect, it } from 'vitest'
import { orderedStatusOptions, statusLabel, statusVariant } from './attendanceStatusLabels'

describe('statusLabel', () => {
  it('translates the fixed system statuses to Chinese', () => {
    expect(statusLabel('present')).toBe('出席')
    expect(statusLabel('absent')).toBe('缺席')
  })

  it('returns a custom status as-is, since its text is already the label', () => {
    expect(statusLabel('事假')).toBe('事假')
  })
})

describe('statusVariant', () => {
  it('reads present as success and absent as error', () => {
    expect(statusVariant('present')).toBe('success')
    expect(statusVariant('absent')).toBe('error')
  })

  it('reads every custom status as neutral', () => {
    expect(statusVariant('事假')).toBe('neutral')
  })
})

describe('orderedStatusOptions', () => {
  it('places present first and absent last, with the custom statuses in between in order', () => {
    expect(orderedStatusOptions(['請假', '公假'])).toEqual(['present', '請假', '公假', 'absent'])
  })

  it('still includes present/absent when there are no custom statuses', () => {
    expect(orderedStatusOptions([])).toEqual(['present', 'absent'])
  })
})
