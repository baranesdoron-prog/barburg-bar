import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { ROLES_MANAGING_SHIFTS } from '@/lib/roleLabels'
import { effectiveStatusLabels, effectiveStatusBadgeClass, shiftTypeLabel } from '@/lib/shiftLabels'
import {
  sundaysInYear,
  EARLIEST_WEEK_START,
  weekLabelFormatter,
  YEAR_OPTIONS,
  toDateStr,
  activeWeekStart,
  shiftDateOfWeek,
} from '@/lib/weeklyChecklist'
import { formatTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Shift, ShiftAssignment, ShiftAssignmentRole, ShiftType } from '@/lib/types'

const selectClass =
  'border-input flex h-7 rounded-md border bg-transparent px-1.5 py-0 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

const currentYear = new Date().getFullYear()

// Weeks starting before this are "old" and live in the archive instead of
// the main list. Unlike the dashboard's closing-shifts widget or a
// bartender's own MyShifts view (which use archiveCutoff() -- the whole
// current calendar month), the allocations view is a planning screen: once
// a week's shift is no longer the current/next one, it moves to the
// archive right away.
const ARCHIVE_CUTOFF = toDateStr(activeWeekStart())

interface Employee {
  id: string
  full_name: string
}

interface WeekShifts {
  opening?: Shift
  closing?: Shift
}

function friendlyAssignmentError(error: { code?: string; message: string }) {
  if (error.code === '23503') return 'לא ניתן להסיר — כבר נרשמה נוכחות למשמרת זו'
  return error.message
}

// Shown next to a name everywhere it's assigned: how many shifts this
// person has actually worked, combined across every role.
function nameWithCount(name: string, shiftCounts: Record<string, number>, employeeId: string) {
  return `${name} (${shiftCounts[employeeId] ?? 0})`
}

export function Shifts() {
  return <AllocationsList />
}

export function ShiftsArchive() {
  return <ArchiveList />
}

// ---------------------------------------------------------------------
// Unified allocations view (current + future weeks)
// ---------------------------------------------------------------------

