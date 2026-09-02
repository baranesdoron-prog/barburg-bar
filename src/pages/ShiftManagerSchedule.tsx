import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import {
  toDateStr,
  parseDateStr,
  sundaysInYear,
  EARLIEST_WEEK_START,
  weekLabelFormatter,
  YEAR_OPTIONS,
} from '@/lib/weeklyChecklist'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ShiftManagerAssignment } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

interface ShiftManagerEmployee {
  id: string
  full_name: string
}

const currentYear = new Date().getFullYear()

function WeekRow({
  week,
  assignedEmployeeId,
  employees,
  onAssigned,
}: {
  week: string
  assignedEmployeeId: string
  employees: ShiftManagerEmployee[]
  onAssigned: () => void
}) {
  const [selected, setSelected] = useState(assignedEmployeeId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSelected(assignedEmployeeId)
  }, [assignedEmployeeId])

  async function handleApprove() {
    if (!selected) return
    setSaving(true)
    setError(null)
    const { error: assignError } = await supabase.rpc('set_weekly_shift_manager', {
      p_week_start: week,
      p_employee_id: selected,
    })
    setSaving(false)
    if (assignError) {
      setError(assignError.message)
      return
    }
    onAssigned()
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border p-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{weekLabelFormatter.format(parseDateStr(week))}</span>
        <div className="flex items-center gap-2">
          <select
            className={cn(selectClass, 'w-40', !assignedEmployeeId && 'border-amber-500')}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">— לא שובץ —</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.full_name}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!selected || selected === assignedEmployeeId || saving} onClick={handleApprove}>
            אישור
          </Button>
          <Link to={`/weekly-checklist?week=${week}`} className="text-muted-foreground text-xs hover:underline">
            לרשימת המשימות
          </Link>
        </div>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

export function ShiftManagerSchedule() {
  const [year, setYear] = useState(currentYear)
  const [employees, setEmployees] = useState<ShiftManagerEmployee[]>([])
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map())

  const weeks = sundaysInYear(year)
    .map(toDateStr)
    .filter((w) => w >= EARLIEST_WEEK_START)

  async function load() {
    if (weeks.length === 0) {
      setEmployees([])
      setAssignments(new Map())
      return
    }

    const [employeesRes, assignmentsRes] = await Promise.all([
      supabase.rpc('list_shift_manager_employees'),
      supabase
        .from('shift_manager_assignments')
        .select('*')
        .gte('week_start', weeks[0])
        .lte('week_start', weeks[weeks.length - 1]),
    ])
    setEmployees((employeesRes.data as ShiftManagerEmployee[]) ?? [])
    setAssignments(
      new Map(((assignmentsRes.data as ShiftManagerAssignment[]) ?? []).map((a) => [a.week_start, a.employee_id])),
    )
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">שיבוץ אחראי משמרת לפי שנה</h1>
        <select className={cn(selectClass, 'w-28')} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">שבועות {year}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {weeks.length === 0 && <p className="text-muted-foreground text-sm">אין שבועות להצגה בשנה זו.</p>}
          {weeks.map((week) => (
            <WeekRow
              key={week}
              week={week}
              assignedEmployeeId={assignments.get(week) ?? ''}
              employees={employees}
              onAssigned={load}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
