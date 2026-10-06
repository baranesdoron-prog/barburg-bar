import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { shiftTypeLabel, shiftAssignmentRoleLabels } from '@/lib/shiftLabels'
import { cn, formatTime } from '@/lib/utils'
import { activeWeekStart, addDays, toDateStr, shiftDateOfWeek } from '@/lib/weeklyChecklist'
import { useConfirmAssign } from '@/hooks/useConfirmAssign'
import { ConfirmAssignDialog } from '@/components/ConfirmAssignDialog'
import { Button } from '@/components/ui/button'
import type { Shift, ShiftAssignment, ShiftAssignmentRole, ShiftManagerAssignment, ShiftType } from '@/lib/types'

const shortDateFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric' })

function friendlyAssignmentError(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'כבר משובצ/ת למשמרת זו'
  return error.message
}

interface WeekShifts {
  opening?: Shift
  closing?: Shift
}

// "בר מנהל" isn't a shift_assignments role like the other three -- it's a
// week-level field on shift_manager_assignments (set_weekly_shift_manager),
// same as it works everywhere else in the app -- but it's still just
// another duty as far as this wizard's picker is concerned.
type Duty = ShiftAssignmentRole | 'bar_manager'

const PICK_LABELS: Record<Duty, string> = {
  bar_manager: 'להתנדב כמנהל/ת בר',
  bartender: 'להתנדב כברמן/ית',
  area_manager: 'להתנדב כאחראי/ת מתחם',
  area_supervisor: 'להתנדב כמנהל/ת מתחם',
}

const LIST_LABELS: Record<Duty, string> = {
  bar_manager: 'משמרות פתוחות לניהול בר',
  bartender: 'משמרות פתוחות לברמנים/יות',
  area_manager: 'משמרות פתוחות לאחראי/ת מתחם',
  area_supervisor: 'משמרות פתוחות למנהל/ת מתחם',
}

// Area manager and area supervisor run on their own hours, distinct from
// the shift's own bartender-facing start/end times -- matches Shifts.tsx.
const AREA_DUTY_HOURS = { opening: '19:45–22:00', closing: '22:00–00:30' }
const AREA_SUPERVISOR_HOURS = '19:45–00:30'

type Step = 'pick' | 'shifts'

// The side-nav link always re-navigates to this same route -- keying on
// the location gives each visit a fresh mount, so the wizard starts back
// at step 1 instead of resuming wherever it was left last time.
export function OnboardingWizard() {
  const location = useLocation()
  return <OnboardingWizardInner key={location.key} />
}