function AllocationsList() {
  const { appUser, effectiveRole } = useAppUserContext()
  const myEmployeeId = appUser.employee_id
  const [year, setYear] = useState(currentYear)
  const [shiftsByWeek, setShiftsByWeek] = useState<Map<string, WeekShifts>>(new Map())
  const [assignmentsByShift, setAssignmentsByShift] = useState<Map<string, ShiftAssignment[]>>(new Map())
  const [teamByWeek, setTeamByWeek] = useState<Map<string, string>>(new Map())
  const [shiftManagers, setShiftManagers] = useState<Employee[]>([])
  const [dutyEligible, setDutyEligible] = useState<Employee[]>([])
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({})
  const [shiftCounts, setShiftCounts] = useState<Record<string, number>>({})
  const [pendingRequestAssignmentIds, setPendingRequestAssignmentIds] = useState<Set<string>>(new Set())

  const canManage = ROLES_MANAGING_SHIFTS.includes(effectiveRole)

  const weeks = sundaysInYear(year)
    .map(toDateStr)
    .filter((w) => w >= EARLIEST_WEEK_START && w >= ARCHIVE_CUTOFF)

  async function load() {
    if (weeks.length === 0) {
      setShiftsByWeek(new Map())
      setAssignmentsByShift(new Map())
      setTeamByWeek(new Map())
      setShiftManagers([])
      setDutyEligible([])
      setEmployeeNames({})
      setShiftCounts({})
      setPendingRequestAssignmentIds(new Set())
      return
    }

    // Both manager-only server-side: bartenders can't provision shifts or
    // pick a bar manager, so skip these calls entirely for them instead of
    // firing requests RLS will just reject.
    if (canManage) await supabase.rpc('ensure_upcoming_shifts')

    const [shiftsRes, teamRes, shiftManagersRes, rolesRes, employeesRes, countsRes, myRequestsRes] = await Promise.all([
      supabase
        .from('shifts_with_effective_status')
        .select('*')
        .gte('week_start', weeks[0])
        .lte('week_start', weeks[weeks.length - 1]),
      supabase
        .from('shift_manager_assignments')
        .select('week_start, employee_id')
        .gte('week_start', weeks[0])
        .lte('week_start', weeks[weeks.length - 1]),
      canManage ? supabase.rpc('list_shift_manager_employees') : Promise.resolve({ data: [] }),
      supabase.rpc('list_employee_roles'),
      supabase.from('employees').select('id, full_name').order('full_name'),
      supabase.rpc('list_employee_shift_counts'),
      // Only a bartender/self-service viewer needs this, to know whether
      // their own current-week slot already has a pending replacement
      // request instead of offering the button again.
      canManage
        ? Promise.resolve({ data: [] })
        : supabase.from('replacement_requests').select('shift_assignment_id').eq('requested_by', appUser.id).eq('status', 'pending'),
    ])

    setPendingRequestAssignmentIds(
      new Set(((myRequestsRes.data as { shift_assignment_id: string }[]) ?? []).map((r) => r.shift_assignment_id)),
    )

    setShiftCounts(
      Object.fromEntries(
        ((countsRes.data as { employee_id: string; shift_count: number }[]) ?? []).map((r) => [
          r.employee_id,
          r.shift_count,
        ]),
      ),
    )

    const shifts = (shiftsRes.data as Shift[]) ?? []
    const grouped = new Map<string, WeekShifts>()
    for (const shift of shifts) {
      const entry = grouped.get(shift.week_start) ?? {}
      entry[shift.shift_type as ShiftType] = shift
      grouped.set(shift.week_start, entry)
    }
    setShiftsByWeek(grouped)

    setTeamByWeek(
      new Map(
        ((teamRes.data as { week_start: string; employee_id: string }[]) ?? []).map((r) => [
          r.week_start,
          r.employee_id,
        ]),
      ),
    )

    setShiftManagers((shiftManagersRes.data as Employee[]) ?? [])

    // Every real account role (administrator, shift_manager, bartender) can
    // cover either bartender or area-manager duty on a shift -- area_manager
    // isn't a holdable account role, just a duty like this one.
    const roleByEmployeeId = new Map(
      ((rolesRes.data as { employee_id: string; role: string | null }[]) ?? []).map((r) => [r.employee_id, r.role]),
    )
    const allEmployees = (employeesRes.data as Employee[]) ?? []
    setDutyEligible(allEmployees.filter((e) => roleByEmployeeId.get(e.id) !== undefined))

    const names: Record<string, string> = {}
    for (const emp of allEmployees) names[emp.id] = emp.full_name
    setEmployeeNames(names)

    const shiftIds = shifts.map((s) => s.id)
    if (shiftIds.length > 0) {
      const { data: assignmentRows } = await supabase
        .from('shift_assignments')
        .select('*')
        .in('shift_id', shiftIds)
        .order('created_at')

      const byShift = new Map<string, ShiftAssignment[]>()
      for (const row of (assignmentRows as ShiftAssignment[]) ?? []) {
        byShift.set(row.shift_id, [...(byShift.get(row.shift_id) ?? []), row])
      }
      setAssignmentsByShift(byShift)
    } else {
      setAssignmentsByShift(new Map())
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">משמרות</h1>
        {canManage && (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/shifts/archive">ארכיון</Link>
            </Button>
            <Button asChild>
              <Link to="/shifts/new">משמרת חדשה</Link>
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">שבועות {year}</span>
        <select
          className={cn(selectClass, 'h-9 w-28 text-sm')}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {weeks.length === 0 && <p className="text-muted-foreground text-sm">אין שבועות להצגה בשנה זו.</p>}

      {weeks.map((week) => (
        <WeekCard
          key={week}
          week={week}
          shifts={shiftsByWeek.get(week) ?? {}}
          assignmentsByShift={assignmentsByShift}
          shiftManagerId={teamByWeek.get(week) ?? null}
          shiftManagers={shiftManagers}
          dutyEligible={dutyEligible}
          employeeNames={employeeNames}
          shiftCounts={shiftCounts}
          myEmployeeId={myEmployeeId}
          viewerCanManage={canManage}
          isAdmin={effectiveRole === 'administrator'}
          pendingRequestAssignmentIds={pendingRequestAssignmentIds}
          onSaved={load}
        />
      ))}
    </div>
  )
}

function WeekCard({
  week,
  shifts,
  assignmentsByShift,
  shiftManagerId,
  shiftManagers,
  dutyEligible,
  employeeNames,
  shiftCounts,
  myEmployeeId,
  viewerCanManage,
  isAdmin,
  pendingRequestAssignmentIds,
  onSaved,
}: {
  week: string
  shifts: WeekShifts
  assignmentsByShift: Map<string, ShiftAssignment[]>
  shiftManagerId: string | null
  shiftManagers: Employee[]
  dutyEligible: Employee[]
  employeeNames: Record<string, string>
  shiftCounts: Record<string, number>
  myEmployeeId: string | null
  viewerCanManage: boolean
  isAdmin: boolean
  pendingRequestAssignmentIds: Set<string>
  onSaved: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  const openingId = shifts.opening?.id
  const closingId = shifts.closing?.id
  const openingAll = openingId ? (assignmentsByShift.get(openingId) ?? []) : []
  const closingAll = closingId ? (assignmentsByShift.get(closingId) ?? []) : []

  const dateLabel = shifts.opening?.start_time
    ? weekLabelFormatter.format(new Date(shifts.opening.start_time))
    : shifts.closing?.start_time
      ? weekLabelFormatter.format(new Date(shifts.closing.start_time))
      : weekLabelFormatter.format(shiftDateOfWeek(week))

  async function handleSetShiftManager(employeeId: string | null) {
    setError(null)
    const { error: rpcError } = await supabase.rpc('set_weekly_shift_manager', {
      p_week_start: week,
      p_employee_id: employeeId,
    })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    onSaved()
  }

  async function handleAssign(shiftId: string, employeeId: string, role: ShiftAssignmentRole) {
    setError(null)
    const { error: insertError } = await supabase
      .from('shift_assignments')
      .insert({ shift_id: shiftId, employee_id: employeeId, assignment_role: role })
    if (insertError) {
      setError(friendlyAssignmentError(insertError))
      return
    }
    onSaved()
  }

  async function handleRemove(assignmentId: string) {
    setError(null)
    const { error: deleteError } = await supabase.from('shift_assignments').delete().eq('id', assignmentId)
    if (deleteError) {
      setError(friendlyAssignmentError(deleteError))
      return
    }
    onSaved()
  }

  async function handleRequestReplacement(
    assignmentId: string,
    reason: string | null,
    substituteId: string | null,
  ): Promise<string | null> {
    const { error: requestError } = await supabase.rpc('request_replacement', {
      p_shift_assignment_id: assignmentId,
      p_reason: reason,
      p_substitute_employee_id: substituteId,
    })
    if (requestError) return requestError.message
    onSaved()
    return null
  }

  async function handleSwap(oldAssignmentId: string, shiftId: string, role: ShiftAssignmentRole, newEmployeeId: string) {
    setError(null)
    const { error: deleteError } = await supabase.from('shift_assignments').delete().eq('id', oldAssignmentId)
    if (deleteError) {
      setError(friendlyAssignmentError(deleteError))
      return
    }
    const { error: insertError } = await supabase
      .from('shift_assignments')
      .insert({ shift_id: shiftId, employee_id: newEmployeeId, assignment_role: role })
    if (insertError) {
      setError(friendlyAssignmentError(insertError))
      return
    }
    onSaved()
  }

  // Matches shift_assignments_delete_self_future_week's RLS: a bartender
  // can only remove their own assignment for a strictly-future week, not
  // the current one.
  const canSelfRemove = week > toDateStr(activeWeekStart())

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{dateLabel}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {viewerCanManage && (
          <div className="bg-muted rounded-md p-2">
            <CombinedStatus
              opening={shifts.opening}
              closing={shifts.closing}
              openingAreaManagerCount={openingAll.filter((a) => a.assignment_role === 'area_manager').length}
              closingAreaManagerCount={closingAll.filter((a) => a.assignment_role === 'area_manager').length}
            />
          </div>
        )}

        <div className="bg-muted flex flex-col gap-3 rounded-md p-2">
          <BarManagerRow
            employeeId={shiftManagerId}
            employeeNames={employeeNames}
            shiftManagers={shiftManagers}
            shiftCounts={shiftCounts}
            myEmployeeId={myEmployeeId}
            readOnly={!viewerCanManage}
            canPickAnyone={isAdmin}
            onSet={handleSetShiftManager}
          />

          <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-1 text-xs">
            <span />
            <ColumnHeader shift={shifts.opening} type="opening" />
            <ColumnHeader shift={shifts.closing} type="closing" />
          </div>

          {viewerCanManage ? (
            <RoleSection
              label="ברמנים/יות (עד 3)"
              role="bartender"
              max={3}
              openingShift={shifts.opening}
              closingShift={shifts.closing}
              openingAssignments={openingAll.filter((a) => a.assignment_role === 'bartender')}
              closingAssignments={closingAll.filter((a) => a.assignment_role === 'bartender')}
              openingTaken={new Set(openingAll.map((a) => a.employee_id))}
              closingTaken={new Set(closingAll.map((a) => a.employee_id))}
              eligible={dutyEligible}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              myEmployeeId={myEmployeeId}
              onAssign={handleAssign}
              onSwap={handleSwap}
              onRemove={handleRemove}
            />
          ) : (
            <SelfServiceRoleSection
              label="ברמנים/יות (עד 3)"
              role="bartender"
              max={3}
              openingShift={shifts.opening}
              closingShift={shifts.closing}
              openingAssignments={openingAll.filter((a) => a.assignment_role === 'bartender')}
              closingAssignments={closingAll.filter((a) => a.assignment_role === 'bartender')}
              eligible={dutyEligible}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              myEmployeeId={myEmployeeId}
              canSelfRemove={canSelfRemove}
              pendingRequestAssignmentIds={pendingRequestAssignmentIds}
              onAssign={handleAssign}
              onRemove={handleRemove}
              onRequestReplacement={handleRequestReplacement}
            />
          )}
        </div>

        <div className="bg-muted rounded-md p-2">
          {viewerCanManage ? (
            <RoleSection
              label="אחראי/ת מתחם"
              role="area_manager"
              max={1}
              openingShift={shifts.opening}
              closingShift={shifts.closing}
              openingAssignments={openingAll.filter((a) => a.assignment_role === 'area_manager')}
              closingAssignments={closingAll.filter((a) => a.assignment_role === 'area_manager')}
              openingTaken={new Set(openingAll.map((a) => a.employee_id))}
              closingTaken={new Set(closingAll.map((a) => a.employee_id))}
              eligible={dutyEligible}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              myEmployeeId={myEmployeeId}
              onAssign={handleAssign}
              onSwap={handleSwap}
              onRemove={handleRemove}
            />
          ) : (
            <SelfServiceRoleSection
              label="אחראי/ת מתחם"
              role="area_manager"
              max={1}
              openingShift={shifts.opening}
              closingShift={shifts.closing}
              openingAssignments={openingAll.filter((a) => a.assignment_role === 'area_manager')}
              closingAssignments={closingAll.filter((a) => a.assignment_role === 'area_manager')}
              eligible={dutyEligible}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              myEmployeeId={myEmployeeId}
              canSelfRemove={canSelfRemove}
              pendingRequestAssignmentIds={pendingRequestAssignmentIds}
              onAssign={handleAssign}
              onRemove={handleRemove}
              onRequestReplacement={handleRequestReplacement}
            />
          )}
        </div>

        {error && <p className="text-destructive text-xs">{error}</p>}
      </CardContent>
    </Card>
  )
}

function ColumnHeader({ shift, type }: { shift?: Shift; type: ShiftType }) {
  if (!shift) {
    return <span className="text-muted-foreground">{shiftTypeLabel(type)}: לא נפתחה</span>
  }
  return (
    <span className="font-medium">
      {shiftTypeLabel(type)} {formatTime(shift.start_time)}–{formatTime(shift.end_time)}
    </span>
  )
}

// One combined status line for the whole week's shift pair, instead of a
// separate badge per shift-type. Prefers the closing shift's status (that's
// the one that determines whether the night is actually done), falling back
// to the opening shift if closing doesn't exist yet. Also surfaces
// understaffing that isn't captured by that status alone: too few bartenders
// (below required_staff_count) or no area manager at all for a shift-type
// that's still open.
function CombinedStatus({
  opening,
  closing,
  openingAreaManagerCount,
  closingAreaManagerCount,
}: {
  opening?: Shift
  closing?: Shift
  openingAreaManagerCount: number
  closingAreaManagerCount: number
}) {
  const primary = closing ?? opening

  const gaps: string[] = []
  for (const [shift, areaManagerCount, label] of [
    [opening, openingAreaManagerCount, 'פתיחה'],
    [closing, closingAreaManagerCount, 'סגירה'],
  ] as const) {
    if (!shift || shift.status === 'cancelled') continue
    const openForStaffing = shift.effective_status === 'published' || shift.effective_status === 'active'
    if (!openForStaffing) continue
    if (shift.required_staff_count !== null && shift.assigned_count < shift.required_staff_count) {
      gaps.push(`תת-איוש ברמנים/יות (${label})`)
    }
    if (areaManagerCount === 0) {
      gaps.push(`אין אחראי/ת מתחם (${label})`)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">סטטוס</span>
      {primary ? (
        <Link
          to={`/shifts/${primary.id}`}
          className={cn(
            'w-fit rounded-full px-2 py-0.5 font-medium hover:underline',
            effectiveStatusBadgeClass[primary.effective_status],
          )}
        >
          {effectiveStatusLabels[primary.effective_status]}
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      {gaps.map((g) => (
        <span key={g} className="text-amber-600 dark:text-amber-400">
          {g}
        </span>
      ))}
    </div>
  )
}

function BarManagerRow({
  employeeId,
  employeeNames,
  shiftManagers,
  shiftCounts,
  myEmployeeId,
  readOnly,
  canPickAnyone,
  onSet,
}: {
  employeeId: string | null
  employeeNames: Record<string, string>
  shiftManagers: Employee[]
  shiftCounts: Record<string, number>
  myEmployeeId: string | null
  readOnly: boolean
  canPickAnyone: boolean
  onSet: (employeeId: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const iAmEligible = !!myEmployeeId && shiftManagers.some((e) => e.id === myEmployeeId)

  // Bartenders/area-manager-duty viewers never touch this row -- read only.
  if (readOnly) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
        <span className="text-muted-foreground text-xs">מנהל/ת בר</span>
        <span>
          {employeeId ? nameWithCount(employeeNames[employeeId] ?? '—', shiftCounts, employeeId) : '— לא שובץ —'}
        </span>
      </div>
    )
  }

  // A bar manager (shift_manager) can only assign themselves -- no picking
  // or swapping someone else in, and no touching an existing assignment
  // (their own or anyone else's) once it's set.
  if (!canPickAnyone) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
        <span className="text-muted-foreground text-xs">מנהל/ת בר</span>
        {employeeId ? (
          <span>{nameWithCount(employeeNames[employeeId] ?? '—', shiftCounts, employeeId)}</span>
        ) : (
          <>
            <span className="text-muted-foreground">— לא שובץ —</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={!iAmEligible}
              onClick={() => myEmployeeId && onSet(myEmployeeId)}
            >
              שבץ אותי
            </Button>
          </>
        )}
      </div>
    )
  }

  // Administrator: full picker -- fill an empty slot with anyone from the
  // admins/bar-managers list (not just self), or swap/remove once filled.
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
      <span className="text-muted-foreground text-xs">מנהל/ת בר</span>
      {editing ? (
        <select
          autoFocus
          className={cn(selectClass, 'h-8 flex-1 text-sm')}
          defaultValue=""
          onBlur={() => setEditing(false)}
          onChange={(e) => {
            const v = e.target.value
            setEditing(false)
            if (v === '__remove__') onSet(null)
            else if (v) onSet(v)
          }}
        >
          <option value="">בחר/י…</option>
          {employeeId && <option value="__remove__">— הסרה —</option>}
          {shiftManagers
            .filter((e) => e.id !== employeeId)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {nameWithCount(e.full_name, shiftCounts, e.id)}
              </option>
            ))}
        </select>
      ) : employeeId ? (
        <button type="button" onClick={() => setEditing(true)} className="underline-offset-2 hover:underline">
          {nameWithCount(employeeNames[employeeId] ?? '—', shiftCounts, employeeId)}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">— לא שובץ —</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={!iAmEligible}
            onClick={() => myEmployeeId && onSet(myEmployeeId)}
          >
            שבץ אותי
          </Button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-muted-foreground text-xs underline-offset-2 hover:underline"
          >
            בחר/י…
          </button>
        </div>
      )}
    </div>
  )
}

// Manager mode: full edit rights over every slot (fill, swap to anyone,
// remove anyone), plus a self-associate convenience per slot/row.
function RoleSection({
  label,
  role,
  max,
  openingShift,
  closingShift,
  openingAssignments,
  closingAssignments,
  openingTaken,
  closingTaken,
  eligible,
  employeeNames,
  shiftCounts,
  myEmployeeId,
  onAssign,
  onSwap,
  onRemove,
}: {
  label: string
  role: ShiftAssignmentRole
  max: number
  openingShift?: Shift
  closingShift?: Shift
  openingAssignments: ShiftAssignment[]
  closingAssignments: ShiftAssignment[]
  openingTaken: Set<string>
  closingTaken: Set<string>
  eligible: Employee[]
  employeeNames: Record<string, string>
  shiftCounts: Record<string, number>
  myEmployeeId: string | null
  onAssign: (shiftId: string, employeeId: string, role: ShiftAssignmentRole) => void
  onSwap: (oldAssignmentId: string, shiftId: string, role: ShiftAssignmentRole, newEmployeeId: string) => void
  onRemove: (assignmentId: string) => void
}) {
  const iAmEligible = !!myEmployeeId && eligible.some((e) => e.id === myEmployeeId)
  const rows = Array.from({ length: max }, (_, i) => i)
  const openingShiftId = openingShift?.id
  const closingShiftId = closingShift?.id

  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      {rows.map((i) => {
        const openingPerson = openingAssignments[i]
        const closingPerson = closingAssignments[i]
        const openingIsNext = !openingPerson && i === openingAssignments.length && !!openingShiftId
        const closingIsNext = !closingPerson && i === closingAssignments.length && !!closingShiftId

        if (!openingPerson && !openingIsNext && !closingPerson && !closingIsNext) return null

        const openingIAmFree = openingIsNext && iAmEligible && !!myEmployeeId && !openingTaken.has(myEmployeeId)
        const closingIAmFree = closingIsNext && iAmEligible && !!myEmployeeId && !closingTaken.has(myEmployeeId)

        return (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1">
            <SlotCell
              person={openingPerson}
              isNext={openingIsNext}
              iAmFree={openingIAmFree}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              eligible={eligible}
              takenIds={openingTaken}
              onAssociateMe={() => openingShiftId && myEmployeeId && onAssign(openingShiftId, myEmployeeId, role)}
              onPick={(id) => openingShiftId && onAssign(openingShiftId, id, role)}
              onSwap={(newId) => openingShiftId && openingPerson && onSwap(openingPerson.id, openingShiftId, role, newId)}
              onRemove={() => openingPerson && onRemove(openingPerson.id)}
            />
            <SlotCell
              person={closingPerson}
              isNext={closingIsNext}
              iAmFree={closingIAmFree}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              eligible={eligible}
              takenIds={closingTaken}
              onAssociateMe={() => closingShiftId && myEmployeeId && onAssign(closingShiftId, myEmployeeId, role)}
              onPick={(id) => closingShiftId && onAssign(closingShiftId, id, role)}
              onSwap={(newId) => closingShiftId && closingPerson && onSwap(closingPerson.id, closingShiftId, role, newId)}
              onRemove={() => closingPerson && onRemove(closingPerson.id)}
            />
            {(openingIAmFree || closingIAmFree) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => {
                  if (openingIAmFree && openingShiftId && myEmployeeId) onAssign(openingShiftId, myEmployeeId, role)
                  if (closingIAmFree && closingShiftId && myEmployeeId) onAssign(closingShiftId, myEmployeeId, role)
                }}
              >
                שבץ אותי
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Self-service mode (bartender/area-manager viewers): one column per
// shift-type, a plain read-only list of who else is on it, and a single
// control reflecting the viewer's own status -- "שבץ אותי" if they're not
// on it (and there's room), or their own remove/replacement-request action
// if they are. No per-slot picking, no swapping other people.
function SelfServiceRoleSection({
  label,
  role,
  max,
  openingShift,
  closingShift,
  openingAssignments,
  closingAssignments,
  eligible,
  employeeNames,
  shiftCounts,
  myEmployeeId,
  canSelfRemove,
  pendingRequestAssignmentIds,
  onAssign,
  onRemove,
  onRequestReplacement,
}: {
  label: string
  role: ShiftAssignmentRole
  max: number
  openingShift?: Shift
  closingShift?: Shift
  openingAssignments: ShiftAssignment[]
  closingAssignments: ShiftAssignment[]
  eligible: Employee[]
  employeeNames: Record<string, string>
  shiftCounts: Record<string, number>
  myEmployeeId: string | null
  canSelfRemove: boolean
  pendingRequestAssignmentIds: Set<string>
  onAssign: (shiftId: string, employeeId: string, role: ShiftAssignmentRole) => void
  onRemove: (assignmentId: string) => void
  onRequestReplacement: (assignmentId: string, reason: string | null, substituteId: string | null) => Promise<string | null>
}) {
  const iAmEligible = !!myEmployeeId && eligible.some((e) => e.id === myEmployeeId)

  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <SelfServiceColumn
          shift={openingShift}
          assignments={openingAssignments}
          max={max}
          role={role}
          eligible={eligible}
          iAmEligible={iAmEligible}
          employeeNames={employeeNames}
          shiftCounts={shiftCounts}
          myEmployeeId={myEmployeeId}
          canSelfRemove={canSelfRemove}
          pendingRequestAssignmentIds={pendingRequestAssignmentIds}
          onAssign={onAssign}
          onRemove={onRemove}
          onRequestReplacement={onRequestReplacement}
        />
        <SelfServiceColumn
          shift={closingShift}
          assignments={closingAssignments}
          max={max}
          role={role}
          eligible={eligible}
          iAmEligible={iAmEligible}
          employeeNames={employeeNames}
          shiftCounts={shiftCounts}
          myEmployeeId={myEmployeeId}
          canSelfRemove={canSelfRemove}
          pendingRequestAssignmentIds={pendingRequestAssignmentIds}
          onAssign={onAssign}
          onRemove={onRemove}
          onRequestReplacement={onRequestReplacement}
        />
      </div>
    </div>
  )
}

function SelfServiceColumn({
  shift,
  assignments,
  max,
  role,
  eligible,
  iAmEligible,
  employeeNames,
  shiftCounts,
  myEmployeeId,
  canSelfRemove,
  pendingRequestAssignmentIds,
  onAssign,
  onRemove,
  onRequestReplacement,
}: {
  shift?: Shift
  assignments: ShiftAssignment[]
  max: number
  role: ShiftAssignmentRole
  eligible: Employee[]
  iAmEligible: boolean
  employeeNames: Record<string, string>
  shiftCounts: Record<string, number>
  myEmployeeId: string | null
  canSelfRemove: boolean
  pendingRequestAssignmentIds: Set<string>
  onAssign: (shiftId: string, employeeId: string, role: ShiftAssignmentRole) => void
  onRemove: (assignmentId: string) => void
  onRequestReplacement: (assignmentId: string, reason: string | null, substituteId: string | null) => Promise<string | null>
}) {
  if (!shift) return <span className="text-muted-foreground text-xs">—</span>

  const mine = assignments.find((a) => a.employee_id === myEmployeeId)
  const others = assignments.filter((a) => a.employee_id !== myEmployeeId)

  return (
    <div className="flex flex-col gap-1">
      {others.length > 0 && (
        <span className="text-xs">
          {others.map((a) => nameWithCount(employeeNames[a.employee_id] ?? '—', shiftCounts, a.employee_id)).join(', ')}
        </span>
      )}
      {others.length === 0 && !mine && <span className="text-muted-foreground text-xs">אין עדיין</span>}

      {mine && canSelfRemove && (
        <div className="flex items-center gap-1">
          <span className="truncate text-xs">
            {nameWithCount(employeeNames[mine.employee_id] ?? '—', shiftCounts, mine.employee_id)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(mine.id)}
            className="text-destructive text-[10px] underline-offset-2 hover:underline"
          >
            ביטול
          </button>
        </div>
      )}

      {mine && !canSelfRemove && shift.effective_status === 'published' && (
        <ReplacementRequestControl
          name={nameWithCount(employeeNames[mine.employee_id] ?? '—', shiftCounts, mine.employee_id)}
          hasPendingRequest={pendingRequestAssignmentIds.has(mine.id)}
          eligible={eligible}
          onSubmit={(reason, substituteId) => onRequestReplacement(mine.id, reason, substituteId)}
        />
      )}

      {mine && !canSelfRemove && shift.effective_status !== 'published' && (
        <span className="truncate text-xs">
          {nameWithCount(employeeNames[mine.employee_id] ?? '—', shiftCounts, mine.employee_id)}
        </span>
      )}

      {!mine && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 w-fit px-2 text-[11px]"
          disabled={!iAmEligible || !myEmployeeId || assignments.length >= max}
          onClick={() => myEmployeeId && onAssign(shift.id, myEmployeeId, role)}
        >
          שבץ אותי
        </Button>
      )}
    </div>
  )
}

function SlotCell({
  person,
  isNext,
  iAmFree,
  employeeNames,
  shiftCounts,
  eligible,
  takenIds,
  onAssociateMe,
  onPick,
  onSwap,
  onRemove,
}: {
  person?: ShiftAssignment
  isNext: boolean
  iAmFree: boolean
  employeeNames: Record<string, string>
  shiftCounts: Record<string, number>
  eligible: Employee[]
  takenIds: Set<string>
  onAssociateMe: () => void
  onPick: (employeeId: string) => void
  onSwap: (newEmployeeId: string) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)

  if (person) {
    if (editing) {
      return (
        <select
          autoFocus
          className={cn(selectClass, 'text-[11px]')}
          defaultValue=""
          onBlur={() => setEditing(false)}
          onChange={(e) => {
            const v = e.target.value
            setEditing(false)
            if (v === '__remove__') onRemove()
            else if (v) onSwap(v)
          }}
        >
          <option value="" disabled>
            {nameWithCount(employeeNames[person.employee_id] ?? '—', shiftCounts, person.employee_id)}
          </option>
          <option value="__remove__">— הסרה —</option>
          {eligible
            .filter((e) => e.id === person.employee_id || !takenIds.has(e.id))
            .filter((e) => e.id !== person.employee_id)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {nameWithCount(e.full_name, shiftCounts, e.id)}
              </option>
            ))}
        </select>
      )
    }
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="truncate text-start text-xs underline-offset-2 hover:underline"
      >
        {nameWithCount(employeeNames[person.employee_id] ?? '—', shiftCounts, person.employee_id)}
      </button>
    )
  }

  if (!isNext) return <span />

  if (editing) {
    return (
      <select
        autoFocus
        className={cn(selectClass, 'text-[11px]')}
        defaultValue=""
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          const v = e.target.value
          setEditing(false)
          if (v) onPick(v)
        }}
      >
        <option value="">בחר/י…</option>
        {eligible
          .filter((e) => !takenIds.has(e.id))
          .map((e) => (
            <option key={e.id} value={e.id}>
              {nameWithCount(e.full_name, shiftCounts, e.id)}
            </option>
          ))}
      </select>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[11px]"
        disabled={!iAmFree}
        onClick={onAssociateMe}
      >
        שבץ אותי
      </Button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-muted-foreground text-[11px] underline-offset-2 hover:underline"
      >
        בחר/י…
      </button>
    </div>
  )
}

