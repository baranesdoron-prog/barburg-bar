import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import {
  toDateStr,
  parseDateStr,
  sundaysInYear,
  EARLIEST_WEEK_START,
  weekLabelFormatter,
  YEAR_OPTIONS,
  currentMonthWeekRange,
} from '@/lib/weeklyChecklist'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ShiftManagerAssignment } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

interface Employee {
  id: string
  full_name: string
}

interface WeekShiftIds {
  opening?: string
  closing?: string
}

const currentYear = new Date().getFullYear()

function BartenderMultiSelect({
  options,
  selectedIds,
  onToggle,
  disabled,
}: {
  options: Employee[]
  selectedIds: string[]
  onToggle: (employeeId: string, checked: boolean) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const selectedNames = options.filter((emp) => selectedIds.includes(emp.id)).map((emp) => emp.full_name)

  if (disabled) {
    return (
      <p className={cn(selectClass, 'text-muted-foreground flex items-center')}>אין עדיין משמרת לשבוע זה</p>
    )
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(selectClass, 'flex items-center justify-between text-start')}
      >
        <span className={selectedNames.length === 0 ? 'text-muted-foreground' : undefined}>
          {selectedNames.length > 0 ? selectedNames.join(', ') : '— לא שובץ —'}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="bg-background absolute z-10 mt-1 w-full rounded-md border p-2 shadow-md">
          {options.length === 0 && <p className="text-muted-foreground text-sm">אין ברמנים/יות זמינים.</p>}
          <div className="flex flex-col gap-1">
            {options.map((emp) => {
              const checked = selectedIds.includes(emp.id)
              const disabled = !checked && selectedIds.length >= 3
              return (
                <label
                  key={emp.id}
                  className={cn('flex items-center gap-2 text-sm', disabled && 'text-muted-foreground')}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => onToggle(emp.id, e.target.checked)}
                  />
                  {emp.full_name}
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function WeekRow({
  week,
  assignment,
  shiftIds,
  openingBartenderIds,
  closingBartenderIds,
  shiftManagers,
  areaManagers,
  bartenderEligible,
  onSaved,
}: {
  week: string
  assignment: ShiftManagerAssignment | undefined
  shiftIds: WeekShiftIds
  openingBartenderIds: string[]
  closingBartenderIds: string[]
  shiftManagers: Employee[]
  areaManagers: Employee[]
  bartenderEligible: Employee[]
  onSaved: () => void
}) {
  const [shiftManagerId, setShiftManagerId] = useState(assignment?.employee_id ?? '')
  const [areaManagerId, setAreaManagerId] = useState(assignment?.area_manager_id ?? '')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setShiftManagerId(assignment?.employee_id ?? '')
    setAreaManagerId(assignment?.area_manager_id ?? '')
  }, [assignment])

  async function saveTeam(next: { shiftManagerId: string; areaManagerId: string }) {
    setError(null)
    const { error: saveError } = await supabase.rpc('set_weekly_team', {
      p_week_start: week,
      p_shift_manager_id: next.shiftManagerId || null,
      p_area_manager_id: next.areaManagerId || null,
    })

    if (saveError) {
      setError(saveError.message)
      return
    }

    onSaved()
  }

  function handleShiftManagerChange(value: string) {
    setShiftManagerId(value)
    saveTeam({ shiftManagerId: value, areaManagerId })
  }

  function handleAreaManagerChange(value: string) {
    setAreaManagerId(value)
    saveTeam({ shiftManagerId, areaManagerId: value })
  }

  async function handleBartenderToggle(shiftId: string, employeeId: string, checked: boolean) {
    setError(null)
    const { error: toggleError } = checked
      ? await supabase.from('shift_assignments').insert({ shift_id: shiftId, employee_id: employeeId })
      : await supabase.from('shift_assignments').delete().eq('shift_id', shiftId).eq('employee_id', employeeId)

    if (toggleError) {
      setError(toggleError.message)
      return
    }

    onSaved()
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
        <Label className="text-muted-foreground text-xs">ברמנים/יות — פתיחה (עד 3)</Label>
        <BartenderMultiSelect
          options={bartenderEligible}
          selectedIds={openingBartenderIds}
          onToggle={(employeeId, checked) => shiftIds.opening && handleBartenderToggle(shiftIds.opening, employeeId, checked)}
          disabled={!shiftIds.opening}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-muted-foreground text-xs">ברמנים/יות — סגירה (עד 3)</Label>
        <BartenderMultiSelect
          options={bartenderEligible}
          selectedIds={closingBartenderIds}
          onToggle={(employeeId, checked) => shiftIds.closing && handleBartenderToggle(shiftIds.closing, employeeId, checked)}
          disabled={!shiftIds.closing}
        />
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

export function ShiftManagerSchedule() {
  const [year, setYear] = useState(currentYear)
  const [currentMonthOnly, setCurrentMonthOnly] = useState(true)
  const [shiftManagers, setShiftManagers] = useState<Employee[]>([])
  const [areaManagers, setAreaManagers] = useState<Employee[]>([])
  const [bartenderEligible, setBartenderEligible] = useState<Employee[]>([])
  const [assignments, setAssignments] = useState<Map<string, ShiftManagerAssignment>>(new Map())
  const [shiftIdsByWeek, setShiftIdsByWeek] = useState<Map<string, WeekShiftIds>>(new Map())
  const [bartendersByShift, setBartendersByShift] = useState<Map<string, string[]>>(new Map())

  const monthRange = currentMonthWeekRange()
  const weeks = sundaysInYear(year)
    .map(toDateStr)
    .filter((w) => w >= EARLIEST_WEEK_START)
    .filter((w) => !currentMonthOnly || (w >= monthRange.start && w < monthRange.end))

  async function load() {
    if (weeks.length === 0) {
      setShiftManagers([])
      setAreaManagers([])
      setBartenderEligible([])
      setAssignments(new Map())
      setShiftIdsByWeek(new Map())
      setBartendersByShift(new Map())
      return
    }

    await supabase.rpc('ensure_upcoming_shifts')

    const [shiftManagersRes, rolesRes, employeesRes, assignmentsRes, shiftsRes] = await Promise.all([
      supabase.rpc('list_shift_manager_employees'),
      supabase.rpc('list_employee_roles'),
      supabase.from('employees').select('id, full_name').eq('active', true).order('full_name'),
      supabase
        .from('shift_manager_assignments')
        .select('*')
        .gte('week_start', weeks[0])
        .lte('week_start', weeks[weeks.length - 1]),
      supabase
        .from('shifts')
        .select('id, week_start, shift_type')
        .gte('week_start', weeks[0])
        .lte('week_start', weeks[weeks.length - 1])
        .neq('status', 'cancelled'),
    ])

    setShiftManagers((shiftManagersRes.data as Employee[]) ?? [])

    // Every real account role (administrator, shift_manager, bartender) can
    // cover either bartender or area-manager duty on a shift -- area_manager
    // isn't a holdable account role at all anymore, just a duty like this one.
    const roleByEmployeeId = new Map(
      ((rolesRes.data as { employee_id: string; role: string | null }[]) ?? []).map((r) => [r.employee_id, r.role]),
    )
    const activeEmployees = (employeesRes.data as Employee[]) ?? []
    const dutyEligible = activeEmployees.filter((e) => roleByEmployeeId.get(e.id) !== undefined)
    setAreaManagers(dutyEligible)
    setBartenderEligible(dutyEligible)

    setAssignments(
      new Map(((assignmentsRes.data as ShiftManagerAssignment[]) ?? []).map((a) => [a.week_start, a])),
    )

    const shiftsData = (shiftsRes.data as { id: string; week_start: string; shift_type: 'opening' | 'closing' }[]) ?? []
    const shiftIdsMap = new Map<string, WeekShiftIds>()
    for (const s of shiftsData) {
      const entry = shiftIdsMap.get(s.week_start) ?? {}
      entry[s.shift_type] = s.id
      shiftIdsMap.set(s.week_start, entry)
    }
    setShiftIdsByWeek(shiftIdsMap)

    const shiftIds = shiftsData.map((s) => s.id)
    if (shiftIds.length > 0) {
      const { data: assignmentRows } = await supabase
        .from('shift_assignments')
        .select('shift_id, employee_id')
        .in('shift_id', shiftIds)

      const byShift = new Map<string, string[]>()
      for (const row of (assignmentRows as { shift_id: string; employee_id: string }[]) ?? []) {
        byShift.set(row.shift_id, [...(byShift.get(row.shift_id) ?? []), row.employee_id])
      }
      setBartendersByShift(byShift)
    } else {
      setBartendersByShift(new Map())
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, currentMonthOnly])

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">שיבוצים</h1>
        <select className={cn(selectClass, 'w-28')} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <Button
        variant={currentMonthOnly ? 'default' : 'outline'}
        size="sm"
        className="self-start"
        onClick={() => setCurrentMonthOnly((v) => !v)}
      >
        החודש הנוכחי בלבד
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">שבועות {year}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {weeks.length === 0 && <p className="text-muted-foreground text-sm">אין שבועות להצגה בשנה זו.</p>}
          {weeks.map((week) => {
            const shiftIds = shiftIdsByWeek.get(week) ?? {}
            const eligibleIds = new Set(bartenderEligible.map((e) => e.id))
            const openingBartenderIds = (
              (shiftIds.opening && bartendersByShift.get(shiftIds.opening)) ||
              []
            ).filter((id) => eligibleIds.has(id))
            const closingBartenderIds = (
              (shiftIds.closing && bartendersByShift.get(shiftIds.closing)) ||
              []
            ).filter((id) => eligibleIds.has(id))

            return (
              <WeekRow
                key={week}
                week={week}
                assignment={assignments.get(week)}
                shiftIds={shiftIds}
                openingBartenderIds={openingBartenderIds}
                closingBartenderIds={closingBartenderIds}
                shiftManagers={shiftManagers}
                areaManagers={areaManagers}
                bartenderEligible={bartenderEligible}
                onSaved={load}
              />
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
