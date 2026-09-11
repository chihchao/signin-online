import type { SubmitAttendanceResult } from './firebase/attendanceService'

export function describeAttendanceResult(result: SubmitAttendanceResult): string {
  switch (result.status) {
    case 'success':
      return '簽到成功！'
    case 'already-checked-in':
      return '已完成簽到'
    case 'not-in-roster':
      return '你不在這堂課的名冊中，請切換帳號'
    case 'session-ended':
      return '點名已結束，無法簽到'
    case 'expired':
      return 'QR Code 已過期，請重新掃描目前畫面上的 QR Code'
  }
}

// Whether retrying with the same sessionId/tokenId from the current
// page could plausibly succeed. Only 'not-in-roster' is retryable —
// switching Google account is a legitimate in-page recovery; every
// other status is tied to this specific link/token and can only be
// fixed by rescanning a fresh QR code (or the class is simply over).
export function isRetryable(result: SubmitAttendanceResult): boolean {
  switch (result.status) {
    case 'not-in-roster':
      return true
    case 'success':
    case 'already-checked-in':
    case 'session-ended':
    case 'expired':
      return false
  }
}