// Own slot, current week: can't just drop it (that's what canSelfRemove
// future-week self-remove is for), so offer a replacement request instead
// -- same request_replacement() RPC and reason/substitute fields MyShifts'
// self-service request form already uses, just inline here.
function ReplacementRequestControl({
  name,
  hasPendingRequest,
  eligible,
  onSubmit,
}: {
  name: string
  hasPendingRequest: boolean
  eligible: Employee[]
  onSubmit: (reason: string | null, substituteId: string | null) => Promise<string | null>
}) {
  const [showForm, setShowForm] = useState(false)
  const [reason, setReason] = useState('')
  const [substituteId, setSubstituteId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (hasPendingRequest) {
    return (
      <div className="flex flex-col text-xs">
        <span className="truncate">{name}</span>
        <span className="text-muted-foreground text-[10px]">בקשת החלפה נשלחה, ממתינה לאישור</span>
      </div>
    )
  }

  if (!showForm) {
    return (
      <div className="flex items-center gap-1">
        <span className="truncate text-xs">{name}</span>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="text-[10px] underline-offset-2 hover:underline"
        >
          בקשת החלפה
        </button>
      </div>
    )
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    const submitError = await onSubmit(reason.trim() || null, substituteId || null)
    setSubmitting(false)
    if (submitError) {
      setError(submitError)
      return
    }
    setShowForm(false)
    setReason('')
    setSubstituteId('')
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border p-1.5">
      <span className="truncate text-xs font-medium">{name}</span>
      <textarea
        className={cn(selectClass, 'h-auto min-h-10 py-1 text-[11px]')}
        placeholder="סיבה (לא חובה)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <select className={cn(selectClass, 'text-[11px]')} value={substituteId} onChange={(e) => setSubstituteId(e.target.value)}>
        <option value="">הצעת מחליף/ה</option>
        {eligible.map((e) => (
          <option key={e.id} value={e.id}>
            {e.full_name}
          </option>
        ))}
      </select>
      <div className="flex gap-1">
        <Button type="button" size="sm" className="h-6 flex-1 px-1 text-[10px]" disabled={submitting} onClick={handleSubmit}>
          שליחה
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 flex-1 px-1 text-[10px]"
          onClick={() => setShowForm(false)}
        >
          ביטול
        </Button>
      </div>
      {error && <p className="text-destructive text-[10px]">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------
// Archive (read-only, unchanged behavior)
// ---------------------------------------------------------------------

function ArchiveList() {
  const [year, setYear] = useState(currentYear)
  const [shiftsByWeek, setShiftsByWeek] = useState<Map<string, WeekShifts>>(new Map())
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({})

  const weeks = sundaysInYear(year)
    .map(toDateStr)
    .filter((w) => w >= EARLIEST_WEEK_START && w < ARCHIVE_CUTOFF)

  useEffect(() => {
    async function load() {
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
        <h1 className="text-xl font-semibold">ארכיון משמרות</h1>
        <Button asChild variant="outline">
          <Link to="/shifts">חזרה למשמרות</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">שבועות {year}</CardTitle>
          <select className={cn(selectClass, 'h-9 w-28 text-sm')} value={year} onChange={(e) => setYear(Number(e.target.value))}>
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
            <ArchiveWeekRow key={week} week={week} shifts={shiftsByWeek.get(week) ?? {}} employeeNames={employeeNames} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function ArchiveWeekRow({
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
  const shiftDate = shifts.opening?.start_time ?? shifts.closing?.start_time
  const dateLabel = shiftDate ? weekLabelFormatter.format(new Date(shiftDate)) : weekLabelFormatter.format(shiftDateOfWeek(week))

  return (
    <div className="flex flex-col gap-1 rounded-md border p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span>{dateLabel}</span>
        <span className="text-muted-foreground text-xs">מנהל/ת בר: {managerName}</span>
      </div>
      <div className="flex gap-2">
        <ArchiveShiftSlot shift={shifts.opening} type="opening" />
        <ArchiveShiftSlot shift={shifts.closing} type="closing" />
      </div>
    </div>
  )
}

function ArchiveShiftSlot({ shift, type }: { shift?: Shift; type: ShiftType }) {
  if (!shift) {
    return (
      <span className="text-muted-foreground flex-1 rounded-md border border-dashed px-2 py-1 text-xs">
        {shiftTypeLabel(type)}: לא נפתחה
      </span>
    )
  }

  return (
    <Link
      to={`/shifts/${shift.id}`}
      className="hover:bg-accent/50 flex flex-1 items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs transition-colors"
    >
      <span>{shiftTypeLabel(shift.shift_type)}</span>
      <span className={cn('rounded-full px-2 py-0.5 font-medium', effectiveStatusBadgeClass[shift.effective_status])}>
        {effectiveStatusLabels[shift.effective_status]}
      </span>
    </Link>
  )
}
