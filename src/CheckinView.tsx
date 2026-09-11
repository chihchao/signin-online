import { useState } from 'react'
import { describeAttendanceResult } from './attendanceMessages'
import { describeError } from './errors'
import { db } from './firebase/config'
import { submitAttendance, type SubmitAttendanceResult } from './firebase/attendanceService'

interface CheckinViewProps {
  sessionId: string
  tokenId: string
  studentEmail: string
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
    <section>
      <h2>課堂簽到</h2>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting || (result !== null && result.status !== 'not-in-roster')}
      >
        送出簽到
      </button>

      {result && <p role="status">{describeAttendanceResult(result)}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
