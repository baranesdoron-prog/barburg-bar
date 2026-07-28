import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { roleLabels, ROLES_VIEWING_SHIFTS } from '@/lib/roleLabels'
import { useAppUserContext } from '@/lib/outletContext'
import { effectiveStatusLabels } from '@/lib/shiftLabels'
import { formatDateTime } from '@/lib/utils'
import type { EffectiveShiftStatus, ReplacementRequest, Shift, ShiftAssignment } from '@/lib/types'

function ShiftSection({ title, shifts }: { title: string; shifts: Shift[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {shifts.length === 0 && <p className="text-muted-foreground text-sm">אין משמרות</p>}
        {shifts.map((shift) => (
          <Link
            key={shift.id}
            to={`/shifts/${shift.id}`}
            className="hover:bg-accent flex flex-col rounded-md border p-3 text-sm transition-colors"
          >
            <span className="font-medium">{shift.shift_type}</span>
            <span className="text-muted-foreground">
              {formatDateTime(shift.start_time)} – {formatDateTime(shift.end_time)}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

function ManagerDashboard() {
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [pendingRequestShifts, setPendingRequestShifts] = useState<Shift[]>([])

  useEffect(() => {
    async function load() {
      const { data: shiftsData } = await supabase
        .from('shifts_with_effective_status')
        .select('*')
        .order('start_time', { ascending: true })

      const loadedShifts = (shiftsData as Shift[]) ?? []
      setShifts(loadedShifts)

      const { data: pendingRequests } = await supabase
        .from('replacement_requests')
        .select('*')
        .eq('status', 'pending')

      const requests = (pendingRequests as ReplacementRequest[]) ?? []
      if (requests.length === 0) {
        setPendingRequestShifts([])
        return
      }

      const { data: assignments } = await supabase
        .from('shift_assignments')
        .select('*')
        .in(
          'id',
          requests.map((r) => r.shift_assignment_id),
        )

      const shiftIds = new Set((assignments as ShiftAssignment[])?.map((a) => a.shift_id))
      setPendingRequestShifts(loadedShifts.filter((s) => shiftIds.has(s.id)))
    }

    load()
  }, [])

  if (!shifts) return null

  const byStatus = (status: EffectiveShiftStatus) => shifts.filter((s) => s.effective_status === status)
  const understaffed = shifts.filter(
    (s) =>
      (s.effective_status === 'published' || s.effective_status === 'active') &&
      s.required_staff_count !== null &&
      s.assigned_count < s.required_staff_count,
  )

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <ShiftSection title={effectiveStatusLabels.active} shifts={byStatus('active')} />
      <ShiftSection title="משמרות בתת-איוש" shifts={understaffed} />
      <ShiftSection title="בקשות החלפה ממתינות" shifts={pendingRequestShifts} />
      <ShiftSection title={effectiveStatusLabels.published} shifts={byStatus('published')} />
      <ShiftSection title={effectiveStatusLabels.waiting_for_closure} shifts={byStatus('waiting_for_closure')} />
    </div>
  )
}

function EmployeeDashboard({ employeeId }: { employeeId: string }) {
  const [upcoming, setUpcoming] = useState<Shift[] | null>(null)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)

  useEffect(() => {
    async function load() {
      const { data: assignments } = await supabase
        .from('shift_assignments')
        .select('*')
        .eq('employee_id', employeeId)

      const loadedAssignments = (assignments as ShiftAssignment[]) ?? []

      if (loadedAssignments.length === 0) {
        setUpcoming([])
        setPendingRequestCount(0)
        return
      }

      const [shiftsRes, requestsRes] = await Promise.all([
        supabase
          .from('shifts_with_effective_status')
          .select('*')
          .in(
            'id',
            loadedAssignments.map((a) => a.shift_id),
          )
          .in('effective_status', ['published', 'active'])
          .order('start_time', { ascending: true }),
        supabase
          .from('replacement_requests')
          .select('id')
          .in(
            'shift_assignment_id',
            loadedAssignments.map((a) => a.id),
          )
          .eq('status', 'pending'),
      ])

      setUpcoming((shiftsRes.data as Shift[]) ?? [])
      setPendingRequestCount(requestsRes.data?.length ?? 0)
    }

    load()
  }, [employeeId])

  if (upcoming === null) return null

  const [nextShift, ...rest] = upcoming

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">המשמרת הבאה שלי</CardTitle>
        </CardHeader>
        <CardContent>
          {nextShift ? (
            <Link to="/my-shifts" className="flex flex-col text-sm">
              <span className="font-medium">{nextShift.shift_type}</span>
              <span className="text-muted-foreground">
                {formatDateTime(nextShift.start_time)} – {formatDateTime(nextShift.end_time)}
              </span>
            </Link>
          ) : (
            <p className="text-muted-foreground text-sm">אין משמרות קרובות.</p>
          )}
        </CardContent>
      </Card>

      {rest.length > 0 && <ShiftSection title="משמרות קרובות" shifts={rest} />}

      {pendingRequestCount > 0 && (
        <Card>
          <CardContent className="pt-6 text-sm">
            <Link to="/my-shifts" className="text-muted-foreground">
              {pendingRequestCount} בקש{pendingRequestCount === 1 ? 'ת' : 'ות'} החלפה ממתינות לאישור
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function Dashboard() {
  const { appUser } = useAppUserContext()

  if (ROLES_VIEWING_SHIFTS.includes(appUser.role!)) {
    return <ManagerDashboard />
  }

  if (appUser.role === 'employee' && appUser.employee_id) {
    return <EmployeeDashboard employeeId={appUser.employee_id} />
  }

  return (
    <Card className="mx-auto max-w-md text-center">
      <CardHeader>
        <CardTitle>לוח הבקרה בבנייה</CardTitle>
        <CardDescription>{roleLabels[appUser.role!]}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          תוכן לוח הבקרה יתווסף בהמשך, לפי תפקיד.
        </p>
      </CardContent>
    </Card>
  )
}
