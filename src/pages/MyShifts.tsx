import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { effectiveStatusLabels, effectiveStatusBadgeClass } from '@/lib/shiftLabels'
import { cn, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ReplacementRequest, Shift, ShiftAssignment } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

interface Employee {
  id: string
  full_name: string
}

interface AssignedShift {
  assignment: ShiftAssignment
  shift: Shift
  pendingRequest: ReplacementRequest | null
}

export function MyShifts() {
  const { appUser } = useAppUserContext()
  const [items, setItems] = useState<AssignedShift[] | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])

  async function load() {
    const { data: assignments } = await supabase
      .from('shift_assignments')
      .select('*')
      .eq('employee_id', appUser.employee_id)

    const loadedAssignments = (assignments as ShiftAssignment[]) ?? []

    if (loadedAssignments.length === 0) {
      setItems([])
      return
    }

    const shiftIds = loadedAssignments.map((a) => a.shift_id)
    const assignmentIds = loadedAssignments.map((a) => a.id)

    const [shiftsRes, requestsRes, employeesRes] = await Promise.all([
      supabase.from('shifts_with_effective_status').select('*').in('id', shiftIds),
      supabase
        .from('replacement_requests')
        .select('*')
        .in('shift_assignment_id', assignmentIds)
        .eq('status', 'pending'),
      supabase.from('employees').select('id, full_name').eq('active', true).order('full_name'),
    ])

    const shiftsById = new Map((shiftsRes.data as Shift[]).map((s) => [s.id, s]))
    const requestsByAssignment = new Map(
      (requestsRes.data as ReplacementRequest[]).map((r) => [r.shift_assignment_id, r]),
    )
    setEmployees((employeesRes.data as Employee[]) ?? [])

    const merged = loadedAssignments
      .map((assignment) => ({
        assignment,
        shift: shiftsById.get(assignment.shift_id)!,
        pendingRequest: requestsByAssignment.get(assignment.id) ?? null,
      }))
      .filter((item) => item.shift)
      .sort((a, b) => a.shift.start_time.localeCompare(b.shift.start_time))

    setItems(merged)
  }

  useEffect(() => {
    load()
  }, [])

  if (items === null) return null

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">המשמרות שלי</h1>

      {items.length === 0 && (
        <p className="text-muted-foreground text-sm">אין לך משמרות משובצות כרגע.</p>
      )}

      {items.map((item) => (
        <ShiftRow key={item.assignment.id} item={item} employees={employees} onChanged={load} />
      ))}
    </div>
  )
}

function ShiftRow({
  item,
  employees,
  onChanged,
}: {
  item: AssignedShift
  employees: Employee[]
  onChanged: () => void
}) {
  const { shift, assignment, pendingRequest } = item
  const [showForm, setShowForm] = useState(false)
  const [reason, setReason] = useState('')
  const [substituteId, setSubstituteId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canRequestReplacement = shift.effective_status === 'published' && !pendingRequest

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)

    const { error: requestError } = await supabase.rpc('request_replacement', {
      p_shift_assignment_id: assignment.id,
      p_reason: reason.trim() || null,
      p_substitute_employee_id: substituteId || null,
    })

    setSubmitting(false)

    if (requestError) {
      setError(requestError.message)
      return
    }

    setShowForm(false)
    setReason('')
    setSubstituteId('')
    onChanged()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{shift.shift_type}</CardTitle>
          <span
            className={cn(
              'rounded-full px-2 py-1 text-xs font-medium',
              effectiveStatusBadgeClass[shift.effective_status],
            )}
          >
            {effectiveStatusLabels[shift.effective_status]}
          </span>
        </div>
        <CardDescription>
          {formatDateTime(shift.start_time)} – {formatDateTime(shift.end_time)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pendingRequest && (
          <p className="text-muted-foreground text-sm">בקשת החלפה נשלחה, ממתינה לאישור.</p>
        )}

        {canRequestReplacement && !showForm && (
          <Button variant="outline" onClick={() => setShowForm(true)}>
            בקש/י החלפה
          </Button>
        )}

        {canRequestReplacement && showForm && (
          <div className="flex flex-col gap-2">
            <textarea
              className={selectClass + ' min-h-16'}
              placeholder="סיבה (לא חובה)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <select
              className={selectClass}
              value={substituteId}
              onChange={(e) => setSubstituteId(e.target.value)}
            >
              <option value="">הצעת מחליף/ה (לא חובה)</option>
              {employees
                .filter((e) => e.id !== assignment.employee_id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
            </select>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <div className="flex gap-2">
              <Button className="flex-1" disabled={submitting} onClick={handleSubmit}>
                שליחת בקשה
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => setShowForm(false)}>
                ביטול
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
