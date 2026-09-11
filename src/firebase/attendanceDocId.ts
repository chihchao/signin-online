// Must stay in sync with isValidAttendanceDocId() in firestore.rules —
// that side can't import this (rules aren't JS), so it re-implements
// the same `${sessionId}_${studentEmail}` convention independently.
export function attendanceDocId(sessionId: string, studentEmail: string): string {
  return `${sessionId}_${studentEmail}`
}
