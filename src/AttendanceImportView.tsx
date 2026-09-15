import { useState } from 'react'
import { statusLabel } from './attendanceStatusLabels'
import { formatDate } from './dateFormat'
import { describeError } from './errors'
import {
  AttendanceImportValidationError,
  importAttendanceForDate,
  type AttendanceImportLineError,
} from './firebase/attendanceImportService'
import { db } from './firebase/config'

interface AttendanceImportViewProps {
  courseId: string
  teacherEmail: string
  customStatuses: string[]
}

const REASON_LABELS: Record<AttendanceImportLineError['reason'], string> = {
  malformed: '格式錯誤（不是「email,狀態」的格式）',
  'invalid-status': '狀態文字不是這門課目前的選項之一',
  'duplicate-email': '這個 email 在匯入內容中重複出現',
}

interface ImportSummary {
  writtenCount: number
  skippedNotInRoster: string[]
}

export function AttendanceImportView({ courseId, teacherEmail, customStatuses }: AttendanceImportViewProps) {
  const today = formatDate(new Date())
  const [date, setDate] = useState(today)
  const [pasteText, setPasteText] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [lineErrors, setLineErrors] = useState<AttendanceImportLineError[] | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const statusOptionsText = [statusLabel('present'), ...customStatuses, statusLabel('absent')].join('、')

  async function handleImport(event: React.FormEvent) {
    event.preventDefault()
    if (!pasteText.trim()) return
    setError(null)
    setLineErrors(null)
    setSummary(null)
    setIsImporting(true)
    try {
      const result = await importAttendanceForDate(db, courseId, teacherEmail, customStatuses, date, pasteText)
      setSummary({ writtenCount: result.writtenCount, skippedNotInRoster: result.skippedNotInRoster })
      setPasteText('')
    } catch (err) {
      if (err instanceof AttendanceImportValidationError) {
        setLineErrors(err.lineErrors)
      } else {
        setError(describeError(err))
      }
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="panel">
      <h4>匯入點名記錄</h4>
      <p style={{ marginTop: 0, fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>
        用來補登忘記點名的某一天。每行「email,狀態」，狀態要跟目前的出席狀態選項文字完全相同（{statusOptionsText}）。
      </p>

      <form onSubmit={handleImport}>
        <label>
          日期
          <input type="date" value={date} max={today} required onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          貼上點名記錄（每行「email,狀態」）
          <textarea
            rows={6}
            placeholder={'student1@example.com,出席\nstudent2@example.com,請假'}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={isImporting}>
          {isImporting ? '匯入中…' : '匯入'}
        </button>
      </form>

      {summary && (
        <div role="status" className="status-message status-message--success">
          <p>成功匯入 {summary.writtenCount} 筆。</p>
          {summary.skippedNotInRoster.length > 0 && (
            <>
              <p>以下 email 不在選課名單中，已略過：</p>
              <ul className="list">
                {summary.skippedNotInRoster.map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {lineErrors && (
        <div role="alert" className="status-message status-message--error">
          <p>匯入內容有錯誤，尚未寫入任何記錄，請修正後再試一次：</p>
          <ul className="list">
            {lineErrors.map((lineError) => (
              <li key={lineError.lineNumber}>
                第 {lineError.lineNumber} 行「{lineError.line}」：{REASON_LABELS[lineError.reason]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="status-message status-message--error">
          {error}
        </p>
      )}
    </div>
  )
}
