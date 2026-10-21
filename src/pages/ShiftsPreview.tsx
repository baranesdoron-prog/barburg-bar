import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Calendar,
  Clock,
  Martini,
  Beer,
  ShieldCheck,
  Users,
  UsersRound,
  LayoutDashboard,
  CalendarClock,
  FileText,
  User,
  Sparkles,
  ChevronLeft,
  type LucideIcon,
} from 'lucide-react'

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
  nameWithCount,
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

interface DutySummary {
  key: string
  label: string
  icon: LucideIcon
  iconBg: string
  hoursLabel: string
  names: string[]
  isGap: boolean
}

function statusTone(status: EffectiveShiftStatus): { bg: string; fg: string } {
  if (status === 'cancelled') return { bg: C.errorBg, fg: C.error }
  if (status === 'waiting_for_closure' || status === 'reopened') return { bg: C.warningBg, fg: C.warning }
  if (status === 'active') return { bg: C.infoBg, fg: C.info }
  if (status === 'completed' || status === 'draft') return { bg: C.subtleBg, fg: C.textMuted }
  return { bg: C.successBg, fg: C.success } // published
}

function DutyCard({ duty, status, compact, onPreviewAction }: { duty: DutySummary; status: EffectiveShiftStatus; compact: boolean; onPreviewAction: () => void }) {
  const tone = duty.isGap ? { bg: C.warningBg, fg: C.warning } : statusTone(status)
  const Icon = duty.icon

  return (
    <div
      className={cn('flex items-start gap-3 rounded-2xl border', compact ? 'p-2.5' : 'p-3.5')}
      style={{ background: C.card, borderColor: C.border }}
    >
      <div
        className={cn('flex shrink-0 items-center justify-center rounded-full', compact ? 'size-9' : 'size-12')}
        style={{ background: duty.iconBg }}
      >
        <Icon className={cn('text-white', compact ? 'size-4' : 'size-6')} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={cn('truncate font-semibold', compact ? 'text-base' : 'text-lg')} style={{ color: C.text }}>
              {duty.names.length > 0 ? duty.names[0] : 'עדיין לא שובץ'}
            </p>
            <p className={cn(compact ? 'text-xs' : 'text-sm')} style={{ color: C.textSecondary }}>
              {duty.label}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ background: tone.bg, color: tone.fg }}
          >
            {duty.isGap ? 'חסר שיבוץ' : effectiveStatusLabels[status]}
          </span>
        </div>

        <div className="flex items-center gap-1" style={{ color: C.textSecondary }}>
          <Clock className="size-4 shrink-0" />
          <span className={compact ? 'text-xs' : 'text-sm'}>{duty.hoursLabel}</span>
        </div>

        {duty.names.length > 1 && (
          <div
            className="flex items-center gap-2 rounded-xl px-2.5 py-1.5"
            style={{ background: C.subtleBg }}
          >
            <UsersRound className="size-4 shrink-0" style={{ color: C.textMuted }} />
            <span className={cn('truncate', compact ? 'text-xs' : 'text-sm')} style={{ color: C.text }}>
              {duty.names.slice(1).join(', ')}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={onPreviewAction}
          className={cn(
            'mt-1 w-fit rounded-xl px-3 font-semibold text-white',
            compact ? 'h-8 text-xs' : 'h-9 text-sm',
          )}
          style={{ background: C.primary }}
        >
          שבץ אותי
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
  compact,
  onPreviewAction,
}: {
  week: string
  shifts: WeekShifts
  assignmentsByShift: Map<string, ShiftAssignment[]>
  teamByWeek: Map<string, string>
  employeeNames: Record<string, string>
  shiftCounts: Record<string, ShiftCountInfo>
  compact: boolean
  onPreviewAction: () => void
}) {
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

  function toNames(people: DutyPerson[], role: 'bartender' | 'area_manager' | 'area_supervisor') {
    return people.map((p) => nameWithCount(employeeNames[p.employee_id] ?? '—', shiftCounts, p.employee_id, role))
  }

  const barManagerId = teamByWeek.get(week) ?? null
  const bartenderPeople = mergeDutyPeople(bartenders.opening, bartenders.closing)
  const areaManagerPeople = mergeDutyPeople(areaManagers.opening, areaManagers.closing)
  const areaSupervisorId = areaSupervisors.opening[0]?.employee_id ?? areaSupervisors.closing[0]?.employee_id ?? null

  const duties: DutySummary[] = [
    {
      key: 'bar_manager',
      label: 'מנהל/ת בר',
      icon: Martini,
      iconBg: C.primary,
      hoursLabel: eveningHours,
      names: barManagerId ? [nameWithCount(employeeNames[barManagerId] ?? '—', shiftCounts, barManagerId, 'bar_manager')] : [],
      isGap: !barManagerId,
    },
    {
      key: 'bartender',
      label: `ברמנים/יות (עד ${bartenderMax})`,
      icon: Beer,
      iconBg: C.accent,
      hoursLabel: eveningHours,
      names: toNames(bartenderPeople, 'bartender'),
      isGap: bartenderPeople.length === 0,
    },
    {
      key: 'area_supervisor',
      label: 'אחראי/ת מתחם בכיר/ה',
      icon: ShieldCheck,
      iconBg: C.info,
      hoursLabel: AREA_SUPERVISOR_HOURS,
      names: areaSupervisorId
        ? [nameWithCount(employeeNames[areaSupervisorId] ?? '—', shiftCounts, areaSupervisorId, 'area_supervisor')]
        : [],
      isGap: !areaSupervisorId,
    },
    {
      key: 'area_manager',
      label: 'אחראי/ת מתחם (עד 2)',
      icon: Users,
      iconBg: '#3F8F6B',
      hoursLabel: AREA_SUPERVISOR_HOURS,
      names: toNames(areaManagerPeople, 'area_manager'),
      isGap: areaManagerPeople.length === 0,
    },
  ]

  const dateLabel = shifts.opening?.start_time
    ? weekLabelFormatter.format(new Date(shifts.opening.start_time))
    : shifts.closing?.start_time
      ? weekLabelFormatter.format(new Date(shifts.closing.start_time))
      : weekLabelFormatter.format(shiftDateOfWeek(week))
  const weekdayLabel = new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(shiftDateOfWeek(week))
  const filledCount = duties.filter((d) => !d.isGap).length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className={cn('font-bold', compact ? 'text-lg' : 'text-xl')} style={{ color: C.text }}>
            {dateLabel}
          </h2>
          <p className="text-sm" style={{ color: C.textMuted }}>
            {weekdayLabel}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-3 py-1 text-sm font-semibold"
          style={{ background: C.infoBg, color: C.info }}
        >
          {filledCount} משמרות
        </span>
      </div>

      {weekFullyCancelled ? (
        <div className="rounded-2xl border p-3.5 text-center font-medium" style={{ background: C.errorBg, borderColor: C.border, color: C.error }}>
          השבוע הזה בוטל
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {duties.map((duty) => (
            <DutyCard
              key={duty.key}
              duty={duty}
              status={activeOpening?.effective_status ?? activeClosing?.effective_status ?? 'published'}
              compact={compact}
              onPreviewAction={onPreviewAction}
            />
          ))}
        </div>
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

  const canManage = ROLES_MANAGING_SHIFTS.includes(effectiveRole)
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
            compact={compact}
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
