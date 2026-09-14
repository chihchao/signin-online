import { statusLabel } from './attendanceStatusLabels'
import { formatDate } from './dateFormat'
import type { AttendanceExportRow } from './firebase/attendanceService'

const HEADER = ['學生 email', '課程名稱', '日期', '狀態']

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function buildAttendanceExportCsv(courseName: string, rows: AttendanceExportRow[]): string {
  const lines = [HEADER.join(',')]
  for (const row of rows) {
    lines.push(
      [row.studentEmail, courseName, formatDate(row.timestamp), statusLabel(row.status)]
        .map(escapeCsvField)
        .join(','),
    )
  }
  return lines.join('\r\n')
}
