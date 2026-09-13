import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { AttendanceRecordView } from './AttendanceRecordView'
import { buildCheckinUrl } from './checkinUrl'
import { describeError } from './errors'
import { db } from './firebase/config'
import { createToken, endSession, startOrResumeSession } from './firebase/sessionsService'

const TOKEN_REFRESH_INTERVAL_MS = 15_000

interface ProjectionViewProps {
  courseId: string
  courseName: string
  teacherEmail: string
  onClose: () => void
}

export function ProjectionView({ courseId, courseName, teacherEmail, onClose }: ProjectionViewProps) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isEnding, setIsEnding] = useState(false)
  const [hasEnded, setHasEnded] = useState(false)
  const [isManagingAttendance, setIsManagingAttendance] = useState(false)

  useEffect(() => {
    let cancelled = false

    startOrResumeSession(db, courseId, teacherEmail)
      .then((id) => {
        if (!cancelled) setSessionId(id)
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err))
      })

    return () => {
      cancelled = true
    }
  }, [courseId, teacherEmail])

  useEffect(() => {
    if (!sessionId || hasEnded) return

    let cancelled = false

    async function refreshToken() {
      try {
        const tokenId = await createToken(db, sessionId!)
        if (cancelled) return
        const url = buildCheckinUrl(window.location.origin, sessionId!, tokenId)
        const dataUrl = await QRCode.toDataURL(url)
        if (!cancelled) {
          setQrDataUrl(dataUrl)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(describeError(err))
      }
    }

    refreshToken()
    const intervalId = setInterval(refreshToken, TOKEN_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [sessionId, hasEnded])

  async function handleEndSession() {
    if (!sessionId) return
    if (!window.confirm('結束點名後，學生將無法再簽到，且尚未簽到的學生會被標記為缺席。確定要結束嗎？')) {
      return
    }
    setIsEnding(true)
    setError(null)
    try {
      await endSession(db, sessionId, courseId)
      setHasEnded(true)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setIsEnding(false)
    }
  }

  if (isManagingAttendance) {
    return <AttendanceRecordView courseId={courseId} onClose={() => setIsManagingAttendance(false)} />
  }

  return (
    <section className="card">
      <h3>{courseName} — 投影頁</h3>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isEnding}>
          關閉投影頁
        </button>
        {!hasEnded && (
          <button type="button" className="btn btn-secondary" onClick={handleEndSession} disabled={!sessionId || isEnding}>
            {isEnding ? '結束中…' : '結束點名'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setIsManagingAttendance(true)}
          disabled={!sessionId || isEnding}
        >
          管理出席紀錄
        </button>
      </div>

      {error && (
        <p role="alert" className="status-message status-message--error">
          {error}
        </p>
      )}

      {hasEnded ? (
        <p className="status-message status-message--info">點名已結束</p>
      ) : (
        qrDataUrl && (
          <div className="qr-frame">
            <img src={qrDataUrl} alt="簽到 QR Code" />
          </div>
        )
      )}
    </section>
  )
}
