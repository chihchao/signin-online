import { describe, expect, it } from 'vitest'
import { buildAttendanceExportCsv } from './attendanceExportCsv'

describe('buildAttendanceExportCsv', () => {
  it('builds a header row plus one row per record, using the Chinese status label', () => {
    const csv = buildAttendanceExportCsv('資料結構', [
      { studentEmail: 'a@example.com', status: 'present', timestamp: new Date('2026-09-13T01:00:00') },
      { studentEmail: 'b@example.com', status: 'leave', timestamp: new Date('2026-09-13T01:00:00') },
    ])

    expect(csv).toBe(
      [
        '學生 email,課程名稱,日期,狀態',
        'a@example.com,資料結構,2026-09-13,出席',
        'b@example.com,資料結構,2026-09-13,請假',
      ].join('\r\n'),
    )
  })

  it('leaves the date column blank when timestamp is null', () => {
    const csv = buildAttendanceExportCsv('資料結構', [
      { studentEmail: 'a@example.com', status: 'absent', timestamp: null },
    ])

    expect(csv).toBe(['學生 email,課程名稱,日期,狀態', 'a@example.com,資料結構,,缺席'].join('\r\n'))
  })

  it('quotes and escapes fields containing a comma or double quote', () => {
    const csv = buildAttendanceExportCsv('C, "advanced"', [
      { studentEmail: 'a@example.com', status: 'present', timestamp: null },
    ])

    expect(csv).toBe(
      ['學生 email,課程名稱,日期,狀態', 'a@example.com,"C, ""advanced""",,出席'].join('\r\n'),
    )
  })

  it('returns just the header row for an empty list', () => {
    expect(buildAttendanceExportCsv('資料結構', [])).toBe('學生 email,課程名稱,日期,狀態')
  })
})
