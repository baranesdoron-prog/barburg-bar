import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { ROLES_MANAGING_SHIFTS, ROLES_VIEWING_SHIFTS } from '@/lib/roleLabels'
import { effectiveStatusLabels, effectiveStatusBadgeClass } from '@/lib/shiftLabels'
import { cn, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { ReplacementRequest, Shift, ShiftAssignment } from '@/lib/types'

interface Employee {
  id: string
  full_name: string
}

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

export function ShiftDetail() {
  const { id } = useParams()
  const { appUser } = useAppUserContext()
  const [shift, setShift] = useState<Shift | null>(null)
  const [managerName, setManagerName] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [pendingRequests, setPendingRequests] = useState<ReplacementRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [addingEmployeeId, setAddingEmployeeId] = useState('')

  const employeeNames = new Map(employees.map((e) => [e.id, e.full_name]))

  async function load() {
    const { data, error: fetchError } = await supabase
      .from('shifts_with_effective_status')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !data) {
      setError(fetchError?.message ?? 'משמרת לא נמצאה')
      return
    }

    const loadedShift = data as Shift
    setShift(loadedShift)

    const [managerRes, employeesRes, assignmentsRes] = await Promise.all([
      loadedShift.shift_manager_id
        ? supabase.from('employees').select('full_name').eq('id', loadedShift.shift_manager_id).single()
        : Promise.resolve({ data: null }),
      supabase.from('employees').select('id, full_name').eq('active', true).order('full_name'),
      supabase.from('shift_assignments').select('*').eq('shift_id', id),
    ])

    setManagerName((managerRes.data as { full_name: string } | null)?.full_name ?? null)
    setEmployees((employeesRes.data as Employee[]) ?? [])
    const loadedAssignments = (assignmentsRes.data as ShiftAssignment[]) ?? []
    setAssignments(loadedAssignments)

    if (loadedAssignments.length > 0) {
      const { data: requests } = await supabase
        .from('replacement_requests')
        .select('*')
        .in(
          'shift_assignment_id',
          loadedAssignments.map((a) => a.id),
        )
        .eq('status', 'pending')
      setPendingRequests((requests as ReplacementRequest[]) ?? [])
    } else {
      setPendingRequests([])
    }
  }

  useEffect(() => {
    load()
  }, [id])

  async function handleCancel() {
    if (!confirm('לבטל את המשמרת?')) return

    setCancelling(true)
    const { error: cancelError } = await supabase
      .from('shifts')
      .update({ status: 'cancelled' })
      .eq('id', id)
    setCancelling(false)

    if (cancelError) {
      setError(cancelError.message)
      return
    }

    load()
  }

  async function handleAddAssignment() {
    if (!addingEmployeeId) return

    const { error: insertError } = await supabase
      .from('shift_assignments')
      .insert({ shift_id: id, employee_id: addingEmployeeId })

    if (insertError) {
      setError(insertError.message)
      return
    }

    setAddingEmployeeId('')
    load()
  }

  async function handleRemoveAssignment(assignmentId: string) {
    const { error: deleteError } = await supabase.from('shift_assignments').delete().eq('id', assignmentId)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    load()
  }

  async function handleApproveRequest(requestId: string, substituteEmployeeId: string) {
    const { error: approveError } = await supabase.rpc('approve_replacement_request', {
      p_request_id: requestId,
      p_substitute_employee_id: substituteEmployeeId,
    })

    if (approveError) {
      setError(approveError.message)
      return
    }

    load()
  }

  async function handleRejectRequest(requestId: string) {
    const { error: rejectError } = await supabase.rpc('reject_replacement_request', {
      p_request_id: requestId,
    })

    if (rejectError) {
      setError(rejectError.message)
      return
    }

    load()
  }

  if (error) return <p className="text-destructive text-center text-sm">{error}</p>
  if (!shift) return null

  const canManageShift = ROLES_MANAGING_SHIFTS.includes(appUser.role!)
  const canManageStaffing = ROLES_VIEWING_SHIFTS.includes(appUser.role!)
  const availableEmployees = employees.filter(
    (e) => !assignments.some((a) => a.employee_id === e.id),
  )
  const understaffed =
    shift.required_staff_count !== null && shift.assigned_count < shift.required_staff_count

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{shift.shift_type}</CardTitle>
            <span
              className={cn(
                'rounded-full px-2 py-1 text-xs font-medium',
                effectiveStatusBadgeClass[shift.effective_status],
              )}
            >
              {effectiveStatusLabels[shift.effective_status]}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">התחלה: </span>
            {formatDateTime(shift.start_time)}
          </p>
          <p>
            <span className="text-muted-foreground">סיום: </span>
            {formatDateTime(shift.end_time)}
          </p>
          <p>
            <span className="text-muted-foreground">אחראי/ת: </span>
            {managerName ?? '—'}
          </p>
          {shift.required_staff_count !== null && (
            <p>
              <span className="text-muted-foreground">איוש: </span>
              {shift.assigned_count} / {shift.required_staff_count}
              {understaffed && (
                <span className="text-destructive font-medium"> — תת-איוש</span>
              )}
            </p>
          )}
          {shift.notes && (
            <p>
              <span className="text-muted-foreground">הערות: </span>
              {shift.notes}
            </p>
          )}
        </CardContent>
        {canManageShift && shift.status !== 'cancelled' && (
          <CardFooter className="flex gap-2">
            <Button asChild variant="outline" className="flex-1">
              <Link to={`/shifts/${shift.id}/edit`}>עריכה</Link>
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={cancelling}
              onClick={handleCancel}
            >
              ביטול משמרת
            </Button>
          </CardFooter>
        )}
      </Card>

      {canManageStaffing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">עובדים משובצים</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {assignments.length === 0 && (
              <p className="text-muted-foreground text-sm">אין עדיין עובדים משובצים.</p>
            )}
            {assignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span>{employeeNames.get(a.employee_id) ?? '—'}</span>
                <Button variant="ghost" size="sm" onClick={() => handleRemoveAssignment(a.id)}>
                  הסרה
                </Button>
              </div>
            ))}
            {shift.status !== 'cancelled' && (
              <div className="flex gap-2 pt-2">
                <select
                  className={selectClass}
                  value={addingEmployeeId}
                  onChange={(e) => setAddingEmployeeId(e.target.value)}
                >
                  <option value="">בחר/י עובד/ת לשיבוץ</option>
                  {availableEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}
                    </option>
                  ))}
                </select>
                <Button onClick={handleAddAssignment} disabled={!addingEmployeeId}>
                  שיבוץ
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canManageStaffing && pendingRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">בקשות החלפה ממתינות</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pendingRequests.map((req) => {
              const assignment = assignments.find((a) => a.id === req.shift_assignment_id)
              const requesterName = assignment ? employeeNames.get(assignment.employee_id) : undefined
              return (
                <ReplacementRequestRow
                  key={req.id}
                  request={req}
                  requesterName={requesterName ?? '—'}
                  employees={employees}
                  onApprove={handleApproveRequest}
                  onReject={handleRejectRequest}
                />
              )
            })}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-center">
        <Button asChild variant="ghost">
          <Link to="/shifts">חזרה לרשימת המשמרות</Link>
        </Button>
      </div>
    </div>
  )
}

function ReplacementRequestRow({
  request,
  requesterName,
  employees,
  onApprove,
  onReject,
}: {
  request: ReplacementRequest
  requesterName: string
  employees: Employee[]
  onApprove: (requestId: string, substituteEmployeeId: string) => void
  onReject: (requestId: string) => void
}) {
  const [substituteId, setSubstituteId] = useState(request.substitute_employee_id ?? '')

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <p>
        <span className="font-medium">{requesterName}</span> ביקש/ה החלפה
      </p>
      {request.reason && <p className="text-muted-foreground">סיבה: {request.reason}</p>}
      <select
        className={selectClass}
        value={substituteId}
        onChange={(e) => setSubstituteId(e.target.value)}
      >
        <option value="">בחר/י מחליף/ה</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.full_name}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={!substituteId}
          onClick={() => onApprove(request.id, substituteId)}
        >
          אישור החלפה
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => onReject(request.id)}>
          דחייה
        </Button>
      </div>
    </div>
  )
}
