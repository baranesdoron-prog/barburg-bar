import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Calendar,
  Clock,
  Martini,
  Beer,
  ShieldCheck,
  Users,
  Phone,
  LayoutDashboard,
  CalendarClock,
  FileText,
  User,
  Sparkles,
  ChevronLeft,
  type LucideIcon,
} from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { ROLES_MANAGING_SHIFTS } from '@/lib/roleLabels'
import { effectiveStatusLabels } from '@/lib/shiftLabels'
import {
  sundaysInYear,
  EARLIEST_WEEK_START,
  YEAR_OPTIONS,
  toDateStr,
  shiftDateOfWeek,
  weekLabelFormatter,
} from '@/lib/weeklyChecklist'
import { formatTime, cn } from '@/lib/utils'
import {
  useShiftWeeksData,
  mergeDutyPeople,
  type Duty,
  weekNeedsClosing,
  ARCHIVE_CUTOFF,
  FETCH_FROM,
  AREA_SUPERVISOR_HOURS,
  type WeekShifts,
  type ShiftCountInfo,
  type DutyPerson,
} from '@/pages/Shifts'
import type { ShiftAssignment, EffectiveShiftStatus } from '@/lib/types'

const currentYear = new Date().getFullYear()

// Design tokens from the approved mockup -- kept local to this one page on
// purpose (see shiftsPreviewAccess.ts); nothing here touches the real
// Shifts page or any shared Tailwind config.
const C = {
  primary: '#174D3B',
  primaryHover: '#23664F',
  primaryLight: '#E8F3EC',
  accent: '#E9A23B',
  accentLight: '#FFF3DF',
  appBg: '#FAF8F5',
  card: '#FFFFFF',
  subtleBg: '#F3F5F1',
  text: '#202A26',
  textSecondary: '#647067',
  textMuted: '#737D76',
  border: '#E5E8E2',
  success: '#16835D',
  successBg: '#E6F6ED',
  warning: '#B76A00',
  warningBg: '#FFF2DB',
  error: '#C83F3F',
  errorBg: '#FDECEC',
  info: '#2563EB',
  infoBg: '#EAF2FF',
}

interface SimplePerson {
  id: string
  name: string
}

interface DutySummary {
  key: string
  label: string
  icon: LucideIcon
  iconBg: string
  hoursLabel: string
  people: SimplePerson[]
  isGap: boolean
  // Only set for bartender duty -- the one duty that supports splitting a
  // whole-evening pairing in the real app (never area manager). When set,
  // DutyCard renders each person's own row (with a פיצול button once
  // paired, or a split opening/closing mini-card while partial) instead of
  // a plain name list.
  splitAware?: {
    people: DutyPerson[]
    names: Record<string, string>
    openingLabel: string
    closingLabel: string
  }
}

// Unlike the real /shifts page, this preview shows the senior ⭐ marker
// without the "(shift count)" number next to it -- just the name, plus a
// star for whoever's already senior in that duty.
function nameWithStar(name: string, shiftCounts: Record<string, ShiftCountInfo>, employeeId: string, duty: Duty) {
  const senior = shiftCounts[employeeId]?.[duty]?.senior
  return senior ? `${name} ⭐` : name
}

function hasSenior(people: { employee_id: string }[], shiftCounts: Record<string, ShiftCountInfo>, duty: Duty) {
  return people.some((p) => shiftCounts[p.employee_id]?.[duty]?.senior)
}

function statusTone(status: EffectiveShiftStatus): { bg: string; fg: string } {
  if (status === 'cancelled') return { bg: C.errorBg, fg: C.error }
  if (status === 'waiting_for_closure' || status === 'reopened') return { bg: C.warningBg, fg: C.warning }
  if (status === 'active') return { bg: C.infoBg, fg: C.info }
  if (status === 'completed' || status === 'draft') return { bg: C.subtleBg, fg: C.textMuted }
  return { bg: C.successBg, fg: C.success } // published
}

