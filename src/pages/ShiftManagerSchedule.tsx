import { useEffect, useState } from 'react'

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
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ShiftManagerAssignment } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

interface Employee {
  id: string
  full_name: string
}

const currentYear = new Date().getFullYear()

function WeekRow({
  week,
  assignment,
  shiftManagers,
  areaManagers,
  bartenderEligible,
  onSaved,
}: {
  week: string
  assignment: ShiftManagerAssignment | undefined
  shiftManagers: Employee[]
  areaManagers: Employee[]
  bartenderEligible: Employee[]
  onSaved: () => void
}) {
  const [shiftManagerId, setShiftManagerId] = useState(assignment?.employee_id ?? '')
  const [areaManagerId, setAreaManagerId] = useState(assignment?.area_manager_id ?? '')
  const [bartenderIds, setBartenderIds] = useState<string[]>(assignment?.bartender_ids ?? [])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setShiftManagerId(assignment?.employee_id ?? '')
    setAreaManagerId(assignment?.area_manager_id ?? '')
    setBartenderIds(assignment?.bartender_ids ?? [])
  }, [assignment])

  async function save(next: { shiftManagerId: string; areaManagerId: string; bartenderIds: string[] }) {
    setError(null)
    const { error: saveError } = await supabase.rpc('set_weekly_team', {
      p_week_start: week,
      p_shift_manager_id: next.shiftManagerId || null,
      p_area_manager_id: next.areaManagerId || null,
      p_bartender_ids: next.bartenderIds.length > 0 ? next.bartenderIds : null,
    })

    if (saveError) {
      setError(saveError.message)
      return
    }

    onSaved()
  }

  function handleShiftManagerChange(value: string) {
    setShiftManagerId(value)
    save({ shiftManagerId: value, areaManagerId, bartenderIds })
  }

  function handleAreaManagerChange(value: string) {
    setAreaManagerId(value)
    save({ shiftManagerId, areaManagerId: value, bartenderIds })
  }

  function handleBartenderToggle(employeeId: string, checked: boolean) {
    const next = checked ? [...bartenderIds, employeeId] : bartenderIds.filter((id) => id !== employeeId)
    setBartenderIds(next)
    save({ shiftManagerId, areaManagerId, bartenderIds: next })
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3 text-sm">
      <span className="font-medium">{weekLabelFormatter.format(parseDateStr(week))}</span>

      <div className="flex flex-col gap-1">
        <Label className="text-muted-foreground text-xs">מנהל/ת בר</Label>
        <select
          className={cn(selectClass, !shiftManagerId && 'border-amber-500')}
          value={shiftManagerId}
          onChange={(e) => handleShiftManagerChange(e.target.value)}
        >
          <option value="">— לא שובץ —</option>
          {shiftManagers.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-muted-foreground text-xs">אחראי/ת מתחם</Label>
        <select className={selectClass} value={areaManagerId} onChange={(e) => handleAreaManagerChange(e.target.value)}>
          <option value="">— לא שובץ —</option>
          {areaManagers.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-muted-foreground text-xs">ברמנים/יות (עד 3)</Label>
        <div className="flex flex-col gap-1">
          {bartenderEligible.map((emp) => {
            const checked = bartenderIds.includes(emp.id)
            const disabled = !checked && bartenderIds.length >= 3
            return (
              <label key={emp.id} className={cn('flex items-center gap-2', disabled && 'text-muted-foreground')}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => handleBartenderToggle(emp.id, e.target.checked)}
                />
                {emp.full_name}
              </label>
            )
          })}
        </div>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

export function ShiftManagerSchedule() {
  const [year, setYear] = useState(currentYear)
  const [shiftManagers, setShiftManagers] = useState<Employee[]>([])
  const [areaManagers, setAreaManagers] = useState<Employee[]>([])
  const [bartenderEligible, setBartenderEligible] = useState<Employee[]>([])
  const [assignments, setAssignments] = useState<Map<string, ShiftManagerAssignment>>(new Map())

  const weeks = sundaysInYear(year)
    .map(toDateStr)
    .filter((w) => w >= EARLIEST_WEEK_START)

  async function load() {
    if (weeks.length === 0) {
      setShiftManagers([])
      setAreaManagers([])
      setBartenderEligible([])
      setAssignments(new Map())
      return
    }

    const [shiftManagersRes, rolesRes, employeesRes, assignmentsRes] = await Promise.all([
      supabase.rpc('list_shift_manager_employees'),
      supabase.rpc('list_employee_roles'),
      supabase.from('employees').select('id, full_name').eq('active', true).order('full_name'),
      supabase
        .from('shift_manager_assignments')
        .select('*')
        .gte('week_start', weeks[0])
        .lte('week_start', weeks[weeks.length - 1]),
    ])

    setShiftManagers((shiftManagersRes.data as Employee[]) ?? [])

    const roleByEmployeeId = new Map(
      ((rolesRes.data as { employee_id: string; role: string | null }[]) ?? []).map((r) => [r.employee_id, r.role]),
    )
    const activeEmployees = (employeesRes.data as Employee[]) ?? []
    setAreaManagers(activeEmployees.filter((e) => roleByEmployeeId.get(e.id) === 'area_manager'))
    setBartenderEligible(
      activeEmployees.filter((e) => {
        const role = roleByEmployeeId.get(e.id)
        return role !== undefined && role !== 'area_manager'
      }),
    )

    setAssignments(
      new Map(((assignmentsRes.data as ShiftManagerAssignment[]) ?? []).map((a) => [a.week_start, a])),
    )
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">שיבוץ מנהל בר לפי שנה</h1>
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
              assignment={assignments.get(week)}
              shiftManagers={shiftManagers}
              areaManagers={areaManagers}
              bartenderEligible={bartenderEligible}
              onSaved={load}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
