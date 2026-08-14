import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { shiftTypeLabel } from '@/lib/shiftLabels'
import { formatDateTime } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ShiftReportRow } from '@/lib/types'

export function Reports() {
  const [reports, setReports] = useState<ShiftReportRow[] | null>(null)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    supabase
      .from('shift_reports')
      .select('*')
      .order('generated_at', { ascending: false })
      .then(({ data }) => setReports((data as ShiftReportRow[]) ?? []))
  }, [])

  if (reports === null) return null

  const filtered = reports.filter((report) => {
    const shift = report.snapshot.shift
    if (search.trim() && !shift.shift_type.includes(search.trim())) return false
    if (dateFrom && new Date(shift.start_time) < new Date(dateFrom)) return false
    if (dateTo && new Date(shift.start_time) > new Date(`${dateTo}T23:59:59`)) return false
    return true
  })

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">דוחות</h1>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="report-search">חיפוש לפי סוג משמרת</Label>
            <Input id="report-search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="report-from">מתאריך</Label>
              <Input
                id="report-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="report-to">עד תאריך</Label>
              <Input id="report-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {filtered.length} דוחות
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {filtered.length === 0 && <p className="text-muted-foreground text-sm">אין דוחות תואמים.</p>}
          {filtered.map((report) => (
            <Link
              key={report.id}
              to={`/shifts/${report.shift_id}/report`}
              className="hover:bg-accent flex flex-col rounded-md border p-3 text-sm transition-colors"
            >
              <span className="font-medium">{shiftTypeLabel(report.snapshot.shift.shift_type)}</span>
              <span className="text-muted-foreground">
                {formatDateTime(report.snapshot.shift.start_time)}
              </span>
              <span className="text-muted-foreground text-xs">
                נוצר: {formatDateTime(report.generated_at)}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
