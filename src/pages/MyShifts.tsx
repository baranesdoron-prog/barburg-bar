import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { effectiveStatusLabels, effectiveStatusBadgeClass, shiftTypeLabel } from '@/lib/shiftLabels'
import { activeWeekStart, toDateStr, weekLabelFormatter, shiftDateOfWeek, addDays } from '@/lib/weeklyChecklist'
import { cn, formatDateTime, formatTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SelfCheckIn } from '@/components/SelfCheckIn'
import { useConfirmAssign } from '@/hooks/useConfirmAssign'
import { ConfirmAssignDialog } from '@/components/ConfirmAssignDialog'
import { useInfoDialog } from '@/hooks/useInfoDialog'
import { InfoDialog } from '@/components/InfoDialog'
import { shiftAssignmentRoleLabels } from '@/lib/shiftLabels'
import type { Shift, ShiftAssignment, ShiftType } from '@/lib/types'

interface Employee {
  id: string
  full_name: string
}

interface AssignedStaffer {
  assignmentId: string
  employeeId: string
  name: string
}

interface UpcomingShift {
  shift: Shift
  assignedStaff: AssignedStaffer[]
  ownAssignment: ShiftAssignment | null
}

interface WeekShifts {
  opening?: UpcomingShift
  closing?: UpcomingShift
}

export function MyShifts() {
  return <MyShiftsView assignedOnly={false} />
}

export function MyAssignedShifts() {
  return <MyShiftsView assignedOnly />
}

