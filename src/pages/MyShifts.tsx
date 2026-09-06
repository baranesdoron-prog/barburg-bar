import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { effectiveStatusLabels, effectiveStatusBadgeClass, shiftTypeLabel } from '@/lib/shiftLabels'
import { activeWeekStart, toDateStr, weekLabelFormatter, parseDateStr, addDays } from '@/lib/weeklyChecklist'
import { cn, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SelfCheckIn } from '@/components/SelfCheckIn'
import type { ReplacementRequest, Shift, ShiftAssignment, ShiftType } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

interface Employee {
  id: string
  full_name: string
}

interface AssignedStaffer {
  assignmentId: string
  employeeId: string
  name: string
  role: string | null
}

interface UpcomingShift {
  shift: Shift
  assignedStaff: AssignedStaffer[]
  ownAssignment: ShiftAssignment | null
  pendingRequest: ReplacementRequest | null
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

    const [assignmentsRes, employeesRes, rolesRes] = await Promise.all([
      supabase.from('shift_assignments').select('*').in('shift_id', shiftIds),
      supabase.from('employees').select('id, full_name').eq('active', true).order('full_name'),
      supabase.rpc('list_employee_roles'),
    ])

    const assignments = (assignmentsRes.data as ShiftAssignment[]) ?? []
    const activeEmployees = (employeesRes.data as Employee[]) ?? []
    setEmployees(activeEmployees)
    const employeeNames = new Map(activeEmployees.map((e) => [e.id, e.full_name]))
    const employeeRoles = new Map(
      ((rolesRes.data as { employee_id: string; role: string | null }[]) ?? []).map((u) => [
        u.employee_id,
        u.role,
      ]),
    )

    const ownAssignmentIds = assignments
      .filter((a) => a.employee_id === appUser.employee_id)
      .map((a) => a.id)

    const { data: requestsData } =
      ownAssignmentIds.length > 0
        ? await supabase
            .from('replacement_requests')
            .select('*')
            .in('shift_assignment_id', ownAssignmentIds)
            .eq('status', 'pending')
        : { data: [] }

    const requestsByAssignment = new Map(
      ((requestsData as ReplacementRequest[]) ?? []).map((r) => [r.shift_assignment_id, r]),
    )

