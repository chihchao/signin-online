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
