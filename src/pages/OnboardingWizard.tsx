import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Martini, Beer, Users, ShieldCheck, ChevronLeft, type LucideIcon } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { shiftAssignmentRoleLabels } from '@/lib/shiftLabels'
import { formatTime } from '@/lib/utils'
import { activeWeekStart, addDays, toDateStr, shiftDateOfWeek } from '@/lib/weeklyChecklist'
import { useConfirmAssign } from '@/hooks/useConfirmAssign'
import { ConfirmAssignDialog } from '@/components/ConfirmAssignDialog'
import { useInfoDialog } from '@/hooks/useInfoDialog'
import { InfoDialog } from '@/components/InfoDialog'
import { C } from '@/lib/designTokens'
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

// Same duty icons/colors as the redesigned /shifts page.
const DUTY_ICON: Record<Duty, LucideIcon> = {
  bar_manager: Martini,
  bartender: Beer,
  area_manager: Users,
  area_supervisor: ShieldCheck,
}
const DUTY_ICON_BG: Record<Duty, string> = {
  bar_manager: C.primary,
  bartender: C.accent,
  area_manager: '#3F8F6B',
  area_supervisor: C.info,
}

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
  // Set when the viewer is only on one half of a whole-evening duty
  // (a bar manager split their pairing in Shifts.tsx) -- "פתיחה בלבד" /
  // "סגירה בלבד", shown next to the "✓ משובץ" badge.
  partialLabel?: string
  // Set when only one side is actually relevant (a lone open slot, or
  // the viewer's own partial assignment) -- "משמרת פתיחה"/"משמרת סגירה",
  // shown in orange right in the title, next to the hours.
  sideTypeLabel?: string
  onClick?: () => void
}

function DutyTile({ icon: Icon, iconBg, label, onClick }: { icon: LucideIcon; iconBg: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border p-3.5 text-start"
      style={{ background: C.card, borderColor: C.border }}
    >
      <div className="flex size-[46px] shrink-0 items-center justify-center rounded-2xl" style={{ background: iconBg }}>
        <Icon className="size-[22px] text-white" />
      </div>
      <span className="flex-1 text-base font-bold" style={{ color: C.text }}>
        {label}
      </span>
      <ChevronLeft className="size-[18px] shrink-0" style={{ color: C.textMuted }} />
    </button>
  )
}

function SlotCard({ slot, duty }: { slot: Slot; duty: Duty }) {
  const Icon = DUTY_ICON[duty]
  const mine = slot.status === 'mine'
  const full = slot.status === 'full'
  const cancelled = slot.status === 'cancelled'
  const muted = full || cancelled

  return (
    <button
      type="button"
      disabled={!slot.onClick}
      onClick={slot.onClick}
      title={slot.namesTitle}
      className="relative flex w-full flex-col items-start gap-1 rounded-2xl border text-start disabled:cursor-default"
      style={{
        background: mine ? C.successBg : muted ? C.subtleBg : C.card,
        borderColor: mine ? '#BEE6CF' : C.border,
        opacity: muted ? 0.75 : 1,
        paddingTop: 20,
        paddingBottom: 14,
        paddingRight: 16,
        paddingLeft: 14,
      }}
    >
      <div
        className="absolute flex size-9 items-center justify-center rounded-full ring-4"
        style={{ background: muted ? '#B9BFBA' : DUTY_ICON_BG[duty], ['--tw-ring-color' as string]: C.appBg, top: -16, right: 14 }}
      >
        <Icon className="size-4 text-white" />
      </div>

      {(mine || full || cancelled) && (
        <span
          className="absolute rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={{
            background: mine ? C.card : C.border,
            color: mine ? C.success : C.textMuted,
            top: 10,
            left: 12,
          }}
        >
          {mine ? `✓ משובץ${slot.partialLabel ? ` (${slot.partialLabel})` : ''}` : cancelled ? 'מבוטלת' : 'מלאה'}
        </span>
      )}

      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-[15px] font-bold" style={{ color: muted ? C.textSecondary : C.text }}>
          {slot.typeLabel}{' '}
          {slot.sideTypeLabel && (
            <span style={{ color: C.warning }}>{slot.sideTypeLabel} </span>
          )}
          <span className="font-medium" style={{ color: mine ? C.primaryHover : C.textMuted }}>
            {slot.hoursLabel}
          </span>
        </span>
        <span className="shrink-0 text-[13px]" style={{ color: mine ? C.primaryHover : C.textMuted }}>
          {slot.dateLabel}
        </span>
      </div>
      {slot.barManagerName && (
        <span className="text-[13px]" style={{ color: mine ? C.primaryHover : C.textMuted }}>
          מנהל/ת בר: {slot.barManagerName}
        </span>
      )}
      {slot.peerNames.length > 0 && (
        <span className="text-[13px]" style={{ color: C.textMuted }}>
          גם: {slot.peerNames.join(', ')}
        </span>
      )}
    </button>
  )
}

