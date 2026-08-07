import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { toDateStr, parseDateStr } from '@/lib/weeklyChecklist'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ShiftManagerAssignment } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

const weekLabelFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' })

interface ShiftManagerEmployee {
  id: string
  full_name: string
}

function sundaysInYear(year: number): Date[] {
  const result: Date[] = []
  const d = new Date(year, 0, 1)
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1)
  while (d.getFullYear() === year) {
    result.push(new Date(d))
    d.setDate(d.getDate() + 7)
  }
  return result
}

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2]

export function ShiftManagerSchedule() {
  const [year, setYear] = useState(currentYear)
  const [employees, setEmployees] = useState<ShiftManagerEmployee[]>([])
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map())
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const weeks = sundaysInYear(year).map(toDateStr)

  async function load() {
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

  async function handleAssign(week: string, employeeId: string) {
    if (!employeeId) return
    setSaving(week)
    const { error: assignError } = await supabase.rpc('set_weekly_shift_manager', {
      p_week_start: week,
      p_employee_id: employeeId,
    })
    setSaving(null)
    if (assignError) {
      setError(assignError.message)
      return
    }
    load()
  }

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
          {weeks.map((week) => {
            const assigned = assignments.get(week) ?? ''
            return (
              <div key={week} className="flex items-center justify-between gap-2 text-sm">
                <Link to={`/weekly-checklist?week=${week}`} className="hover:underline">
                  {weekLabelFormatter.format(parseDateStr(week))}
                </Link>
                <select
                  className={cn(selectClass, 'w-40', !assigned && 'border-amber-500')}
                  value={assigned}
                  disabled={saving === week}
                  onChange={(e) => handleAssign(week, e.target.value)}
                >
                  <option value="">— לא שובץ —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
