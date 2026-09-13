import { useState } from 'react'
import { buildAttendanceExportCsv } from './attendanceExportCsv'
import { describeError } from './errors'
import { db } from './firebase/config'
import { listAttendanceForExport } from './firebase/attendanceService'

interface AttendanceExportViewProps {
  courseId: string
  courseName: string
}

function startOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}

function endOfDayExclusive(dateStr: string): Date {
  const date = startOfDay(dateStr)
  date.setDate(date.getDate() + 1)
  return date
}

function downloadCsv(filename: string, csv: string) {
  // A UTF-8 BOM so Excel (notoriously locale-guessing on plain UTF-8)
  // renders the Chinese headers/labels correctly instead of mojibake.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function AttendanceExportView({ courseId, courseName }: AttendanceExportViewProps) {
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (startDate > endDate) {
      setError('起始日期不能晚於結束日期')
      return
    }
    setIsExporting(true)
    try {
      const rows = await listAttendanceForExport(
        db,
        courseId,
        startOfDay(startDate),
        endOfDayExclusive(endDate),
      )
      const csv = buildAttendanceExportCsv(courseName, rows)
      downloadCsv(`${courseName}-${startDate}-${endDate}.csv`, csv)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <section>
      <h4>匯出出席資料</h4>
      <form onSubmit={handleExport}>
        <label>
          起始日期
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label>
          結束日期
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
        <button type="submit" disabled={isExporting}>
          匯出 CSV
        </button>
      </form>

      {error && <p role="alert">{error}</p>}
    </section>
  )
}