    const grouped = new Map<string, WeekShifts>()
    for (const shift of shifts) {
      const shiftAssignments = assignments.filter((a) => a.shift_id === shift.id)
      const ownAssignment = shiftAssignments.find((a) => a.employee_id === appUser.employee_id) ?? null

      const item: UpcomingShift = {
        shift,
        assignedStaff: shiftAssignments.map((a) => ({
          assignmentId: a.id,
          employeeId: a.employee_id,
          name: employeeNames.get(a.employee_id) ?? '—',
          role: employeeRoles.get(a.employee_id) ?? null,
        })),
        ownAssignment,
        pendingRequest: ownAssignment ? (requestsByAssignment.get(ownAssignment.id) ?? null) : null,
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
              viewerRole={appUser.role}
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
  employees,
  currentWeekStart,
  employeeId,
  viewerRole,
  onChanged,
}: {
  week: string
  weekShifts: WeekShifts
  employees: Employee[]
  currentWeekStart: string
  employeeId: string
  viewerRole: string | null
  onChanged: () => void
}) {
  const managerId = weekShifts.opening?.shift.shift_manager_id ?? weekShifts.closing?.shift.shift_manager_id
  const managerName = managerId ? (employees.find((e) => e.id === managerId)?.full_name ?? '—') : '—'

  const weekStaff = [...(weekShifts.opening?.assignedStaff ?? []), ...(weekShifts.closing?.assignedStaff ?? [])]
  const weekAreaManagerId = weekStaff.find((s) => s.role === 'area_manager')?.employeeId ?? null

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">שבוע {weekLabelFormatter.format(parseDateStr(week))}</span>
        <span className="text-muted-foreground text-xs">מנהל/ת בר: {managerName}</span>
      </div>
      {weekShifts.opening && (
        <ShiftSlot
          item={weekShifts.opening}
          employees={employees}
          currentWeekStart={currentWeekStart}
          employeeId={employeeId}
          viewerRole={viewerRole}
          weekAreaManagerId={weekAreaManagerId}
          onChanged={onChanged}
        />
      )}
      {weekShifts.opening && weekShifts.closing && <div className="border-t" />}
      {weekShifts.closing && (
        <ShiftSlot
          item={weekShifts.closing}
          employees={employees}
          currentWeekStart={currentWeekStart}
          employeeId={employeeId}
          viewerRole={viewerRole}
          weekAreaManagerId={weekAreaManagerId}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}

function ShiftSlot({
  item,
  employees,
  currentWeekStart,
  employeeId,
  viewerRole,
  weekAreaManagerId,
  onChanged,
}: {
  item: UpcomingShift
  employees: Employee[]
  currentWeekStart: string
  employeeId: string
  viewerRole: string | null
  weekAreaManagerId: string | null
  onChanged: () => void
}) {
  const { shift, assignedStaff, ownAssignment, pendingRequest } = item
  const [showForm, setShowForm] = useState(false)
  const [reason, setReason] = useState('')
  const [substituteId, setSubstituteId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isFutureWeek = shift.week_start > currentWeekStart
  const isAreaManagerTaken =
    viewerRole === 'area_manager' && weekAreaManagerId !== null && weekAreaManagerId !== employeeId
  const isFull =
    (shift.required_staff_count !== null && assignedStaff.length >= shift.required_staff_count) ||
    isAreaManagerTaken
  const canRequestReplacement = shift.effective_status === 'published' && !pendingRequest

  async function handleJoin() {
    setSubmitting(true)
    setError(null)

    const { error: joinError } = await supabase
      .from('shift_assignments')
      .insert({ shift_id: shift.id, employee_id: employeeId })

    setSubmitting(false)

    if (joinError) {
      setError('לא ניתן להצטרף למשמרת זו כרגע')
      return
    }

    onChanged()
  }

  async function handleLeave() {
    if (!ownAssignment) return
    if (!confirm('לעזוב את המשמרת?')) return

    const { error: leaveError } = await supabase
      .from('shift_assignments')
      .delete()
      .eq('id', ownAssignment.id)

    if (leaveError) {
      setError('לא ניתן לעזוב את המשמרת')
      return
    }

    onChanged()
  }

  async function handleSubmitReplacement() {
    if (!ownAssignment) return

    setSubmitting(true)
    setError(null)

    const { error: requestError } = await supabase.rpc('request_replacement', {
      p_shift_assignment_id: ownAssignment.id,
      p_reason: reason.trim() || null,
      p_substitute_employee_id: substituteId || null,
    })

    setSubmitting(false)

    if (requestError) {
      setError(requestError.message)
      return
    }

    setShowForm(false)
    setReason('')
    setSubstituteId('')
    onChanged()
  }

  return (
    <div className="flex flex-col gap-3">
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
      <p className="text-muted-foreground text-sm">
        {formatDateTime(shift.start_time)} – {formatDateTime(shift.end_time)}
      </p>

      <p className="text-sm">
        <span className="text-muted-foreground">משובצים: </span>
        {assignedStaff.length > 0 ? assignedStaff.map((s) => s.name).join(', ') : 'אין עדיין משובצים'}
      </p>

      {(shift.effective_status === 'active' || shift.effective_status === 'waiting_for_closure') &&
        ownAssignment && <SelfCheckIn shiftAssignmentId={ownAssignment.id} />}

      {!ownAssignment && (
        <Button disabled={isFull || submitting} onClick={handleJoin}>
          {isFull ? 'המשמרת מלאה' : 'הצטרפות למשמרת'}
        </Button>
      )}

      {ownAssignment && isFutureWeek && (
        <Button variant="outline" onClick={handleLeave}>
          עזיבת משמרת
        </Button>
      )}

      {ownAssignment && !isFutureWeek && (
        <>
          {pendingRequest && (
            <p className="text-muted-foreground text-sm">בקשת החלפה נשלחה, ממתינה לאישור.</p>
          )}

          {canRequestReplacement && !showForm && (
            <Button variant="outline" onClick={() => setShowForm(true)}>
              בקש/י החלפה
            </Button>
          )}

          {canRequestReplacement && showForm && (
            <div className="flex flex-col gap-2">
              <textarea
                className={selectClass + ' min-h-16'}
                placeholder="סיבה (לא חובה)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <select
                className={selectClass}
                value={substituteId}
                onChange={(e) => setSubstituteId(e.target.value)}
              >
                <option value="">הצעת מחליף/ה (לא חובה)</option>
                {employees
                  .filter((e) => e.id !== ownAssignment.employee_id)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}
                    </option>
                  ))}
              </select>
              <div className="flex gap-2">
                <Button className="flex-1" disabled={submitting} onClick={handleSubmitReplacement}>
                  שליחת בקשה
                </Button>
                <Button variant="ghost" className="flex-1" onClick={() => setShowForm(false)}>
                  ביטול
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  )
}