function MyShiftsView({ assignedOnly }: { assignedOnly: boolean }) {
  const { appUser } = useAppUserContext()
  const [shiftsByWeek, setShiftsByWeek] = useState<Map<string, WeekShifts> | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const currentWeekStart = toDateStr(activeWeekStart())
  const threeMonthsOut = toDateStr(addDays(activeWeekStart(), 13 * 7))

  async function load() {
    const { data: shiftsData } = await supabase
      .from('shifts_with_effective_status')
      .select('*')
      .eq('status', 'published')
      .gte('week_start', currentWeekStart)
      .lte('week_start', threeMonthsOut)
      .order('start_time')

    const shifts = (shiftsData as Shift[]) ?? []

    if (shifts.length === 0) {
      setShiftsByWeek(new Map())
      setEmployees([])
      return
    }

    const shiftIds = shifts.map((s) => s.id)

    const [assignmentsRes, employeesRes] = await Promise.all([
      supabase.from('shift_assignments').select('*').in('shift_id', shiftIds),
      supabase.from('employees').select('id, full_name').eq('active', true).order('full_name'),
    ])

    const assignments = (assignmentsRes.data as ShiftAssignment[]) ?? []
    const activeEmployees = (employeesRes.data as Employee[]) ?? []
    setEmployees(activeEmployees)
    const employeeNames = new Map(activeEmployees.map((e) => [e.id, e.full_name]))

    const grouped = new Map<string, WeekShifts>()
    for (const shift of shifts) {
      // The peer list and join/leave actions below are bartender
      // self-service only (handleJoin always inserts that role), so the
      // roster stays scoped to bartender rows -- but "is it my shift"
      // can't be: a bartender-role account can still be given another
      // duty (area_supervisor, area_manager) by a manager, and they need
      // to see and check in to that too, not just a bartender booking.
      const shiftAssignments = assignments.filter(
        (a) => a.shift_id === shift.id && a.assignment_role === 'bartender',
      )
      const ownAssignment =
        assignments.find((a) => a.shift_id === shift.id && a.employee_id === appUser.employee_id) ?? null

      const item: UpcomingShift = {
        shift,
        assignedStaff: shiftAssignments.map((a) => ({
          assignmentId: a.id,
          employeeId: a.employee_id,
          name: employeeNames.get(a.employee_id) ?? '—',
        })),
        ownAssignment,
      }

      const entry = grouped.get(shift.week_start) ?? {}
      entry[shift.shift_type as ShiftType] = item
      grouped.set(shift.week_start, entry)
    }

    setShiftsByWeek(grouped)
  }

  useEffect(() => {
    load()
  }, [])

  if (shiftsByWeek === null) return null

  const pageTitle = assignedOnly ? 'המשמרות שלי' : 'שיבוצי משמרת'

  const visibleShiftsByWeek = assignedOnly
    ? new Map(
        [...shiftsByWeek.entries()]
          .map(([week, weekShifts]): [string, WeekShifts] => [
            week,
            {
              opening: weekShifts.opening?.ownAssignment ? weekShifts.opening : undefined,
              closing: weekShifts.closing?.ownAssignment ? weekShifts.closing : undefined,
            },
          ])
          .filter(([, weekShifts]) => weekShifts.opening || weekShifts.closing),
      )
    : shiftsByWeek

  const weeks = [...visibleShiftsByWeek.keys()].sort()

  if (!appUser.employee_id) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <h1 className="text-xl font-semibold">{pageTitle}</h1>
        <p className="text-muted-foreground text-sm">
          תצוגה זו זמינה רק למשתמש/ת המשויכ/ת לעובד/ת. אם זו תצוגה מקדימה של תפקיד ברמן/ית, פעולות כמו הצטרפות למשמרת
          אינן זמינות בתצוגה מקדימה.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">{pageTitle}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">שלושת החודשים הקרובים</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {weeks.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {assignedOnly ? 'אינך משובצ/ת לאף משמרת קרובה.' : 'אין משמרות פתוחות כרגע.'}
            </p>
          )}

          {weeks.map((week) => (
            <WeekRow
              key={week}
              week={week}
              weekShifts={visibleShiftsByWeek.get(week)!}
              employees={employees}
              currentWeekStart={currentWeekStart}
              employeeId={appUser.employee_id!}
              onChanged={load}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function WeekRow({
  week,
  weekShifts,
  currentWeekStart,
  employees,
  employeeId,
  onChanged,
}: {
  week: string
  weekShifts: WeekShifts
  currentWeekStart: string
  employees: Employee[]
  employeeId: string
  onChanged: () => void
}) {
  const managerId = weekShifts.opening?.shift.shift_manager_id ?? weekShifts.closing?.shift.shift_manager_id
  const managerName = managerId ? (employees.find((e) => e.id === managerId)?.full_name ?? '—') : '—'
  const shiftDate = weekShifts.opening?.shift.start_time ?? weekShifts.closing?.shift.start_time
  const dateLabel = shiftDate ? weekLabelFormatter.format(new Date(shiftDate)) : weekLabelFormatter.format(shiftDateOfWeek(week))

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">שבוע {dateLabel}</span>
        <span className="text-muted-foreground text-xs">מנהל/ת בר: {managerName}</span>
      </div>
      {weekShifts.opening && <ShiftStatusLine item={weekShifts.opening} />}
      {weekShifts.closing && <ShiftStatusLine item={weekShifts.closing} />}
      <BartenderDuty
        weekShifts={weekShifts}
        currentWeekStart={currentWeekStart}
        employeeId={employeeId}
        onChanged={onChanged}
      />
    </div>
  )
}

// Read-only per-instance status (each half of the evening has its own
// lifecycle) plus the self check-in control, which still needs the
// specific shift_assignment_id for whichever instance is currently
// check-in-able. The actual join/leave decision lives in BartenderDuty
// below, one control for the whole evening.
function ShiftStatusLine({ item }: { item: UpcomingShift }) {
  const { shift, ownAssignment } = item

  return (
    <div className="flex flex-col gap-1 border-t pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between">
        <span className="font-medium">{shiftTypeLabel(shift.shift_type)}</span>
        <span
          className={cn(
            'rounded-full px-2 py-1 text-xs font-medium',
            effectiveStatusBadgeClass[shift.effective_status],
          )}
        >
          {effectiveStatusLabels[shift.effective_status]}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        {formatDateTime(shift.start_time)} – {formatDateTime(shift.end_time)}
      </p>
      {ownAssignment && ownAssignment.assignment_role !== 'bartender' && (
        <p className="text-xs font-medium text-green-700">
          את/ה משובץ/ת כ{shiftAssignmentRoleLabels[ownAssignment.assignment_role]}
        </p>
      )}
      {(shift.effective_status === 'active' || shift.effective_status === 'waiting_for_closure') &&
        ownAssignment && <SelfCheckIn shiftAssignmentId={ownAssignment.id} />}
    </div>
  )
}

// Bartender is a whole-evening duty: joining/leaving always covers both
// of the week's shift instances at once (one shift_assignments row
// each), same mechanism as the manager-side unified duty in Shifts.tsx.
function BartenderDuty({
  weekShifts,
  currentWeekStart,
  employeeId,
  onChanged,
}: {
  weekShifts: WeekShifts
  currentWeekStart: string
  employeeId: string
  onChanged: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { confirmAssign, dialogState, handleApprove, handleDecline } = useConfirmAssign()
  const { showInfo, infoState, handleClose } = useInfoDialog()

  const openingShift = weekShifts.opening?.shift
  const closingShift = weekShifts.closing?.shift
  const anyShift = openingShift ?? closingShift
  if (!anyShift) return null

  const isFutureWeek = anyShift.week_start > currentWeekStart

  interface Bartender {
    name: string
    assignmentIds: string[]
    openingAssignmentId?: string
    closingAssignmentId?: string
  }
  const byEmployee = new Map<string, Bartender>()
  for (const [side, item] of [
    ['opening', weekShifts.opening],
    ['closing', weekShifts.closing],
  ] as const) {
    if (!item) continue
    for (const s of item.assignedStaff) {
      const existing = byEmployee.get(s.employeeId)
      const entry = existing ?? { name: s.name, assignmentIds: [] }
      entry.assignmentIds.push(s.assignmentId)
      if (side === 'opening') entry.openingAssignmentId = s.assignmentId
      else entry.closingAssignmentId = s.assignmentId
      byEmployee.set(s.employeeId, entry)
    }
  }
  const bartenders = [...byEmployee.entries()].map(([id, v]) => ({ employeeId: id, ...v }))
  const mine = bartenders.find((b) => b.employeeId === employeeId)
  const max = openingShift?.required_staff_count ?? closingShift?.required_staff_count ?? null
  // Per-side room, not a combined count -- a bar manager can split a
  // bartender's pairing in Shifts.tsx, leaving one side open while the
  // other is already full.
  const openingCount = weekShifts.opening?.assignedStaff.length ?? 0
  const closingCount = weekShifts.closing?.assignedStaff.length ?? 0
  const openingHasRoom = !!openingShift && (max === null || openingCount < max)
  const closingHasRoom = !!closingShift && (max === null || closingCount < max)
  const isFull = !openingHasRoom && !closingHasRoom
  const partialLabel =
    mine && mine.assignmentIds.length === 1 ? (mine.openingAssignmentId ? 'פתיחה בלבד' : 'סגירה בלבד') : null

  const hoursLabel =
    openingShift && closingShift
      ? `${formatTime(openingShift.start_time)}–${formatTime(closingShift.end_time)}`
      : openingShift
        ? `${formatTime(openingShift.start_time)}–${formatTime(openingShift.end_time)}`
        : closingShift
          ? `${formatTime(closingShift.start_time)}–${formatTime(closingShift.end_time)}`
          : ''

  async function handleJoin() {
    setSubmitting(true)
    setError(null)

    const rows = [
      openingHasRoom ? openingShift!.id : null,
      closingHasRoom ? closingShift!.id : null,
    ]
      .filter((id): id is string => !!id)
      .map((shift_id) => ({ shift_id, employee_id: employeeId, assignment_role: 'bartender' as const }))

    const { error: joinError } = await supabase.from('shift_assignments').insert(rows)

    setSubmitting(false)

    if (joinError) {
      setError('לא ניתן להצטרף למשמרת זו כרגע')
      return
    }

    onChanged()
  }

  async function handleLeave() {
    if (!mine) return

    const { error: leaveError } = await supabase.from('shift_assignments').delete().in('id', mine.assignmentIds)

    if (leaveError) {
      setError('לא ניתן לעזוב את המשמרת')
      return
    }

    onChanged()
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      <p className="text-sm">
        <span className="text-muted-foreground">ברמנים/יות: </span>
        {bartenders.length > 0 ? bartenders.map((b) => b.name).join(', ') : 'אין עדיין משובצים'}
      </p>

      {partialLabel && <p className="text-muted-foreground text-xs">את/ה משובץ/ת — {partialLabel}</p>}

      {!mine && (
        <Button disabled={isFull || submitting} onClick={handleJoin}>
          {isFull ? 'המשמרת מלאה' : 'הצטרפות למשמרת'}
        </Button>
      )}

      {mine && isFutureWeek && (
        <Button
          variant="outline"
          onClick={async () => {
            const ok = await confirmAssign({
              title: 'איזה באסה! לא מסתדר?',
              action: 'remove',
              dateLabel: weekLabelFormatter.format(new Date(anyShift.start_time)),
              hoursLabel,
              positionLabel: shiftAssignmentRoleLabels.bartender,
            })
            if (!ok) return
            handleLeave()
          }}
        >
          עזיבת משמרת
        </Button>
      )}

      {mine && !isFutureWeek && (
        <Button
          variant="outline"
          onClick={() =>
            showInfo({
              title: 'איזה באסה! לא מסתדר?',
              body: 'לא ניתן לבטל משמרת בסמיכות למועד המשמרת. אנא צור/י קשר עם מנהל הבר של המשמרת.',
            })
          }
        >
          ביטול
        </Button>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}

      <ConfirmAssignDialog state={dialogState} onApprove={handleApprove} onDecline={handleDecline} />
      <InfoDialog state={infoState} onClose={handleClose} />
    </div>
  )
}