// One bartender's row inside a split-aware duty card -- mirrors the real
// /shifts manager view: fully paired gets a name + פיצול button, a partial
// person gets a small two-line "which side, and the other side's still
// open" card instead of just a bare name.
function PhoneLine({ phone, compact }: { phone: string | undefined; compact: boolean }) {
  if (!phone) return null
  return (
    <div className="flex items-center gap-1" style={{ color: C.textSecondary }}>
      <Phone className="size-3.5 shrink-0" />
      <span className={compact ? 'text-xs' : 'text-sm'} dir="ltr">
        {phone}
      </span>
    </div>
  )
}

function BartenderPersonRow({
  person,
  name,
  phone,
  openingLabel,
  closingLabel,
  compact,
  onPreviewAction,
}: {
  person: DutyPerson
  name: string
  phone: string | undefined
  openingLabel: string
  closingLabel: string
  compact: boolean
  onPreviewAction: () => void
}) {
  const isFull = !!person.openingAssignmentId && !!person.closingAssignmentId

  if (isFull) {
    return (
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('truncate font-medium', compact ? 'text-sm' : 'text-base')} style={{ color: C.text }}>
            {name}
          </p>
          <PhoneLine phone={phone} compact={compact} />
        </div>
        {/* Same filled style as the "add another" button below -- this is
            also just an action on an existing allocation, not a primary CTA. */}
        <button
          type="button"
          onClick={onPreviewAction}
          className={cn('w-fit shrink-0 rounded-xl px-3 font-semibold', compact ? 'h-8 text-xs' : 'h-9 text-sm')}
          style={{ background: C.subtleBg, color: C.textMuted }}
        >
          פיצול
        </button>
      </div>
    )
  }

  const onOpening = !!person.openingAssignmentId
  return (
    <div
      className="flex flex-col gap-1.5 rounded-xl border border-dashed px-2.5 py-2"
      style={{ borderColor: C.border }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={cn('truncate font-medium', compact ? 'text-sm' : 'text-base')} style={{ color: C.text }}>
            {name}
          </span>
          <PhoneLine phone={phone} compact={compact} />
        </div>
        <span className="shrink-0 text-xs font-semibold" style={{ color: C.textMuted }}>
          {onOpening ? openingLabel : closingLabel}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs" style={{ color: C.textMuted }}>
          פנוי ל{onOpening ? closingLabel : openingLabel}
        </span>
        <button
          type="button"
          onClick={onPreviewAction}
          className="h-6 shrink-0 rounded-lg px-2.5 text-[11px] font-semibold"
          style={{ background: C.primaryLight, color: C.primary }}
        >
          שבץ אותי
        </button>
      </div>
    </div>
  )
}

