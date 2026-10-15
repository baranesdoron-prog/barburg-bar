import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { attendanceStatusLabels, shiftAssignmentRoleLabels } from '@/lib/shiftLabels'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { AttendanceRecord, AttendanceStatus, ShiftAssignment } from '@/lib/types'

interface Employee {
  id: string
  full_name: string
}

interface RowState {
  status: AttendanceStatus | null
  note: string
}

// Bartender/area manager/area supervisor are whole-evening duties now --
// the same person holds a shift_assignments row on both the opening and
// closing shift instance covered here. Group by employee so they show up
// once to mark, not twice; saving still writes the same status/note to
// every one of their rows so nothing reading attendance_records by
// shift_assignment_id sees a gap.
interface AttendanceGroup {
  employeeId: string
  role: ShiftAssignment['assignment_role']
  assignmentIds: string[]
}

function groupByEmployee(assignments: ShiftAssignment[]): AttendanceGroup[] {
  const order: string[] = []
  const byEmployee = new Map<string, AttendanceGroup>()
  for (const a of assignments) {
    const existing = byEmployee.get(a.employee_id)
    if (existing) {
      existing.assignmentIds.push(a.id)
    } else {
      byEmployee.set(a.employee_id, { employeeId: a.employee_id, role: a.assignment_role, assignmentIds: [a.id] })
      order.push(a.employee_id)
    }
  }
  return order.map((employeeId) => byEmployee.get(employeeId)!)
}

const statusOptions: AttendanceStatus[] = ['present', 'late', 'absent']

export function AttendanceStep({ shiftIds, onSaved }: { shiftIds: string[]; onSaved?: () => void }) {
  const [groups, setGroups] = useState<AttendanceGroup[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (shiftIds.length === 0) {
      setGroups([])
      setLoaded(true)
      return
    }

    async function load() {
      const [assignmentsRes, employeesRes] = await Promise.all([
        supabase.from('shift_assignments').select('*').in('shift_id', shiftIds),
        supabase.from('employees').select('id, full_name'),
      ])

      const loadedAssignments = (assignmentsRes.data as ShiftAssignment[]) ?? []
      const loadedGroups = groupByEmployee(loadedAssignments)
      setGroups(loadedGroups)
      setEmployees((employeesRes.data as Employee[]) ?? [])

      if (loadedAssignments.length > 0) {
        const { data: existing } = await supabase
          .from('attendance_records')
          .select('*')
          .in(
            'shift_assignment_id',
            loadedAssignments.map((a) => a.id),
          )

        const initial: Record<string, RowState> = {}
        for (const group of loadedGroups) {
          const record = (existing as AttendanceRecord[] | null)?.find((r) =>
            group.assignmentIds.includes(r.shift_assignment_id),
          )
          initial[group.employeeId] = { status: record?.status ?? null, note: record?.note ?? '' }
        }
        setRows(initial)
      }

      setLoaded(true)
    }

    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftIds.join(',')])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)

    const payload = groups.flatMap((group) => {
      const row = rows[group.employeeId]
      if (!row || row.status === null) return []
      return group.assignmentIds.map((assignmentId) => ({
        shift_assignment_id: assignmentId,
        status: row.status,
        note: row.note.trim() || null,
      }))
    })

    const { error: saveError } = await supabase
      .from('attendance_records')
      .upsert(payload, { onConflict: 'shift_assignment_id' })

    setSaving(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    setSaved(true)
    onSaved?.()
  }

  if (!loaded) return null

  const employeeNames = new Map(employees.map((e) => [e.id, e.full_name]))

  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 && (
        <p className="text-muted-foreground text-sm">אין עובדים משובצים למשמרת זו.</p>
      )}
      {groups.map((group) => (
        <div key={group.employeeId} className="flex flex-col gap-2 rounded-md border p-3">
          <span className="text-sm font-medium">
            {employeeNames.get(group.employeeId) ?? '—'}
            <span className="text-muted-foreground font-normal"> · {shiftAssignmentRoleLabels[group.role]}</span>
          </span>
          <div className="flex gap-2">
            {statusOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={cn(
                  'flex-1 rounded-md border px-2 py-2 text-sm font-medium transition-colors',
                  rows[group.employeeId]?.status === option
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent',
                )}
                onClick={() =>
                  setRows((prev) => ({
                    ...prev,
                    [group.employeeId]: { ...prev[group.employeeId], status: option },
                  }))
                }
              >
                {attendanceStatusLabels[option]}
              </button>
            ))}
          </div>
          <input
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm outline-none"
            placeholder="הערה (לא חובה)"
            value={rows[group.employeeId]?.note ?? ''}
            onChange={(e) =>
              setRows((prev) => ({
                ...prev,
                [group.employeeId]: { ...prev[group.employeeId], note: e.target.value },
              }))
            }
          />
        </div>
      ))}

      {error && <p className="text-destructive text-sm">{error}</p>}
      {saved && <p className="text-sm text-green-600">הנוכחות נשמרה בהצלחה.</p>}

      <Button disabled={saving || groups.length === 0} onClick={handleSave}>
        שמירת נוכחות
      </Button>
    </div>
  )
}
