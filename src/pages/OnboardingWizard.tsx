import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { shiftTypeLabel } from '@/lib/shiftLabels'
import { cn } from '@/lib/utils'
import { activeWeekStart, addDays, toDateStr, shiftDateOfWeek } from '@/lib/weeklyChecklist'
import { Button } from '@/components/ui/button'
import type { Shift, ShiftAssignment, ShiftAssignmentRole, ShiftType } from '@/lib/types'

const shortDateFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric' })

function friendlyAssignmentError(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'כבר משובצ/ת למשמרת זו'
  return error.message
}

interface WeekShifts {
  opening?: Shift
  closing?: Shift
}

const PICK_LABELS: Record<ShiftAssignmentRole, string> = {
  bartender: 'להתנדב כברמן/ית',
  area_manager: 'להתנדב כאחראי/ת מתחם',
  area_supervisor: 'להתנדב כמנהל/ת מתחם',
}

const LIST_LABELS: Record<ShiftAssignmentRole, string> = {
  bartender: 'משמרות פתוחות לברמנים/יות',
  area_manager: 'משמרות פתוחות לאחראי/ת מתחם',
  area_supervisor: 'משמרות פתוחות למנהל/ת מתחם',
}

type Step = 'pick' | 'shifts'

export function OnboardingWizard() {
  const { appUser, effectiveRole } = useAppUserContext()
  const navigate = useNavigate()
  const myEmployeeId = appUser.employee_id

  const [step, setStep] = useState<Step>('pick')
  const [duty, setDuty] = useState<ShiftAssignmentRole | null>(null)
  const [canSuperviseArea, setCanSuperviseArea] = useState(false)
  const [loadedEligibility, setLoadedEligibility] = useState(false)
  const [shiftsByWeek, setShiftsByWeek] = useState<Map<string, WeekShifts>>(new Map())
  const [assignmentsByShift, setAssignmentsByShift] = useState<Map<string, ShiftAssignment[]>>(new Map())
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map())
  const [loadedShifts, setLoadedShifts] = useState(false)
  const [visibleWeekCount, setVisibleWeekCount] = useState(3)
  const [error, setError] = useState<string | null>(null)
  const [assignedCount, setAssignedCount] = useState(0)
  const [finishing, setFinishing] = useState(false)

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

    const { data: shiftsData } = await supabase
      .from('shifts_with_effective_status')
      .select('*')
      .eq('status', 'published')
      .gte('week_start', from)
      .lte('week_start', to)

    const shifts = (shiftsData as Shift[]) ?? []
    const grouped = new Map<string, WeekShifts>()
    for (const s of shifts) {
      const entry = grouped.get(s.week_start) ?? {}
      entry[s.shift_type as ShiftType] = s
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

  function pickDuty(role: ShiftAssignmentRole) {
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
          <Button size="lg" className="h-auto justify-start px-5 py-4 text-base" onClick={() => pickDuty('bartender')}>
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
    status: 'open' | 'mine' | 'full'
    badgeText: string
    namesTitle?: string
    revertible?: boolean
    onClick?: () => void
  }

  const slots: Slot[] = []

  if (duty && duty !== 'area_supervisor') {
    for (const week of weeks) {
      const shifts = shiftsByWeek.get(week) ?? {}
      const dateLabel = shortDateFormatter.format(shiftDateOfWeek(week))
      const canRevert = week > currentWeek
      for (const type of ['opening', 'closing'] as ShiftType[]) {
        const shift = shifts[type]
        if (!shift) continue
        const assignments = (assignmentsByShift.get(shift.id) ?? []).filter((a) => a.assignment_role === duty)
        const max = duty === 'bartender' ? shift.required_staff_count : 2
        const mine = assignments.find((a) => a.employee_id === myEmployeeId)
        const isFull = max !== null && assignments.length >= max
        const names = assignments.map((a) => employeeNames.get(a.employee_id)).filter((n): n is string => !!n)
        slots.push({
          key: shift.id,
          dateLabel,
          typeLabel: shiftTypeLabel(shift.shift_type),
          status: mine ? 'mine' : isFull ? 'full' : 'open',
          badgeText: mine ? '✓ משובץ' : max === null ? 'פנוי' : `${assignments.length}/${max}`,
          namesTitle: mine
            ? canRevert
              ? 'לחיצה נוספת תבטל את השיבוץ'
              : 'משמרת השבוע הנוכחי — לביטול יש להגיש בקשת החלפה בעמוד המשמרת'
            : names.length > 0
              ? `משובצים: ${names.join(', ')}`
              : undefined,
          revertible: !!mine && canRevert,
          onClick: mine
            ? canRevert
              ? () => handleRemove([mine.id])
              : () => navigate(`/shifts/${shift.id}`)
            : !isFull
              ? () => handleAssign(shift, duty as 'bartender' | 'area_manager')
              : undefined,
        })
      }
    }
  } else if (duty === 'area_supervisor') {
    for (const week of weeks) {
      const shifts = shiftsByWeek.get(week) ?? {}
      const dateLabel = shortDateFormatter.format(shiftDateOfWeek(week))
      const canRevert = week > currentWeek
      const openingAssignments = (assignmentsByShift.get(shifts.opening?.id ?? '') ?? []).filter(
        (a) => a.assignment_role === 'area_supervisor',
      )
      const closingAssignments = (assignmentsByShift.get(shifts.closing?.id ?? '') ?? []).filter(
        (a) => a.assignment_role === 'area_supervisor',
      )
      const allAssignments = [...openingAssignments, ...closingAssignments]
      const taken = allAssignments.length > 0
      const mine = allAssignments.filter((a) => a.employee_id === myEmployeeId)
      const names = [...new Set(allAssignments.map((a) => employeeNames.get(a.employee_id)).filter((n): n is string => !!n))]
      const anyShiftId = shifts.opening?.id ?? shifts.closing?.id
      slots.push({
        key: week,
        dateLabel,
        typeLabel: 'משמרת שלמה',
        status: mine.length > 0 ? 'mine' : taken ? 'full' : 'open',
        badgeText: mine.length > 0 ? '✓ משובץ' : taken ? 'מלא' : 'פנוי',
        namesTitle:
          mine.length > 0
            ? canRevert
              ? 'לחיצה נוספת תבטל את השיבוץ'
              : 'משמרת השבוע הנוכחי — לביטול יש להגיש בקשת החלפה בעמוד המשמרת'
            : names.length > 0
              ? `משובצים: ${names.join(', ')}`
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
              ? () => handleAssignAreaSupervisor(shifts)
              : undefined,
      })
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setStep('pick')}>
          חזרה
        </Button>
        <h1 className="text-base font-semibold">{duty ? LIST_LABELS[duty] : ''}</h1>
      </div>

      {!loadedShifts && <p className="text-muted-foreground text-center text-sm">טוען...</p>}

      {loadedShifts && slots.length === 0 && (
        <p className="text-muted-foreground text-center text-sm">אין כרגע משמרות פתוחות.</p>
      )}

      {loadedShifts && slots.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5">
          {slots.map((slot) => (
            <button
              key={slot.key}
              type="button"
              disabled={!slot.onClick}
              onClick={slot.onClick}
              title={slot.namesTitle}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-colors',
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
              )}
            >
              <span className="text-muted-foreground text-[11px]">{slot.dateLabel}</span>
              <span className="text-sm font-semibold">{slot.typeLabel}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  slot.status === 'mine' ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground',
                )}
              >
                {slot.badgeText}
              </span>
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
          onClick={() => setVisibleWeekCount((c) => c + (duty === 'area_supervisor' ? 6 : 3))}
        >
          עוד משמרות
        </Button>
      )}

      <Button variant="ghost" onClick={finish} disabled={finishing}>
        הושלם!
      </Button>
    </div>
  )
}
