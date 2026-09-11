import type { AttendanceStatus } from './firebase/attendanceService'

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: '出席',
  leave: '請假',
  'official-leave': '公假',
  exempt: '免簽',
  absent: '缺席',
}

export const ALL_STATUSES = Object.keys(STATUS_LABELS) as AttendanceStatus[]