function WizardHeader({ back }: { back: { label: string; onClick: () => void } }) {
  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-end border-b px-4 py-3"
      style={{ background: C.card, borderColor: C.border }}
    >
      <button
        type="button"
        onClick={back.onClick}
        className="flex items-center gap-1 text-sm font-semibold"
        style={{ color: C.textSecondary }}
      >
        <ChevronLeft className="size-4" />
        {back.label}
      </button>
    </header>
  )
}

function WizardShell({ children }: { children: ReactNode }) {
  return (
    <div dir="rtl" className="min-h-svh pb-10" style={{ background: C.appBg, color: C.text }}>
      {children}
    </div>
  )
}

// Area manager and area supervisor run on their own hours, distinct from
// the shift's own bartender-facing start/end times -- matches Shifts.tsx.
// Both are whole-evening duties, one continuous window.
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
  const { showInfo, infoState, handleClose } = useInfoDialog()

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

  // Bartender, area manager and area supervisor are all whole-evening
  // duties: a self-associate click normally covers both the week's shift
  // instances at once (one shift_assignments row each). A bar manager can
  // split a bartender's pairing in two from Shifts.tsx though, leaving
  // only one side open -- only insert into the side(s) that actually
  // have room, so picking up a lone vacated side (instead of always
  // requiring both) works too.
  async function handleAssignDuty(week: WeekShifts, role: ShiftAssignmentRole) {
    if (!myEmployeeId) return
    const openingAssignments = (assignmentsByShift.get(week.opening?.id ?? '') ?? []).filter(
      (a) => a.assignment_role === role,
    )
    const closingAssignments = (assignmentsByShift.get(week.closing?.id ?? '') ?? []).filter(
      (a) => a.assignment_role === role,
    )
    const max = role === 'bartender' ? (week.opening?.required_staff_count ?? week.closing?.required_staff_count ?? 3) : role === 'area_manager' ? 2 : 1
    const shiftIds = [
      week.opening && week.opening.status !== 'cancelled' && openingAssignments.length < max ? week.opening.id : null,
      week.closing && week.closing.status !== 'cancelled' && closingAssignments.length < max ? week.closing.id : null,
    ].filter((v): v is string => !!v)
    if (shiftIds.length === 0) return
    setError(null)
    const rows = shiftIds.map((shift_id) => ({ shift_id, employee_id: myEmployeeId, assignment_role: role }))
    const { error: insertError } = await supabase.from('shift_assignments').insert(rows)
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
      <WizardShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-16 text-center">
          <p className="text-sm" style={{ color: C.textMuted }}>
            החשבון שלך אינו משויך לעובד/ת, ולכן לא ניתן לשבץ אותך למשמרת.
          </p>
          <button
            type="button"
            onClick={finish}
            disabled={finishing}
            className="h-11 rounded-xl px-5 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: C.primary }}
          >
            להמשך לאפליקציה
          </button>
        </div>
      </WizardShell>
    )
  }

  if (step === 'pick') {
    return (
      <WizardShell>
        <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
          <div
            className="flex flex-col gap-1 rounded-2xl p-4 text-center"
            style={{ background: C.primaryLight }}
          >
            <h1 className="text-xl font-bold" style={{ color: C.primary }}>
              ברוך/ה הבא/ה!
            </h1>
            <p className="text-sm" style={{ color: C.primaryHover }}>
              מה תרצה/י לעשות היום?
            </p>
          </div>

          <div className="flex flex-col gap-2.5">
            {barManagerEligible && (
              <DutyTile
                icon={DUTY_ICON.bar_manager}
                iconBg={DUTY_ICON_BG.bar_manager}
                label={PICK_LABELS.bar_manager}
                onClick={() => pickDuty('bar_manager')}
              />
            )}
            <DutyTile
              icon={DUTY_ICON.bartender}
              iconBg={DUTY_ICON_BG.bartender}
              label={PICK_LABELS.bartender}
              onClick={() => pickDuty('bartender')}
            />
            <DutyTile
              icon={DUTY_ICON.area_manager}
              iconBg={DUTY_ICON_BG.area_manager}
              label={PICK_LABELS.area_manager}
              onClick={() => pickDuty('area_manager')}
            />
            {canSuperviseArea && (
              <DutyTile
                icon={DUTY_ICON.area_supervisor}
                iconBg={DUTY_ICON_BG.area_supervisor}
                label={PICK_LABELS.area_supervisor}
                onClick={() => pickDuty('area_supervisor')}
              />
            )}
          </div>

          <button
            type="button"
            onClick={finish}
            disabled={finishing}
            className="self-center px-1 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ color: C.textMuted }}
          >
            דלג להמשך לאפליקציה
          </button>
        </div>
      </WizardShell>
    )
  }

  const allWeeks = [...shiftsByWeek.keys()].sort()
  const weeks = allWeeks.slice(0, visibleWeekCount)
  const hasMoreWeeks = allWeeks.length > visibleWeekCount
  const currentWeek = toDateStr(activeWeekStart())

  const slots: Slot[] = []

  // Bartender, area manager and area supervisor are all whole-evening
  // duties now: one slot per week (not per shift instance), capped at a
  // duty-specific number of people, a pick covering both shift instances
  // at once.
  if (duty === 'bartender' || duty === 'area_manager' || duty === 'area_supervisor') {
    for (const week of weeks) {
      const shifts = shiftsByWeek.get(week) ?? {}
      const dateLabel = shortDateFormatter.format(shiftDateOfWeek(week))
      const canRevert = week > currentWeek
      const weekBarManagerId = shiftManagerByWeek.get(week)
      const barManagerName = (weekBarManagerId && employeeNames.get(weekBarManagerId)) || '— טרם שובץ —'
      const openingActive = shifts.opening && shifts.opening.status !== 'cancelled'
      const closingActive = shifts.closing && shifts.closing.status !== 'cancelled'

      // Bartender hours follow the shift's own real start/end times
      // (spanning the whole evening, unless only one side is actually
      // relevant -- see below); area manager/supervisor use the same
      // fixed display-only window as Shifts.tsx.
      const fullEveningHoursLabel =
        duty === 'bartender'
          ? shifts.opening && shifts.closing
            ? `${formatTime(shifts.opening.start_time)}–${formatTime(shifts.closing.end_time)}`
            : shifts.opening
              ? `${formatTime(shifts.opening.start_time)}–${formatTime(shifts.opening.end_time)}`
              : shifts.closing
                ? `${formatTime(shifts.closing.start_time)}–${formatTime(shifts.closing.end_time)}`
                : ''
          : AREA_SUPERVISOR_HOURS

      if (!openingActive && !closingActive && (shifts.opening || shifts.closing)) {
        slots.push({
          key: week,
          dateLabel,
          typeLabel: shiftAssignmentRoleLabels[duty],
          hoursLabel: fullEveningHoursLabel,
          barManagerName,
          peerNames: [],
          status: 'cancelled',
        })
        continue
      }

      const openingAssignments = (assignmentsByShift.get(shifts.opening?.id ?? '') ?? []).filter(
        (a) => a.assignment_role === duty,
      )
      const closingAssignments = (assignmentsByShift.get(shifts.closing?.id ?? '') ?? []).filter(
        (a) => a.assignment_role === duty,
      )
      const allAssignments = [...openingAssignments, ...closingAssignments]
      // required_staff_count is now one evening-wide number (ShiftForm
      // keeps both shift rows in sync); area_manager/area_supervisor caps
      // aren't backed by a column, same as Shifts.tsx.
      const max =
        duty === 'bartender'
          ? (shifts.opening?.required_staff_count ?? shifts.closing?.required_staff_count ?? 3)
          : duty === 'area_manager'
            ? 2
            : 1
      const mine = allAssignments.filter((a) => a.employee_id === myEmployeeId)
      // Per-side room, not a combined row count -- a bar manager can split
      // a bartender's pairing in Shifts.tsx, leaving one side at capacity
      // while the other still has a free slot (a plain sum here would
      // double-count every fully-paired person against a single-instance
      // max and show "full" too early).
      const openingHasRoom = !!openingActive && openingAssignments.length < max
      const closingHasRoom = !!closingActive && closingAssignments.length < max
      const isFull = !openingHasRoom && !closingHasRoom
      const partialLabel =
        mine.length === 1 ? (mine[0].shift_id === shifts.opening?.id ? 'פתיחה בלבד' : 'סגירה בלבד') : undefined
      // When only one side is actually relevant -- the viewer's own
      // partial assignment, or only one side still has room to join --
      // the title shows that side's own type (in orange) + real hours
      // instead of the full-evening span, which would otherwise read as
      // if the whole evening were in play.
      const relevantSide: 'opening' | 'closing' | null =
        mine.length === 1
          ? mine[0].shift_id === shifts.opening?.id
            ? 'opening'
            : 'closing'
          : mine.length === 0 && !isFull && (!openingHasRoom || !closingHasRoom)
            ? openingHasRoom
              ? 'opening'
              : 'closing'
            : null
      const sideTypeLabel =
        duty === 'bartender' && relevantSide === 'opening'
          ? 'משמרת פתיחה'
          : duty === 'bartender' && relevantSide === 'closing'
            ? 'משמרת סגירה'
            : undefined
      const hoursLabel =
        duty === 'bartender' && relevantSide === 'opening' && shifts.opening
          ? `${formatTime(shifts.opening.start_time)}–${formatTime(shifts.opening.end_time)}`
          : duty === 'bartender' && relevantSide === 'closing' && shifts.closing
            ? `${formatTime(shifts.closing.start_time)}–${formatTime(shifts.closing.end_time)}`
            : fullEveningHoursLabel
      // Which side(s) each peer actually holds -- "(פתיחה)"/"(סגירה)" for a
      // split person, "(שלמה)" for someone paired to the full evening.
      const peerSides = new Map<string, Set<'opening' | 'closing'>>()
      for (const [side, list] of [
        ['opening', openingAssignments],
        ['closing', closingAssignments],
      ] as const) {
        for (const a of list) {
          if (a.employee_id === myEmployeeId) continue
          if (!peerSides.has(a.employee_id)) peerSides.set(a.employee_id, new Set())
          peerSides.get(a.employee_id)!.add(side)
        }
      }
      const peerNames = [...peerSides.entries()]
        .map(([empId, sides]) => {
          const name = employeeNames.get(empId)
          if (!name) return null
          const sideLabel = sides.size === 2 ? 'שלמה' : sides.has('opening') ? 'פתיחה' : 'סגירה'
          return `${name} (${sideLabel})`
        })
        .filter((n): n is string => !!n)

      slots.push({
        key: week,
        dateLabel,
        typeLabel: shiftAssignmentRoleLabels[duty],
        hoursLabel,
        barManagerName,
        peerNames,
        status: mine.length > 0 ? 'mine' : isFull ? 'full' : 'open',
        partialLabel,
        sideTypeLabel,
        namesTitle:
          mine.length > 0
            ? canRevert
              ? 'לחיצה נוספת תבטל את השיבוץ'
              : 'משמרת השבוע הנוכחי — לא ניתן לבטל'
            : undefined,
        revertible: mine.length > 0 && canRevert,
        onClick:
          mine.length > 0
            ? canRevert
              ? async () => {
                  const ok = await confirmAssign({
                    title: 'איזה באסה! לא מסתדר?',
                    action: 'remove',
                    dateLabel,
                    typeLabel: sideTypeLabel ?? 'משמרת שלמה',
                    hoursLabel,
                    positionLabel: shiftAssignmentRoleLabels[duty],
                  })
                  if (!ok) return
                  handleRemove(mine.map((a) => a.id))
                }
              : () =>
                  showInfo({
                    title: 'איזה באסה! לא מסתדר?',
                    body: 'לא ניתן לבטל משמרת בסמיכות למועד המשמרת. אנא צור/י קשר עם מנהל הבר של המשמרת.',
                  })
            : !isFull
              ? async () => {
                  const ok = await confirmAssign({
                    title: 'איזה כיף!',
                    action: 'assign',
                    dateLabel,
                    typeLabel: sideTypeLabel ?? 'משמרת שלמה',
                    hoursLabel,
                    positionLabel: shiftAssignmentRoleLabels[duty],
                  })
                  if (!ok) return
                  handleAssignDuty(shifts, duty)
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
          typeLabel: shiftAssignmentRoleLabels.bar_manager,
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
        typeLabel: shiftAssignmentRoleLabels.bar_manager,
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
                const ok = await confirmAssign({
                    title: 'איזה כיף!',
                    action: 'assign',
                  dateLabel,
                  typeLabel: 'משמרת שלמה',
                  hoursLabel,
                  positionLabel: 'מנהל/ת בר',
                })
                if (!ok) return
                handleAssignBarManager(week)
              }
            : undefined,
      })
    }
  }

  return (
    <WizardShell>
      <ConfirmAssignDialog state={dialogState} onApprove={handleApprove} onDecline={handleDecline} />
      <InfoDialog state={infoState} onClose={handleClose} />
      <WizardHeader back={{ label: 'חזרה', onClick: () => setStep('pick') }} />

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <div className="text-center">
          <h1 className="text-[17px] font-bold">{duty ? LIST_LABELS[duty] : ''}</h1>
          <p className="mt-1 text-sm" style={{ color: C.textMuted }}>
            לאיזה משמרת תרצה/י להשתבץ?
          </p>
        </div>

        {!loadedShifts && (
          <p className="text-center text-sm" style={{ color: C.textMuted }}>
            טוען...
          </p>
        )}

        {loadedShifts && slots.length === 0 && (
          <p className="text-center text-sm" style={{ color: C.textMuted }}>
            אין כרגע משמרות פתוחות.
          </p>
        )}

        {loadedShifts && slots.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {slots.map((slot) => (
              <SlotCard key={slot.key} slot={slot} duty={duty!} />
            ))}
          </div>
        )}

        {error && (
          <p className="text-center text-sm" style={{ color: C.error }}>
            {error}
          </p>
        )}

        {assignedCount > 0 && (
          <p className="text-center text-sm font-semibold" style={{ color: C.success }}>
            שובצת ל־{assignedCount} משמרות עד כה.
          </p>
        )}

        {loadedShifts && hasMoreWeeks && (
          <button
            type="button"
            onClick={() =>
              setVisibleWeekCount((c) => c + (duty === 'area_supervisor' || duty === 'bar_manager' ? 6 : 3))
            }
            className="h-9 self-center rounded-full border px-4 text-sm font-bold"
            style={{ background: C.card, borderColor: C.border, color: C.primary }}
          >
            עוד משמרות
          </button>
        )}

        <button
          type="button"
          onClick={finish}
          disabled={finishing}
          className="h-12 rounded-2xl text-[15px] font-bold text-white disabled:opacity-50"
          style={{ background: C.success }}
        >
          סיימנו!
        </button>
      </div>
    </WizardShell>
  )
}
