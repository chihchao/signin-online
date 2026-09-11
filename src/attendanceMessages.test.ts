import { describe, expect, it } from 'vitest'
import { describeAttendanceResult } from './attendanceMessages'

describe('describeAttendanceResult', () => {
  it.each([
    ['success', '簽到成功！'],
    ['already-checked-in', '已完成簽到'],
    ['not-in-roster', '你不在這堂課的名冊中，請切換帳號'],
    ['session-ended', '點名已結束，無法簽到'],
    ['expired', 'QR Code 已過期，請重新掃描目前畫面上的 QR Code'],
  ] as const)('describes %s with a distinct, non-empty message', (status, expected) => {
    expect(describeAttendanceResult({ status })).toBe(expected)
  })

  it('gives every status a unique message', () => {
    const statuses = ['success', 'already-checked-in', 'not-in-roster', 'session-ended', 'expired'] as const
    const messages = statuses.map((status) => describeAttendanceResult({ status }))
    expect(new Set(messages).size).toBe(statuses.length)
  })
})
