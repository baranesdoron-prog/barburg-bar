import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { attendanceStatusLabels } from '@/lib/shiftLabels'
import { journalCategoryLabels } from '@/lib/journalLabels'
import { formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ShiftReportRow } from '@/lib/types'

export function ShiftReport() {
  const { id } = useParams()
  const [report, setReport] = useState<ShiftReportRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('shift_reports')
      .select('*')
      .eq('shift_id', id)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError || !data) {
          setError(fetchError?.message ?? 'הדוח לא נמצא')
          return
        }
        setReport(data as ShiftReportRow)
      })
  }, [id])

  if (error) return <p className="text-destructive text-center text-sm">{error}</p>
  if (!report) return null

  const { snapshot } = report

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>דוח סגירת משמרת — {snapshot.shift.shift_type}</CardTitle>
          <CardDescription>
            {formatDateTime(snapshot.shift.start_time)} – {formatDateTime(snapshot.shift.end_time)}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <p>נוצר: {formatDateTime(report.generated_at)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">נוכחות</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {snapshot.attendance.length === 0 && (
            <p className="text-muted-foreground text-sm">אין נתוני נוכחות.</p>
          )}
          {snapshot.attendance.map((a, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span>{a.employee_name}</span>
              <span className="text-muted-foreground">
                {a.status ? attendanceStatusLabels[a.status] : '—'}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">יומן משמרת</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {snapshot.journal_entries.length === 0 && (
            <p className="text-muted-foreground text-sm">אין רשומות יומן.</p>
          )}
          {snapshot.journal_entries.map((entry, i) => (
            <div key={i} className="rounded-md border p-2 text-sm">
              <p className="font-medium">{journalCategoryLabels[entry.category]}</p>
              <p>{entry.description}</p>
              {entry.requires_follow_up && <p className="text-destructive">דורש מעקב</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ספירת מלאי</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {snapshot.inventory_counts.length === 0 && (
            <p className="text-muted-foreground text-sm">אין נתוני מלאי.</p>
          )}
          {snapshot.inventory_counts.map((c, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span>{c.item_name}</span>
              <span className="text-muted-foreground">
                {c.quantity_counted} {c.unit}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button asChild variant="ghost">
          <Link to={`/shifts/${id}`}>חזרה למשמרת</Link>
        </Button>
      </div>
    </div>
  )
}
