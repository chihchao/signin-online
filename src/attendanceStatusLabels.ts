// 'present'/'absent' are the fixed system statuses (self-check-in and
// endSession's batch-absent pass write them literally — see
// firestore.rules' isValidAttendanceStatus) and are the only statuses
// that need translating: every other status is a course's own
// customStatuses entry, whose text a teacher chose themselves and
// which is already the label. The legacy 'leave'/'official-leave'/
// 'exempt' keys predate per-course customStatuses; kept here purely so
// existing records from before this feature still display in Chinese
// instead of their raw internal key.
const SYSTEM_STATUS_LABELS: Record<string, string> = {
  present: '出席',
  absent: '缺席',
  leave: '請假',
  'official-leave': '公假',
  exempt: '免簽',
}

export function statusLabel(status: string): string {
  return SYSTEM_STATUS_LABELS[status] ?? status
}

// Presentational grouping only — doesn't change what any status means,
// just how it reads visually (badge color). Every non-system status
// (i.e. every course-defined custom status) reads as neutral.
export function statusVariant(status: string): 'success' | 'neutral' | 'error' {
  if (status === 'present') return 'success'
  if (status === 'absent') return 'error'
  return 'neutral'
}

// The full set of status values a teacher can manually pick for a
// student, in display order: 出席 first, the course's own custom
// statuses in the order the teacher defined them, 缺席 last.
export function orderedStatusOptions(customStatuses: string[]): string[] {
  return ['present', ...customStatuses, 'absent']
}
