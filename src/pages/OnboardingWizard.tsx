import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { shiftTypeLabel } from '@/lib/shiftLabels'
import { formatTime } from '@/lib/utils'
import { activeWeekStart, addDays, toDateStr, weekLabelFormatter, shiftDateOfWeek } from '@/lib/weeklyChecklist'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Shift, ShiftAssignment, ShiftAssignmentRole, ShiftType } from '@/lib/types'

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

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setStep('pick')}>
          חזרה
        </Button>
        <h1 className="text-base font-semibold">{duty ? LIST_LABELS[duty] : ''}</h1>
      </div>

      {!loadedShifts && <p className="text-muted-foreground text-center text-sm">טוען...</p>}

      {loadedShifts && weeks.length === 0 && (
        <p className="text-muted-foreground text-center text-sm">אין כרגע משמרות פתוחות.</p>
      )}

      {loadedShifts &&
        duty &&
        duty !== 'area_supervisor' &&
        weeks.map((week) => {
          const shifts = shiftsByWeek.get(week) ?? {}
          const dateLabel = weekLabelFormatter.format(shiftDateOfWeek(week))
          return (
            <Card key={week}>
              <CardHeader>
                <CardTitle className="text-sm">{dateLabel}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {(['opening', 'closing'] as ShiftType[]).map((type) => {
                  const shift = shifts[type]
                  if (!shift) return null
                  const assignments = (assignmentsByShift.get(shift.id) ?? []).filter(
                    (a) => a.assignment_role === duty,
                  )
                  const max = duty === 'bartender' ? shift.required_staff_count : 2
                  const alreadyIn = assignments.some((a) => a.employee_id === myEmployeeId)
                  const isFull = max !== null && assignments.length >= max
                  return (
                    <div key={shift.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{shiftTypeLabel(shift.shift_type)}</p>
                          <p className="text-muted-foreground text-xs">
                            {formatTime(shift.start_time)}–{formatTime(shift.end_time)}
                          </p>
                        </div>
                        {max !== null && (
                          <span className="text-muted-foreground text-xs font-medium">
                            {assignments.length}/{max}
                          </span>
                        )}
                      </div>
                      {alreadyIn ? (
                        <p className="text-muted-foreground mt-2 text-xs">כבר משובצ/ת</p>
                      ) : isFull ? (
                        <p className="text-muted-foreground mt-2 text-xs">מלא</p>
                      ) : (
                        <Button
                          size="sm"
                          className="mt-2 w-full"
                          onClick={() => handleAssign(shift, duty as 'bartender' | 'area_manager')}
                        >
                          שבץ אותי
                        </Button>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )
        })}

      {loadedShifts &&
        duty === 'area_supervisor' &&
        weeks.map((week) => {
          const shifts = shiftsByWeek.get(week) ?? {}
          const dateLabel = weekLabelFormatter.format(shiftDateOfWeek(week))
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
          return (
            <Card key={week}>
              <CardHeader>
                <CardTitle className="text-sm">{dateLabel}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <p className="text-muted-foreground text-xs">19:45–00:30 · משמרת שלמה</p>
                  {alreadyIn ? (
                    <p className="text-muted-foreground text-xs">כבר משובצ/ת</p>
                  ) : taken ? (
                    <p className="text-muted-foreground text-xs">מלא</p>
                  ) : (
                    <Button size="sm" onClick={() => handleAssignAreaSupervisor(shifts)}>
                      שבץ אותי
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}

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