function OnboardingWizardInner() {
  const { appUser, effectiveRole } = useAppUserContext()
  const navigate = useNavigate()
  const myEmployeeId = appUser.employee_id
  const { confirmAssign, dialogState, handleApprove, handleDecline } = useConfirmAssign()

  const [step, setStep] = useState<Step>('pick')
  const [duty, setDuty] = useState<Duty | null>(null)
  const [canSuperviseArea, setCanSuperviseArea] = useState(false)
  const [loadedEligibility, setLoadedEligibility] = useState(false)
  const [shiftsByWeek, setShiftsByWeek] = useState<Map<string, WeekShifts>>(new Map())
  const [assignmentsByShift, setAssignmentsByShift] = useState<Map<string, ShiftAssignment[]>>(new Map())
  const [shiftManagerByWeek, setShiftManagerByWeek] = useState<Map<string, string>>(new Map())
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map())
  const [loadedShifts, setLoadedShifts] = useState(false)
  const [visibleWeekCount, setVisibleWeekCount] = useState(3)
  const [error, setError] = useState<string | null>(null)
  const [assignedCount, setAssignedCount] = useState(0)
  const [finishing, setFinishing] = useState(false)

  const isAdmin = effectiveRole === 'administrator'
  // Bar manager duty is offered only to the roles that can actually hold
  // it (shift_manager/administrator) -- unlike the other three duties,
  // every real account qualifies for those regardless of role.
  const barManagerEligible = effectiveRole === 'shift_manager' || isAdmin

  useEffect(() => {
    async function loadEligibility() {
      if (effectiveRole === 'administrator' || effectiveRole === 'shift_manager') {
        setCanSuperviseArea(true)
        setLoadedEligibility(true)
        return
      }
      if (!myEmployeeId) {
        setLoadedEligibility(true)
        return
      }
      const { data } = await supabase
        .from('employees')
        .select('can_supervise_area')
        .eq('id', myEmployeeId)
        .single()
      setCanSuperviseArea(!!data?.can_supervise_area)
      setLoadedEligibility(true)
    }
    loadEligibility()
  }, [myEmployeeId, effectiveRole])

  async function loadShifts() {
    setLoadedShifts(false)
    const from = toDateStr(activeWeekStart())
    // Fetches a generous window up front so "עוד משמרות" just reveals more
    // of what's already loaded, no extra round trip.
    const to = toDateStr(addDays(activeWeekStart(), 70))

    const [{ data: shiftsData }, { data: shiftManagerData }] = await Promise.all([
      supabase
        .from('shifts_with_effective_status')
        .select('*')
        // Cancelled shifts are fetched too (not filtered out) so they can
        // be shown as cancelled -- same "disabled, not just hidden"
        // treatment as a full shift -- instead of silently disappearing.
        .in('status', ['published', 'cancelled'])
        .gte('week_start', from)
        .lte('week_start', to),
      supabase.from('shift_manager_assignments').select('*').gte('week_start', from).lte('week_start', to),
    ])

    setShiftManagerByWeek(
      new Map(
        ((shiftManagerData as ShiftManagerAssignment[]) ?? []).map((a) => [a.week_start, a.employee_id]),
      ),
    )

    const shifts = (shiftsData as Shift[]) ?? []
    const grouped = new Map<string, WeekShifts>()
    for (const s of shifts) {
      const entry = grouped.get(s.week_start) ?? {}
      const existing = entry[s.shift_type as ShiftType]
      // Prefer a non-cancelled shift over a cancelled duplicate for the
      // same (week, type) -- see the matching fix in Shifts.tsx.
      if (!existing || existing.status === 'cancelled') {
        entry[s.shift_type as ShiftType] = s
      }
      grouped.set(s.week_start, entry)
    }
    setShiftsByWeek(grouped)

    const shiftIds = shifts.map((s) => s.id)
    if (shiftIds.length > 0) {
      const [{ data: assignmentRows }, { data: employeesData }] = await Promise.all([
        supabase.from('shift_assignments').select('*').in('shift_id', shiftIds),
        supabase.from('employees').select('id, full_name'),
      ])
      const byShift = new Map<string, ShiftAssignment[]>()
      for (const row of (assignmentRows as ShiftAssignment[]) ?? []) {
        byShift.set(row.shift_id, [...(byShift.get(row.shift_id) ?? []), row])
      }
      setAssignmentsByShift(byShift)
      setEmployeeNames(
        new Map(((employeesData as { id: string; full_name: string }[]) ?? []).map((e) => [e.id, e.full_name])),
      )
    } else {
      setAssignmentsByShift(new Map())
      setEmployeeNames(new Map())
    }

    setLoadedShifts(true)
  }

  function pickDuty(role: Duty) {
    setDuty(role)
    setStep('shifts')
    setError(null)
    setVisibleWeekCount(3)
    loadShifts()
  }

  async function handleAssign(shift: Shift, role: 'bartender' | 'area_manager') {
    if (!myEmployeeId) return
    setError(null)
    const { error: insertError } = await supabase
      .from('shift_assignments')
      .insert({ shift_id: shift.id, employee_id: myEmployeeId, assignment_role: role })
    if (insertError) {
      setError(friendlyAssignmentError(insertError))
      return
    }
    setAssignedCount((c) => c + 1)
    await loadShifts()
  }

  async function handleRemove(assignmentIds: string[]) {
    if (assignmentIds.length === 0) return
    setError(null)
    const { error: deleteError } = await supabase.from('shift_assignments').delete().in('id', assignmentIds)
    if (deleteError) {
      setError(friendlyAssignmentError(deleteError))
      return
    }
    setAssignedCount((c) => Math.max(0, c - 1))
    await loadShifts()
  }

  async function handleAssignAreaSupervisor(week: WeekShifts) {
    if (!myEmployeeId) return
    const shiftIds = [week.opening?.id, week.closing?.id].filter((v): v is string => !!v)
    if (shiftIds.length === 0) return
    setError(null)
    const rows = shiftIds.map((shift_id) => ({
      shift_id,
      employee_id: myEmployeeId,
      assignment_role: 'area_supervisor' as const,
    }))
    const { error: insertError } = await supabase.from('shift_assignments').insert(rows)
    if (insertError) {
      setError(friendlyAssignmentError(insertError))
      return
    }
    setAssignedCount((c) => c + 1)
    await loadShifts()
  }

  async function handleAssignBarManager(week: string) {
    if (!myEmployeeId) return
    setError(null)
    const { error: rpcError } = await supabase.rpc('set_weekly_shift_manager', {
      p_week_start: week,
      p_employee_id: myEmployeeId,
    })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setAssignedCount((c) => c + 1)
    await loadShifts()
  }

  async function handleRemoveBarManager(week: string) {
    setError(null)
    const { error: rpcError } = await supabase.rpc('set_weekly_shift_manager', {
      p_week_start: week,
      p_employee_id: null,
    })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setAssignedCount((c) => Math.max(0, c - 1))
    await loadShifts()
  }

  async function finish() {
    setFinishing(true)
    await supabase.rpc('mark_onboarding_seen')
    navigate('/shifts')
  }

  if (!loadedEligibility) return null

  if (!myEmployeeId) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <p className="text-muted-foreground text-sm">החשבון שלך אינו משויך לעובד/ת, ולכן לא ניתן לשבץ אותך למשמרת.</p>
        <Button onClick={finish} disabled={finishing}>
          להמשך לאפליקציה
        </Button>
      </div>
    )
  }

  if (step === 'pick') {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-6 py-10">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl font-semibold">ברוך/ה הבא/ה</h1>
          <p className="text-muted-foreground text-sm">מה תרצה/י לעשות היום?</p>
        </div>

        <div className="flex flex-col gap-3">
          {barManagerEligible && (
            <Button
              size="lg"
              className="h-auto justify-start px-5 py-4 text-base"
              onClick={() => pickDuty('bar_manager')}
            >
              {PICK_LABELS.bar_manager}
            </Button>
          )}
          <Button
            size="lg"
            variant={barManagerEligible ? 'outline' : 'default'}
            className="h-auto justify-start px-5 py-4 text-base"
            onClick={() => pickDuty('bartender')}
          >
            {PICK_LABELS.bartender}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-auto justify-start px-5 py-4 text-base"
            onClick={() => pickDuty('area_manager')}
          >
            {PICK_LABELS.area_manager}
          </Button>
          {canSuperviseArea && (
            <Button
              size="lg"
              variant="outline"
              className="h-auto justify-start px-5 py-4 text-base"
              onClick={() => pickDuty('area_supervisor')}
            >
              {PICK_LABELS.area_supervisor}
            </Button>
          )}
        </div>

        <Button variant="ghost" onClick={finish} disabled={finishing}>
          דלג להמשך לאפליקציה
        </Button>
      </div>
    )
  }

  const allWeeks = [...shiftsByWeek.keys()].sort()
  const weeks = allWeeks.slice(0, visibleWeekCount)
  const hasMoreWeeks = allWeeks.length > visibleWeekCount
  const currentWeek = toDateStr(activeWeekStart())

  interface Slot {
    key: string
    dateLabel: string
    typeLabel: string
    hoursLabel: string
    barManagerName?: string
    peerNames: string[]
    status: 'open' | 'mine' | 'full' | 'cancelled'
    namesTitle?: string
    revertible?: boolean
    onClick?: () => void
  }

  const slots: Slot[] = []

  if (duty === 'bartender' || duty === 'area_manager') {
    for (const week of weeks) {
      const shifts = shiftsByWeek.get(week) ?? {}
      const dateLabel = shortDateFormatter.format(shiftDateOfWeek(week))
      const canRevert = week > currentWeek
      const weekBarManagerId = shiftManagerByWeek.get(week)
      const barManagerName = (weekBarManagerId && employeeNames.get(weekBarManagerId)) || '— טרם שובץ —'
      for (const type of ['opening', 'closing'] as ShiftType[]) {
        const shift = shifts[type]
        if (!shift) continue
        if (shift.status === 'cancelled') {
          slots.push({
            key: shift.id,
            dateLabel,
            typeLabel: shiftTypeLabel(shift.shift_type),
            hoursLabel:
              duty === 'area_manager'
                ? AREA_DUTY_HOURS[type]
                : `${formatTime(shift.start_time)}–${formatTime(shift.end_time)}`,
            barManagerName,
            peerNames: [],
            status: 'cancelled',
          })
          continue
        }
        const assignments = (assignmentsByShift.get(shift.id) ?? []).filter((a) => a.assignment_role === duty)
        const max = duty === 'bartender' ? shift.required_staff_count : 2
        const mine = assignments.find((a) => a.employee_id === myEmployeeId)
        const isFull = max !== null && assignments.length >= max
        const peerNames = assignments
          .filter((a) => a.employee_id !== myEmployeeId)
          .map((a) => employeeNames.get(a.employee_id))
          .filter((n): n is string => !!n)
        slots.push({
          key: shift.id,
          dateLabel,
          typeLabel: shiftTypeLabel(shift.shift_type),
          hoursLabel:
            duty === 'area_manager'
              ? AREA_DUTY_HOURS[type]
              : `${formatTime(shift.start_time)}–${formatTime(shift.end_time)}`,
          barManagerName,
          peerNames,
          status: mine ? 'mine' : isFull ? 'full' : 'open',
          namesTitle: mine
            ? canRevert
              ? 'לחיצה נוספת תבטל את השיבוץ'
              : 'משמרת השבוע הנוכחי — לביטול יש להגיש בקשת החלפה בעמוד המשמרת'
            : undefined,
          revertible: !!mine && canRevert,
          onClick: mine
            ? canRevert
              ? () => handleRemove([mine.id])
              : () => navigate(`/shifts/${shift.id}`)
            : !isFull
              ? async () => {
                  const ok = await confirmAssign(dateLabel, shiftAssignmentRoleLabels[duty as 'bartender' | 'area_manager'])
                  if (!ok) return
                  handleAssign(shift, duty as 'bartender' | 'area_manager')
                }
              : undefined,
        })
      }
    }
  } else if (duty === 'area_supervisor') {
    for (const week of weeks) {
      const shifts = shiftsByWeek.get(week) ?? {}
      const dateLabel = shortDateFormatter.format(shiftDateOfWeek(week))
      const canRevert = week > currentWeek
      const weekBarManagerId = shiftManagerByWeek.get(week)
      const barManagerName = (weekBarManagerId && employeeNames.get(weekBarManagerId)) || '— טרם שובץ —'
      const openingActive = shifts.opening && shifts.opening.status !== 'cancelled'
      const closingActive = shifts.closing && shifts.closing.status !== 'cancelled'
      if (!openingActive && !closingActive && (shifts.opening || shifts.closing)) {
        slots.push({
          key: week,
          dateLabel,
          typeLabel: 'משמרת שלמה',
          hoursLabel: AREA_SUPERVISOR_HOURS,
          barManagerName,
          peerNames: [],
          status: 'cancelled',
        })
        continue
      }
      const openingAssignments = (assignmentsByShift.get(shifts.opening?.id ?? '') ?? []).filter(
        (a) => a.assignment_role === 'area_supervisor',
      )
      const closingAssignments = (assignmentsByShift.get(shifts.closing?.id ?? '') ?? []).filter(
        (a) => a.assignment_role === 'area_supervisor',
      )
      const allAssignments = [...openingAssignments, ...closingAssignments]
      const taken = allAssignments.length > 0
      const mine = allAssignments.filter((a) => a.employee_id === myEmployeeId)
      const peerNames = [
        ...new Set(
          allAssignments
            .filter((a) => a.employee_id !== myEmployeeId)
            .map((a) => employeeNames.get(a.employee_id))
            .filter((n): n is string => !!n),
        ),
      ]
      const anyShiftId = shifts.opening?.id ?? shifts.closing?.id
      slots.push({
        key: week,
        dateLabel,
        typeLabel: 'משמרת שלמה',
        hoursLabel: AREA_SUPERVISOR_HOURS,
        barManagerName,
        peerNames,
        status: mine.length > 0 ? 'mine' : taken ? 'full' : 'open',
        namesTitle:
          mine.length > 0
            ? canRevert
              ? 'לחיצה נוספת תבטל את השיבוץ'
              : 'משמרת השבוע הנוכחי — לביטול יש להגיש בקשת החלפה בעמוד המשמרת'
            : undefined,
        revertible: mine.length > 0 && canRevert,
        onClick:
          mine.length > 0
            ? canRevert
              ? () => handleRemove(mine.map((a) => a.id))
              : anyShiftId
                ? () => navigate(`/shifts/${anyShiftId}`)
                : undefined
            : !taken
              ? async () => {
                  const ok = await confirmAssign(dateLabel, shiftAssignmentRoleLabels.area_supervisor)
                  if (!ok) return
                  handleAssignAreaSupervisor(shifts)
                }
              : undefined,
      })
    }
  } else if (duty === 'bar_manager') {
    for (const week of weeks) {
      const shifts = shiftsByWeek.get(week) ?? {}
      const dateLabel = shortDateFormatter.format(shiftDateOfWeek(week))
      const openingActive = shifts.opening && shifts.opening.status !== 'cancelled'
      const closingActive = shifts.closing && shifts.closing.status !== 'cancelled'
      if (!openingActive && !closingActive && (shifts.opening || shifts.closing)) {
        slots.push({
          key: week,
          dateLabel,
          typeLabel: 'משמרת שלמה',
          hoursLabel: AREA_SUPERVISOR_HOURS,
          peerNames: [],
          status: 'cancelled',
        })
        continue
      }
      const assignedEmployeeId = shiftManagerByWeek.get(week) ?? null
      const taken = !!assignedEmployeeId
      const mine = assignedEmployeeId === myEmployeeId
      const name = assignedEmployeeId ? employeeNames.get(assignedEmployeeId) : undefined
      const hoursLabel =
        shifts.opening && shifts.closing
          ? `${formatTime(shifts.opening.start_time)}–${formatTime(shifts.closing.end_time)}`
          : AREA_SUPERVISOR_HOURS
      // Matches BarManagerRow in Shifts.tsx: a bar manager (non-admin) can
      // only fill an empty week, never touch an existing assignment --
      // their own or anyone else's. An administrator can revert any week
      // (set_weekly_shift_manager has no week-timing restriction, unlike
      // the strictly-future-week rule for the other three duties).
      slots.push({
        key: week,
        dateLabel,
        typeLabel: 'משמרת שלמה',
        hoursLabel,
        peerNames: !mine && name ? [name] : [],
        status: mine ? 'mine' : taken ? 'full' : 'open',
        namesTitle: mine
          ? isAdmin
            ? 'לחיצה נוספת תבטל את השיבוץ'
            : 'לביטול שיבוץ מנהל/ת בר יש לפנות לאדמין בעמוד המשמרות'
          : undefined,
        revertible: mine && isAdmin,
        onClick: mine
          ? isAdmin
            ? () => handleRemoveBarManager(week)
            : undefined
          : !taken
            ? async () => {
                const ok = await confirmAssign(dateLabel, 'מנהל/ת בר')
                if (!ok) return
                handleAssignBarManager(week)
              }
            : undefined,
      })
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
      <ConfirmAssignDialog state={dialogState} onApprove={handleApprove} onDecline={handleDecline} />
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setStep('pick')}>
          חזרה
        </Button>
        <h1 className="text-base font-semibold">{duty ? LIST_LABELS[duty] : ''}</h1>
      </div>

      <p className="text-center text-lg font-bold">לאיזה משמרת תרצה/י להשתבץ?</p>

      {!loadedShifts && <p className="text-muted-foreground text-center text-sm">טוען...</p>}

      {loadedShifts && slots.length === 0 && (
        <p className="text-muted-foreground text-center text-sm">אין כרגע משמרות פתוחות.</p>
      )}

      {loadedShifts && slots.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5">
          {slots.map((slot) => (
            <button
              key={slot.key}
              type="button"
              disabled={!slot.onClick}
              onClick={slot.onClick}
              title={slot.namesTitle}
              className={cn(
                'relative flex flex-col items-start gap-1 overflow-hidden rounded-xl border p-3 text-right transition-colors',
                slot.status === 'open' && slot.onClick && 'hover:border-primary hover:bg-accent cursor-pointer',
                slot.status === 'mine' && 'border-green-200 bg-green-50',
                slot.status === 'mine' &&
                  slot.revertible &&
                  'hover:border-destructive hover:bg-destructive/10 cursor-pointer',
                slot.status === 'mine' &&
                  slot.onClick &&
                  !slot.revertible &&
                  'hover:border-primary hover:bg-accent cursor-pointer',
                slot.status === 'full' && 'bg-muted opacity-60',
                slot.status === 'cancelled' && 'bg-muted opacity-60',
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-sm font-semibold">{slot.typeLabel}</span>
                <span className="text-muted-foreground text-[11px]">{slot.dateLabel}</span>
              </div>
              <span className="text-muted-foreground text-[11px]">{slot.hoursLabel}</span>
              {slot.barManagerName && (
                <span className="text-muted-foreground text-[10px]">מנהל/ת בר: {slot.barManagerName}</span>
              )}
              {slot.peerNames.length > 0 && (
                <span className="text-muted-foreground text-[10px]">גם: {slot.peerNames.join(', ')}</span>
              )}
              {slot.status === 'mine' && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                  ✓ משובץ
                </span>
              )}
              {slot.status === 'full' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="-rotate-12 rounded-md border-2 border-red-600/70 px-2 py-0.5 text-[11px] font-bold text-red-600/70">
                    משמרת מלאה
                  </span>
                </div>
              )}
              {slot.status === 'cancelled' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="-rotate-12 rounded-md border-2 border-slate-500/70 px-2 py-0.5 text-[11px] font-bold text-slate-600/70">
                    משמרת מבוטלת
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}

      {assignedCount > 0 && (
        <p className="text-center text-sm text-green-600">שובצת ל־{assignedCount} משמרות עד כה.</p>
      )}

      {loadedShifts && hasMoreWeeks && (
        <Button
          variant="outline"
          onClick={() =>
            setVisibleWeekCount((c) => c + (duty === 'area_supervisor' || duty === 'bar_manager' ? 6 : 3))
          }
        >
          עוד משמרות
        </Button>
      )}

      <Button className="bg-green-600 text-white hover:bg-green-700" onClick={finish} disabled={finishing}>
        סיימנו!
      </Button>
    </div>
  )
}