function DutyCard({
  duty,
  status,
  compact,
  employeePhones,
  onPreviewAction,
}: {
  duty: DutySummary
  status: EffectiveShiftStatus
  compact: boolean
  employeePhones: Record<string, string>
  onPreviewAction: () => void
}) {
  const tone = duty.isGap ? { bg: C.warningBg, fg: C.warning } : statusTone(status)
  const Icon = duty.icon
  const occupied = duty.people.length > 0
  const iconSize = compact ? 'size-11' : 'size-14'

  return (
    <div
      className="relative rounded-2xl border"
      style={{
        background: C.card,
        borderColor: C.border,
        paddingTop: compact ? 12 : 16,
        paddingBottom: compact ? 10 : 14,
        // Explicit physical sides via inline style, not Tailwind's pr-*/pl-*
        // utilities -- those (and left-*/right-*) resolve as RTL-logical
        // in this setup, which silently swaps sides under dir="rtl".
        paddingRight: compact ? 10 : 14,
        paddingLeft: compact ? 20 : 24,
      }}
    >
      {/* Status badge sits just inside the card, below its top border (not
          straddling the line itself -- only the icon does that). */}
      <span
        className="absolute rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{ background: tone.bg, color: tone.fg, top: 10, left: 12 }}
      >
        {duty.isGap ? 'חסר שיבוץ' : effectiveStatusLabels[status]}
      </span>

      {/* Duty icon straddles the top-right edge, same idea. */}
      <div
        className={cn('absolute flex items-center justify-center rounded-full ring-4', iconSize)}
        style={{ background: duty.iconBg, ['--tw-ring-color' as string]: C.subtleBg, top: -16, right: 12 }}
      >
        <Icon className={cn('text-white', compact ? 'size-5' : 'size-6')} />
      </div>

      <div className={cn('flex flex-col gap-2 pr-1', compact ? 'pt-9' : 'pt-10')}>
        <div>
          <p className={cn('font-semibold', compact ? 'text-base' : 'text-lg')} style={{ color: C.text }}>
            {duty.label}
          </p>
          <div className="mt-0.5 flex items-center gap-1" style={{ color: C.textSecondary }}>
            <Clock className="size-4 shrink-0" />
            <span className={compact ? 'text-xs' : 'text-sm'}>{duty.hoursLabel}</span>
          </div>
        </div>

        {/* Each assigned person on their own line, same as the real /shifts
            page -- not merged into a list -- so split/unify can target one
            specific row, not a whole duty at once. Bartender rows also get
            the real page's own split/partial behaviour (see splitAware). */}
        <div className="flex flex-col gap-2">
          {occupied ? (
            duty.splitAware ? (
              duty.splitAware.people.map((person) => (
                <BartenderPersonRow
                  key={person.employee_id}
                  person={person}
                  name={duty.splitAware!.names[person.employee_id] ?? '—'}
                  phone={employeePhones[person.employee_id]}
                  openingLabel={duty.splitAware!.openingLabel}
                  closingLabel={duty.splitAware!.closingLabel}
                  compact={compact}
                  onPreviewAction={onPreviewAction}
                />
              ))
            ) : (
              duty.people.map((person) => (
                <div key={person.id}>
                  <p className={cn('truncate font-medium', compact ? 'text-sm' : 'text-base')} style={{ color: C.text }}>
                    {person.name}
                  </p>
                  <PhoneLine phone={employeePhones[person.id]} compact={compact} />
                </div>
              ))
            )
          ) : (
            <p className={cn(compact ? 'text-sm' : 'text-base')} style={{ color: C.textMuted }}>
              עדיין לא שובץ
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onPreviewAction}
          className={cn(
            'w-fit rounded-xl px-3 font-semibold',
            compact ? 'h-8 text-xs' : 'h-9 text-sm',
            occupied ? '' : 'text-white',
          )}
          style={occupied ? { background: C.subtleBg, color: C.textMuted } : { background: C.primary }}
        >
          {occupied ? 'הוספת שיבוץ נוסף' : 'שבץ אותי'}
        </button>
      </div>
    </div>
  )
}

function WeekSection({
  week,
  shifts,
  assignmentsByShift,
  teamByWeek,
  employeeNames,
  shiftCounts,
  employeePhones,
  compact,
  canManage,
  isAdmin,
  onPreviewAction,
}: {
  week: string
  shifts: WeekShifts
  assignmentsByShift: Map<string, ShiftAssignment[]>
  teamByWeek: Map<string, string>
  employeeNames: Record<string, string>
  shiftCounts: Record<string, ShiftCountInfo>
  employeePhones: Record<string, string>
  compact: boolean
  canManage: boolean
  isAdmin: boolean
  onPreviewAction: () => void
}) {
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const activeOpening = shifts.opening && shifts.opening.status !== 'cancelled' ? shifts.opening : undefined
  const activeClosing = shifts.closing && shifts.closing.status !== 'cancelled' ? shifts.closing : undefined
  const weekFullyCancelled = !activeOpening && !activeClosing && !!(shifts.opening || shifts.closing)

  const openingAll = shifts.opening ? (assignmentsByShift.get(shifts.opening.id) ?? []) : []
  const closingAll = shifts.closing ? (assignmentsByShift.get(shifts.closing.id) ?? []) : []
  const byRole = (role: string) => ({
    opening: openingAll.filter((a) => a.assignment_role === role),
    closing: closingAll.filter((a) => a.assignment_role === role),
  })
  const bartenders = byRole('bartender')
  const areaManagers = byRole('area_manager')
  const areaSupervisors = byRole('area_supervisor')

  const bartenderMax = activeOpening?.required_staff_count ?? activeClosing?.required_staff_count ?? 3
  const eveningHours =
    activeOpening && activeClosing
      ? `${formatTime(activeOpening.start_time)}–${formatTime(activeClosing.end_time)}`
      : activeOpening
        ? `${formatTime(activeOpening.start_time)}–${formatTime(activeOpening.end_time)}`
        : activeClosing
          ? `${formatTime(activeClosing.start_time)}–${formatTime(activeClosing.end_time)}`
          : ''

  const barManagerId = teamByWeek.get(week) ?? null
  const bartenderPeople = mergeDutyPeople(bartenders.opening, bartenders.closing)
  const areaManagerPeople = mergeDutyPeople(areaManagers.opening, areaManagers.closing)
  const areaSupervisorId = areaSupervisors.opening[0]?.employee_id ?? areaSupervisors.closing[0]?.employee_id ?? null

  // Same evening-wide gap checks as the real page's CombinedStatus -- a
  // manager-only informational summary line, not shown to anyone else.
  const primaryShift = shifts.closing ?? shifts.opening
  const openForStaffing =
    !!primaryShift &&
    primaryShift.status !== 'cancelled' &&
    (primaryShift.effective_status === 'published' || primaryShift.effective_status === 'active')
  const gaps: string[] = []
  if (primaryShift && openForStaffing) {
    if (primaryShift.required_staff_count !== null && bartenderPeople.length < primaryShift.required_staff_count) {
      gaps.push('תת-איוש ברמנים/יות')
    }
    if (areaManagerPeople.length === 0) {
      gaps.push('אין אחראי/ת מתחם')
    }
    if (bartenderPeople.length > 0 && !hasSenior(bartenderPeople, shiftCounts, 'bartender')) {
      gaps.push('אין ברמן/ית בכיר/ה')
    }
    if (areaManagerPeople.length > 0 && !hasSenior(areaManagerPeople, shiftCounts, 'area_manager')) {
      gaps.push('אין אחראי/ת מתחם בכיר/ה')
    }
  }

  const cancellableShiftIds = [
    shifts.opening && shifts.opening.status !== 'cancelled' ? shifts.opening.id : null,
    shifts.closing && shifts.closing.status !== 'cancelled' ? shifts.closing.id : null,
  ].filter((v): v is string => !!v)
  const cancelledShiftIds = [
    shifts.opening?.status === 'cancelled' ? shifts.opening.id : null,
    shifts.closing?.status === 'cancelled' ? shifts.closing.id : null,
  ].filter((v): v is string => !!v)

  const duties: DutySummary[] = [
    {
      key: 'bar_manager',
      label: 'מנהל/ת בר',
      icon: Martini,
      iconBg: C.primary,
      hoursLabel: eveningHours,
      people: barManagerId
        ? [{ id: barManagerId, name: nameWithStar(employeeNames[barManagerId] ?? '—', shiftCounts, barManagerId, 'bar_manager') }]
        : [],
      isGap: !barManagerId,
    },
    {
      key: 'bartender',
      label: `ברמנים/יות (עד ${bartenderMax})`,
      icon: Beer,
      iconBg: C.accent,
      hoursLabel: eveningHours,
      people: bartenderPeople.map((p) => ({
        id: p.employee_id,
        name: nameWithStar(employeeNames[p.employee_id] ?? '—', shiftCounts, p.employee_id, 'bartender'),
      })),
      isGap: bartenderPeople.length === 0,
      // Bartender is the only duty that can be split in the real app --
      // never area manager.
      splitAware:
        bartenderPeople.length > 0
          ? {
              people: bartenderPeople,
              names: Object.fromEntries(
                bartenderPeople.map((p) => [
                  p.employee_id,
                  nameWithStar(employeeNames[p.employee_id] ?? '—', shiftCounts, p.employee_id, 'bartender'),
                ]),
              ),
              openingLabel: activeOpening
                ? `פתיחה ${formatTime(activeOpening.start_time)}–${formatTime(activeOpening.end_time)}`
                : 'פתיחה',
              closingLabel: activeClosing
                ? `סגירה ${formatTime(activeClosing.start_time)}–${formatTime(activeClosing.end_time)}`
                : 'סגירה',
            }
          : undefined,
    },
    {
      key: 'area_supervisor',
      label: 'אחראי/ת מתחם בכיר/ה',
      icon: ShieldCheck,
      iconBg: C.info,
      hoursLabel: AREA_SUPERVISOR_HOURS,
      people: areaSupervisorId
        ? [
            {
              id: areaSupervisorId,
              name: nameWithStar(employeeNames[areaSupervisorId] ?? '—', shiftCounts, areaSupervisorId, 'area_supervisor'),
            },
          ]
        : [],
      isGap: !areaSupervisorId,
    },
    {
      key: 'area_manager',
      label: 'אחראי/ת מתחם (עד 2)',
      icon: Users,
      iconBg: '#3F8F6B',
      hoursLabel: AREA_SUPERVISOR_HOURS,
      people: areaManagerPeople.map((p) => ({
        id: p.employee_id,
        name: nameWithStar(employeeNames[p.employee_id] ?? '—', shiftCounts, p.employee_id, 'area_manager'),
      })),
      isGap: areaManagerPeople.length === 0,
    },
  ]

  const dateLabel = shifts.opening?.start_time
    ? weekLabelFormatter.format(new Date(shifts.opening.start_time))
    : shifts.closing?.start_time
      ? weekLabelFormatter.format(new Date(shifts.closing.start_time))
      : weekLabelFormatter.format(shiftDateOfWeek(week))
  const weekdayLabel = new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(shiftDateOfWeek(week))

  return (
    <div
      className={cn('flex flex-col rounded-3xl border', compact ? 'gap-5 p-3 pt-4' : 'gap-6 p-4 pt-5')}
      style={{ background: C.subtleBg, borderColor: C.border }}
    >
      <div className="px-1">
        <h2 className={cn('font-bold', compact ? 'text-lg' : 'text-xl')} style={{ color: C.text }}>
          {dateLabel}
        </h2>
        <p className="text-sm" style={{ color: C.textMuted }}>
          {weekdayLabel}
        </p>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs">
          <span style={{ color: C.textMuted }}>סטטוס</span>
          {primaryShift ? (
            <Link
              to={`/shifts/${primaryShift.id}`}
              className="rounded-full px-2 py-0.5 font-semibold hover:underline"
              style={{
                background: statusTone(primaryShift.effective_status).bg,
                color: statusTone(primaryShift.effective_status).fg,
              }}
            >
              {effectiveStatusLabels[primaryShift.effective_status]}
            </Link>
          ) : (
            <span style={{ color: C.textMuted }}>—</span>
          )}
          {gaps.map((g) => (
            <span key={g} className="font-medium" style={{ color: C.warning }}>
              {g}
            </span>
          ))}
        </div>
      )}

      {weekFullyCancelled ? (
        <div className="rounded-2xl border p-3.5 text-center font-medium" style={{ background: C.errorBg, borderColor: C.border, color: C.error }}>
          השבוע הזה בוטל
        </div>
      ) : (
        <div className={cn('flex flex-col', compact ? 'gap-5' : 'gap-6')}>
          {duties.map((duty) => (
            <DutyCard
              key={duty.key}
              duty={duty}
              status={activeOpening?.effective_status ?? activeClosing?.effective_status ?? 'published'}
              compact={compact}
              employeePhones={employeePhones}
              onPreviewAction={onPreviewAction}
            />
          ))}
        </div>
      )}

      {canManage &&
        shifts.closing &&
        (shifts.closing.effective_status === 'active' ||
          shifts.closing.effective_status === 'waiting_for_closure' ||
          shifts.closing.effective_status === 'reopened') && (
          <Link
            to={`/shifts/${shifts.closing.id}/close`}
            className="flex items-center justify-center rounded-xl py-2.5 text-sm font-semibold text-white"
            style={{ background: C.primary }}
          >
            סגירת משמרת
          </Link>
        )}

      {canManage && cancellableShiftIds.length > 0 && cancelledShiftIds.length === 0 && !showCancelForm && (
        <button
          type="button"
          onClick={() => setShowCancelForm(true)}
          className="rounded-xl py-2.5 text-sm font-semibold"
          style={{ background: C.errorBg, color: C.error }}
        >
          ביטול משמרת
        </button>
      )}

      {canManage && cancellableShiftIds.length > 0 && cancelledShiftIds.length === 0 && showCancelForm && (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-16 rounded-xl border p-2 text-xs"
            style={{ borderColor: C.border, background: C.card }}
            placeholder="סיבת הביטול (חובה)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowCancelForm(false)
                setCancelReason('')
              }}
              className="flex-1 rounded-xl py-2 text-sm font-semibold"
              style={{ background: C.subtleBg, color: C.textMuted }}
            >
              חזרה
            </button>
            <button
              type="button"
              disabled={!cancelReason.trim()}
              onClick={() => {
                onPreviewAction()
                setShowCancelForm(false)
                setCancelReason('')
              }}
              className="flex-1 rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: C.error }}
            >
              אישור ביטול
            </button>
          </div>
        </div>
      )}

      {canManage && cancelledShiftIds.length > 0 && (
        <button
          type="button"
          disabled={!isAdmin}
          title={isAdmin ? undefined : 'רק מנהל/ת מערכת יכול/ה לשחזר משמרת מבוטלת'}
          onClick={onPreviewAction}
          className="rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: C.success }}
        >
          שחזור משמרת
        </button>
      )}
    </div>
  )
}

