import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { ROLES_MANAGING_SHIFTS } from '@/lib/roleLabels'
import { effectiveStatusLabels, effectiveStatusBadgeClass, shiftTypeLabel } from '@/lib/shiftLabels'
import { sundaysInYear, EARLIEST_WEEK_START, weekLabelFormatter, YEAR_OPTIONS, toDateStr, parseDateStr } from '@/lib/weeklyChecklist'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Shift, ShiftType } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

const currentYear = new Date().getFullYear()

interface WeekShifts {
  opening?: Shift
  closing?: Shift
}

export function Shifts() {
  const { effectiveRole } = useAppUserContext()
  const [year, setYear] = useState(currentYear)
  const [shiftsByWeek, setShiftsByWeek] = useState<Map<string, WeekShifts>>(new Map())
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({})

  const weeks = sundaysInYear(year)
    .map(toDateStr)
    .filter((w) => w >= EARLIEST_WEEK_START)

  const canManage = ROLES_MANAGING_SHIFTS.includes(effectiveRole)

  useEffect(() => {
    async function load() {
      if (canManage) {
        await supabase.rpc('ensure_upcoming_shifts')
      }

      if (weeks.length === 0) {
        setShiftsByWeek(new Map())
        setEmployeeNames({})
        return
      }

      const [shiftsRes, employeesRes] = await Promise.all([
        supabase
          .from('shifts_with_effective_status')
          .select('*')
          .gte('week_start', weeks[0])
          .lte('week_start', weeks[weeks.length - 1]),
        supabase.from('employees').select('id, full_name'),
      ])

      const grouped = new Map<string, WeekShifts>()
      for (const shift of (shiftsRes.data as Shift[]) ?? []) {
        const entry = grouped.get(shift.week_start) ?? {}
        entry[shift.shift_type as ShiftType] = shift
        grouped.set(shift.week_start, entry)
      }
      setShiftsByWeek(grouped)

      const names: Record<string, string> = {}
      for (const emp of (employeesRes.data as { id: string; full_name: string }[]) ?? []) {
        names[emp.id] = emp.full_name
      }
      setEmployeeNames(names)
    }

    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">משמרות</h1>
        {canManage && (
          <Button asChild>
            <Link to="/shifts/new">משמרת חדשה</Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">שבועות {year}</CardTitle>
          <select className={cn(selectClass, 'w-28')} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {weeks.length === 0 && <p className="text-muted-foreground text-sm">אין שבועות להצגה בשנה זו.</p>}
          {weeks.map((week) => (
            <WeekRow key={week} week={week} shifts={shiftsByWeek.get(week) ?? {}} employeeNames={employeeNames} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function WeekRow({
  week,
  shifts,
  employeeNames,
}: {
  week: string
  shifts: WeekShifts
  employeeNames: Record<string, string>
}) {
  const managerId = shifts.opening?.shift_manager_id ?? shifts.closing?.shift_manager_id
  const managerName = managerId ? (employeeNames[managerId] ?? '—') : '—'

  return (
    <div className="flex flex-col gap-1 rounded-md border p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span>{weekLabelFormatter.format(parseDateStr(week))}</span>
        <span className="text-muted-foreground text-xs">מנהל/ת בר: {managerName}</span>
      </div>
      <div className="flex gap-2">
        <ShiftSlot shift={shifts.opening} type="opening" />
        <ShiftSlot shift={shifts.closing} type="closing" />
      </div>
    </div>
  )
}

function ShiftSlot({ shift, type }: { shift?: Shift; type: ShiftType }) {
  if (!shift) {
    return (
      <span className="text-muted-foreground flex-1 rounded-md border border-dashed px-2 py-1 text-xs">
        {shiftTypeLabel(type)}: לא נפתחה
      </span>
    )
  }

  const understaffed =
    (shift.effective_status === 'published' || shift.effective_status === 'active') &&
    shift.required_staff_count !== null &&
    shift.assigned_count < shift.required_staff_count

  return (
    <Link
      to={`/shifts/${shift.id}`}
      className="hover:bg-accent/50 flex flex-1 items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs transition-colors"
    >
      <span>{shiftTypeLabel(shift.shift_type)}</span>
      <span className="flex items-center gap-1">
        {understaffed && <span className="text-amber-600 dark:text-amber-400">תת-איוש</span>}
        <span className={cn('rounded-full px-2 py-0.5 font-medium', effectiveStatusBadgeClass[shift.effective_status])}>
          {effectiveStatusLabels[shift.effective_status]}
        </span>
      </span>
    </Link>
  )
}
