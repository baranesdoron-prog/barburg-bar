import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { ROLES_MANAGING_SHIFTS, ROLES_VIEWING_SHIFTS } from '@/lib/roleLabels'
import { attendanceStatusLabels, effectiveStatusLabels, effectiveStatusBadgeClass } from '@/lib/shiftLabels'
import { cn, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { AttendanceRecord, EffectiveShiftStatus, ReplacementRequest, Shift, ShiftAssignment } from '@/lib/types'

const ATTENDANCE_ELIGIBLE_STATUSES: EffectiveShiftStatus[] = [
  'active',
  'waiting_for_closure',
  'completed',
  'reopened',
]

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
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
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
      const assignmentIds = loadedAssignments.map((a) => a.id)

      const [requestsRes, attendanceRes] = await Promise.all([
        supabase
          .from('replacement_requests')
          .select('*')
          .in('shift_assignment_id', assignmentIds)
          .eq('status', 'pending'),
        supabase.from('attendance_records').select('*').in('shift_assignment_id', assignmentIds),
      ])
      setPendingRequests((requestsRes.data as ReplacementRequest[]) ?? [])
      setAttendanceRecords((attendanceRes.data as AttendanceRecord[]) ?? [])
    } else {
      setPendingRequests([])
      setAttendanceRecords([])
    }
  }

  useEffect(() => {
    load()
  }, [id])

  async function handleCancel() {
    if (!cancelReason.trim()) return

    setCancelling(true)
    const { error: cancelError } = await supabase
      .from('shifts')
      .update({ status: 'cancelled', cancellation_reason: cancelReason.trim() })
      .eq('id', id)
    setCancelling(false)

    if (cancelError) {
      setError(cancelError.message)
      return
    }

    setShowCancelForm(false)
    setCancelReason('')
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

  async function handleReopen() {
    if (!confirm('לפתוח מחדש את המשמרת?')) return

    const { error: reopenError } = await supabase.rpc('reopen_shift', { p_shift_id: id })

    if (reopenError) {
      setError(reopenError.message)
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
          {shift.status === 'cancelled' && shift.cancellation_reason && (
            <p>
              <span className="text-muted-foreground">סיבת ביטול: </span>
              {shift.cancellation_reason}
            </p>
          )}
        </CardContent>
        {canManageShift && shift.status !== 'cancelled' && !showCancelForm && (
          <CardFooter className="flex gap-2">
            <Button asChild variant="outline" className="flex-1">
              <Link to={`/shifts/${shift.id}/edit`}>עריכה</Link>
            </Button>
            <Button variant="destructive" className="flex-1" onClick={() => setShowCancelForm(true)}>
              ביטול משמרת
            </Button>
          </CardFooter>
        )}
        {canManageShift && shift.status !== 'cancelled' && showCancelForm && (
          <CardFooter className="flex flex-col gap-2">
            <textarea
              className={selectClass + ' min-h-20'}
              placeholder="סיבת הביטול (חובה)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <div className="flex w-full gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowCancelForm(false)
                  setCancelReason('')
                }}
              >
                חזרה
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={cancelling || !cancelReason.trim()}
                onClick={handleCancel}
              >
                אישור ביטול
              </Button>
            </div>
          </CardFooter>
        )}
      </Card>

      {canManageStaffing && (shift.effective_status === 'waiting_for_closure' || shift.effective_status === 'reopened') && (
        <Button asChild>
          <Link to={`/shifts/${shift.id}/close`}>סגירת משמרת</Link>
        </Button>
      )}

      {shift.status === 'completed' && (
        <div className="flex gap-2">
          <Button asChild variant="outline" className="flex-1">
            <Link to={`/shifts/${shift.id}/report`}>צפייה בדוח</Link>
          </Button>
          {canManageShift && (
            <Button variant="outline" className="flex-1" onClick={handleReopen}>
              פתיחה מחדש
            </Button>
          )}
        </div>
      )}

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

      {canManageStaffing && ATTENDANCE_ELIGIBLE_STATUSES.includes(shift.effective_status) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">נוכחות</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {attendanceRecords.length > 0 ? (
              <p className="text-muted-foreground text-sm">
                {(['present', 'late', 'absent'] as const)
                  .map((status) => {
                    const count = attendanceRecords.filter((r) => r.status === status).length
                    return count > 0 ? `${count} ${attendanceStatusLabels[status]}` : null
                  })
                  .filter(Boolean)
                  .join(', ')}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">נוכחות טרם נרשמה.</p>
            )}
            <Button asChild variant="outline">
              <Link to={`/shifts/${shift.id}/attendance`}>רישום נוכחות</Link>
            </Button>
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