const BOTTOM_NAV: { label: string; icon: LucideIcon; to: string }[] = [
  { label: 'דשבורד', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'משמרות', icon: CalendarClock, to: '/shifts-preview' },
  { label: 'דוחות', icon: FileText, to: '/reports' },
  { label: 'הפרופיל שלי', icon: User, to: '/profile' },
]

export function ShiftsPreview() {
  const { effectiveRole } = useAppUserContext()
  const [year, setYear] = useState(currentYear)
  const [compact, setCompact] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [employeePhones, setEmployeePhones] = useState<Record<string, string>>({})

  const canManage = ROLES_MANAGING_SHIFTS.includes(effectiveRole)
  const isAdmin = effectiveRole === 'administrator'
  const weeks = sundaysInYear(year)
    .map(toDateStr)
    .filter((w) => w >= EARLIEST_WEEK_START && w >= FETCH_FROM)

  // callEnsureUpcoming: false -- this preview never writes to the database,
  // not even the normally-automatic shift-provisioning RPC the real page
  // calls on load.
  const { shiftsByWeek, assignmentsByShift, teamByWeek, employeeNames, shiftCounts } = useShiftWeeksData({
    weeks,
    canManage,
    callEnsureUpcoming: false,
  })

  // Separate, preview-only fetch (not part of the shared hook, which the
  // real page also uses and doesn't need phone numbers for).
  useEffect(() => {
    let isMounted = true
    supabase
      .from('employees')
      .select('id, phone')
      .then(({ data }) => {
        if (!isMounted || !data) return
        setEmployeePhones(
          Object.fromEntries(
            (data as { id: string; phone: string | null }[])
              .filter((e) => !!e.phone)
              .map((e) => [e.id, e.phone as string]),
          ),
        )
      })
    return () => {
      isMounted = false
    }
  }, [])

  const visibleWeeks = weeks.filter((w) => w >= ARCHIVE_CUTOFF || weekNeedsClosing(shiftsByWeek.get(w) ?? {}))

  function previewOnly() {
    setToast('תצוגה מקדימה בלבד — הפעולה לא נשמרת')
    window.setTimeout(() => setToast(null), 2000)
  }

  return (
    <div dir="rtl" className="min-h-svh pb-24" style={{ background: C.appBg, color: C.text }}>
      <header
        className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3"
        style={{ background: C.card, borderColor: C.border }}
      >
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="ברבורג" className="size-9 shrink-0 rounded-full object-cover" />
          <span className="text-lg font-bold">ברבורג</span>
        </div>
        <Link to="/shifts" className="flex items-center gap-1 text-sm font-semibold" style={{ color: C.primary }}>
          <ChevronLeft className="size-4" />
          חזרה לעמוד הרגיל
        </Link>
      </header>

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.primaryLight }}>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ background: C.primary }}>
            <Calendar className="size-6 text-white" />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold" style={{ color: C.primary }}>
              משמרות
            </h1>
            <span
              className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ background: C.accentLight, color: C.warning }}
            >
              <Sparkles className="size-3" />
              תצוגה מקדימה — פעולות לא נשמרות
            </span>
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <Link
              to="/shifts/archive"
              className="flex-1 rounded-xl border py-2 text-center text-sm font-semibold"
              style={{ borderColor: C.border, color: C.textSecondary }}
            >
              ארכיון
            </Link>
            <Link
              to="/shifts/new"
              className="flex-1 rounded-xl py-2 text-center text-sm font-semibold text-white"
              style={{ background: C.primary }}
            >
              משמרת חדשה
            </Link>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <select
            className="h-10 rounded-xl border px-3 text-base font-medium"
            style={{ borderColor: C.border, background: C.card }}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          <div className="flex rounded-full p-1" style={{ background: C.subtleBg }}>
            <button
              type="button"
              onClick={() => setCompact(false)}
              className="rounded-full px-4 py-1.5 text-sm font-semibold transition"
              style={!compact ? { background: C.primary, color: '#fff' } : { color: C.textSecondary }}
            >
              מורחב
            </button>
            <button
              type="button"
              onClick={() => setCompact(true)}
              className="rounded-full px-4 py-1.5 text-sm font-semibold transition"
              style={compact ? { background: C.primary, color: '#fff' } : { color: C.textSecondary }}
            >
              קומפקטי
            </button>
          </div>
        </div>

        {visibleWeeks.length === 0 && (
          <p style={{ color: C.textMuted }}>אין שבועות להצגה בשנה זו.</p>
        )}

        {visibleWeeks.map((week) => (
          <WeekSection
            key={week}
            week={week}
            shifts={shiftsByWeek.get(week) ?? {}}
            assignmentsByShift={assignmentsByShift}
            teamByWeek={teamByWeek}
            employeeNames={employeeNames}
            shiftCounts={shiftCounts}
            employeePhones={employeePhones}
            compact={compact}
            canManage={canManage}
            isAdmin={isAdmin}
            onPreviewAction={previewOnly}
          />
        ))}
      </div>

      {toast && (
        <div
          className="fixed inset-x-0 bottom-20 z-20 mx-auto w-fit rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg"
          style={{ background: C.text }}
        >
          {toast}
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-around border-t py-2"
        style={{ background: C.card, borderColor: C.border, paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}
      >
        {BOTTOM_NAV.map((item) => {
          const active = item.to === '/shifts-preview'
          return (
            <Link
              key={item.label}
              to={item.to}
              className="flex flex-col items-center gap-0.5 px-3 py-1 text-xs font-medium"
              style={{ color: active ? C.primary : C.textMuted }}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
