import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, type LucideIcon } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { ROLES_MANAGING_SHIFTS } from '@/lib/roleLabels'
import { activeWeekStart, addDays, toDateStr, shiftDateOfWeek } from '@/lib/weeklyChecklist'
import { C } from '@/lib/designTokens'
import { DUTY_ICON, DUTY_ICON_BG } from '@/lib/dutyIcons'
import { mergeDutyPeople, useShiftWeeksData, type Duty, type WeekShifts } from '@/pages/Shifts'
import { WeekSection, useEmployeePhones } from '@/pages/ShiftsPreview'
import type { ShiftAssignment } from '@/lib/types'

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

// Fetches ~10 weeks ahead up front so "עוד משמרות" just reveals more of
// what's already loaded, no extra round trip.
const WEEKS_AHEAD = 11

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

// Whether an evening still has room for the picked duty, mirroring the
// capacity rules the /shifts cards (and the self-assign RLS) apply:
// bartender up to required_staff_count on either half, area manager up to
// 2, area supervisor and bar manager one each. An evening the viewer
// already holds that duty on also counts, so it doesn't vanish from the
// list the moment they sign up and fill the last spot.
function eveningMatchesDuty(
  duty: Duty,
  week: string,
  shifts: WeekShifts,
  assignmentsByShift: Map<string, ShiftAssignment[]>,
  teamByWeek: Map<string, string>,
  myEmployeeId: string,
) {
  const openForSignup = (s: WeekShifts['opening']) => !!s && s.status === 'published'
  const opening = openForSignup(shifts.opening) ? shifts.opening : undefined
  const closing = openForSignup(shifts.closing) ? shifts.closing : undefined
  if (!opening && !closing) return false

  if (duty === 'bar_manager') {
    const barManagerId = teamByWeek.get(week)
    return !barManagerId || barManagerId === myEmployeeId
  }

  const rows = (shift: WeekShifts['opening']) =>
    (assignmentsByShift.get(shift?.id ?? '') ?? []).filter((a) => a.assignment_role === duty)
  const openingRows = rows(shifts.opening)
  const closingRows = rows(shifts.closing)
  if ([...openingRows, ...closingRows].some((a) => a.employee_id === myEmployeeId)) return true

  if (duty === 'bartender') {
    // Same fallback as the /shifts bartender card.
    const max = opening?.required_staff_count ?? closing?.required_staff_count ?? 3
    return (!!opening && openingRows.length < max) || (!!closing && closingRows.length < max)
  }
  const max = duty === 'area_manager' ? 2 : 1
  return mergeDutyPeople(openingRows, closingRows).length < max
}

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

  const [step, setStep] = useState<Step>('pick')
  const [duty, setDuty] = useState<Duty | null>(null)
  const [canSuperviseArea, setCanSuperviseArea] = useState(false)
  const [loadedEligibility, setLoadedEligibility] = useState(false)
  const [visibleWeekCount, setVisibleWeekCount] = useState(3)
  const [finishing, setFinishing] = useState(false)

  const isAdmin = effectiveRole === 'administrator'
  const canManage = ROLES_MANAGING_SHIFTS.includes(effectiveRole)
  // Bar manager duty is offered only to the roles that can actually hold
  // it (shift_manager/administrator) -- unlike the other three duties,
  // every real account qualifies for those regardless of role.
  const barManagerEligible = effectiveRole === 'shift_manager' || isAdmin

  // Loaded up front (while the viewer is still on the pick step) through
  // the same loader as /shifts, so step 2 renders the exact same cards.
  const weeks = Array.from({ length: WEEKS_AHEAD }, (_, i) => toDateStr(addDays(activeWeekStart(), 7 * i)))
  const {
    shiftsByWeek,
    assignmentsByShift,
    teamByWeek,
    shiftManagers,
    dutyEligible,
    areaSupervisorEligible,
    supervisesAreaIds,
    employeeNames,
    shiftCounts,
    loaded: loadedShifts,
    reload,
  } = useShiftWeeksData({ weeks, canManage, callEnsureUpcoming: false })
  const employeePhones = useEmployeePhones()

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

  function pickDuty(role: Duty) {
    setDuty(role)
    setStep('shifts')
    setVisibleWeekCount(3)
    reload()
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

  if (step === 'pick' || !duty) {
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
        </div>
      </WizardShell>
    )
  }

  // Only evenings whose date hasn't passed -- tonight still counts. Goes by
  // the shifts' real start time, since the week alone (activeWeekStart
  // only rolls over on Friday) still includes earlier days of this week.
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const matchingWeeks = [...shiftsByWeek.keys()].sort().filter((week) => {
    const shifts = shiftsByWeek.get(week) ?? {}
    const eveningStart = shifts.opening?.start_time ?? shifts.closing?.start_time
    if ((eveningStart ? new Date(eveningStart) : shiftDateOfWeek(week)) < startOfToday) return false
    return eveningMatchesDuty(duty, week, shifts, assignmentsByShift, teamByWeek, myEmployeeId)
  })
  const visibleWeeks = matchingWeeks.slice(0, visibleWeekCount)
  const hasMoreWeeks = matchingWeeks.length > visibleWeekCount

  return (
    <WizardShell>
      <WizardHeader back={{ label: 'חזרה', onClick: () => setStep('pick') }} />

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <div className="text-center">
          <h1 className="text-[17px] font-bold">{LIST_LABELS[duty]}</h1>
          <p className="mt-1 text-sm" style={{ color: C.textMuted }}>
            לאיזה משמרת תרצה/י להשתבץ?
          </p>
        </div>

        {!loadedShifts && (
          <p className="text-center text-sm" style={{ color: C.textMuted }}>
            טוען...
          </p>
        )}

        {loadedShifts && matchingWeeks.length === 0 && (
          <p className="text-center text-sm" style={{ color: C.textMuted }}>
            אין כרגע משמרות פתוחות.
          </p>
        )}

        {loadedShifts &&
          visibleWeeks.map((week) => (
            <WeekSection
              key={week}
              week={week}
              shifts={shiftsByWeek.get(week) ?? {}}
              assignmentsByShift={assignmentsByShift}
              teamByWeek={teamByWeek}
              shiftManagers={shiftManagers}
              dutyEligible={dutyEligible}
              areaSupervisorEligible={areaSupervisorEligible}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              employeePhones={employeePhones}
              myEmployeeId={myEmployeeId}
              compact={false}
              canManage={canManage}
              supervisesArea={supervisesAreaIds.has(myEmployeeId)}
              isAdmin={isAdmin}
              onSaved={reload}
            />
          ))}

        {loadedShifts && hasMoreWeeks && (
          <button
            type="button"
            onClick={() => setVisibleWeekCount((c) => c + 3)}
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
