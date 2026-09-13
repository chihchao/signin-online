import { useState } from 'react'
import { describeAttendanceResult, isRetryable } from './attendanceMessages'
import { describeError } from './errors'
import { db } from './firebase/config'
import { submitAttendance, type SubmitAttendanceResult } from './firebase/attendanceService'

interface CheckinViewProps {
  sessionId: string
  tokenId: string
  studentEmail: string
}

// Presentational only — doesn't change what any result means, just how
// loud/reassuring it should look. 'success' reads as a clear win;
// already-checked-in/already-recorded aren't errors, just "nothing to
// do here"; everything else needs the student's attention.
function statusVariant(result: SubmitAttendanceResult): 'success' | 'info' | 'error' {
  switch (result.status) {
    case 'success':
      return 'success'
    case 'already-checked-in':
    case 'already-recorded':
      return 'info'
    case 'not-in-roster':
    case 'session-ended':
    case 'expired':
      return 'error'
  }
}

export function CheckinView({ sessionId, tokenId, studentEmail }: CheckinViewProps) {
  const [result, setResult] = useState<SubmitAttendanceResult | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setIsSubmitting(true)
    setError(null)
    try {
      setResult(await submitAttendance(db, sessionId, tokenId, studentEmail))
    } catch (err) {
      setError(describeError(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="card" style={{ width: '100%', maxWidth: 420 }}>
      <h2>課堂簽到</h2>
      <p style={{ color: 'var(--color-muted-foreground)' }}>{studentEmail}</p>

      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={handleSubmit}
        disabled={isSubmitting || (result !== null && !isRetryable(result))}
      >
        {isSubmitting ? '送出中…' : '送出簽到'}
      </button>

      {result && (
        <p role="status" className={`status-message status-message--${statusVariant(result)}`} style={{ marginTop: 'var(--space-4)' }}>
          {describeAttendanceResult(result)}
        </p>
      )}
      {error && (
        <p role="alert" className="status-message status-message--error" style={{ marginTop: 'var(--space-4)' }}>
          {error}
        </p>
      )}
    </section>
  )
}
