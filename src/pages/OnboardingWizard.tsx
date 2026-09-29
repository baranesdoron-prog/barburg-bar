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
  const [loadedShifts, setLoadedShifts] = useState(false)
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
    const to = toDateStr(addDays(activeWeekStart(), 14))

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
      const { data: assignmentRows } = await supabase.from('shift_assignments').select('*').in('shift_id', shiftIds)
      const byShift = new Map<string, ShiftAssignment[]>()
      for (const row of (assignmentRows as ShiftAssignment[]) ?? []) {
        byShift.set(row.shift_id, [...(byShift.get(row.shift_id) ?? []), row])
      }
      setAssignmentsByShift(byShift)
    } else {
      setAssignmentsByShift(new Map())
    }

    setLoadedShifts(true)
  }

  function pickDuty(role: ShiftAssignmentRole) {
    setDuty(role)
    setStep('shifts')
    setError(null)
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

  const weeks = [...shiftsByWeek.keys()].sort()

  interface Slot {
    key: string
    dateLabel: string
    typeLabel: string
    status: 'open' | 'mine' | 'full'
    badgeText: string
    onAssign: () => void
  }

  const slots: Slot[] = []

  if (duty && duty !== 'area_supervisor') {
    for (const week of weeks) {
      const shifts = shiftsByWeek.get(week) ?? {}
      const dateLabel = shortDateFormatter.format(shiftDateOfWeek(week))
      for (const type of ['opening', 'closing'] as ShiftType[]) {
        const shift = shifts[type]
        if (!shift) continue
        const assignments = (assignmentsByShift.get(shift.id) ?? []).filter((a) => a.assignment_role === duty)
        const max = duty === 'bartender' ? shift.required_staff_count : 2
        const alreadyIn = assignments.some((a) => a.employee_id === myEmployeeId)
        const isFull = max !== null && assignments.length >= max
        slots.push({
          key: shift.id,
          dateLabel,
          typeLabel: shiftTypeLabel(shift.shift_type),
          status: alreadyIn ? 'mine' : isFull ? 'full' : 'open',
          badgeText: alreadyIn ? '✓ משובץ' : max === null ? 'פנוי' : `${assignments.length}/${max}`,
          onAssign: () => handleAssign(shift, duty as 'bartender' | 'area_manager'),
        })
      }
    }
  } else if (duty === 'area_supervisor') {
    for (const week of weeks) {
      const shifts = shiftsByWeek.get(week) ?? {}
      const dateLabel = shortDateFormatter.format(shiftDateOfWeek(week))
      const openingAssignments = (assignmentsByShift.get(shifts.opening?.id ?? '') ?? []).filter(
        (a) => a.assignment_role === 'area_supervisor',
      )
      const closingAssignments = (assignmentsByShift.get(shifts.closing?.id ?? '') ?? []).filter(
        (a) => a.assignment_role === 'area_supervisor',
      )
      const taken = openingAssignments.length > 0 || closingAssignments.length > 0
      const alreadyIn =
        openingAssignments.some((a) => a.employee_id === myEmployeeId) ||
        closingAssignments.some((a) => a.employee_id === myEmployeeId)
      slots.push({
        key: week,
        dateLabel,
        typeLabel: 'משמרת שלמה',
        status: alreadyIn ? 'mine' : taken ? 'full' : 'open',
        badgeText: alreadyIn ? '✓ משובץ' : taken ? 'מלא' : 'פנוי',
        onAssign: () => handleAssignAreaSupervisor(shifts),
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
              disabled={slot.status !== 'open'}
              onClick={slot.onAssign}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-colors',
                slot.status === 'open' && 'hover:border-primary hover:bg-accent cursor-pointer',
                slot.status === 'mine' && 'border-green-200 bg-green-50',
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

      <Button variant="ghost" onClick={finish} disabled={finishing}>
        {assignedCount > 0 ? 'סיום' : 'דלג להמשך לאפליקציה'}
      </Button>
    </div>
  )
}
