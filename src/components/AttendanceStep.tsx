import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { attendanceStatusLabels } from '@/lib/shiftLabels'
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

const statusOptions: AttendanceStatus[] = ['present', 'late', 'absent']

export function AttendanceStep({ shiftId, onSaved }: { shiftId: string; onSaved?: () => void }) {
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      const [assignmentsRes, employeesRes] = await Promise.all([
        supabase.from('shift_assignments').select('*').eq('shift_id', shiftId),
        supabase.from('employees').select('id, full_name'),
      ])

      const loadedAssignments = (assignmentsRes.data as ShiftAssignment[]) ?? []
      setAssignments(loadedAssignments)
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
        for (const assignment of loadedAssignments) {
          const record = (existing as AttendanceRecord[] | null)?.find(
            (r) => r.shift_assignment_id === assignment.id,
          )
          initial[assignment.id] = { status: record?.status ?? null, note: record?.note ?? '' }
        }
        setRows(initial)
      }

      setLoaded(true)
    }

    load()
  }, [shiftId])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)

    const payload = Object.entries(rows)
      .filter(([, row]) => row.status !== null)
      .map(([assignmentId, row]) => ({
        shift_assignment_id: assignmentId,
        status: row.status,
        note: row.note.trim() || null,
      }))

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
      {assignments.length === 0 && (
        <p className="text-muted-foreground text-sm">אין עובדים משובצים למשמרת זו.</p>
      )}
      {assignments.map((assignment) => (
        <div key={assignment.id} className="flex flex-col gap-2 rounded-md border p-3">
          <span className="text-sm font-medium">{employeeNames.get(assignment.employee_id) ?? '—'}</span>
          <div className="flex gap-2">
            {statusOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={cn(
                  'flex-1 rounded-md border px-2 py-2 text-sm font-medium transition-colors',
                  rows[assignment.id]?.status === option
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent',
                )}
                onClick={() =>
                  setRows((prev) => ({
                    ...prev,
                    [assignment.id]: { ...prev[assignment.id], status: option },
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
            value={rows[assignment.id]?.note ?? ''}
            onChange={(e) =>
              setRows((prev) => ({
                ...prev,
                [assignment.id]: { ...prev[assignment.id], note: e.target.value },
              }))
            }
          />
        </div>
      ))}

      {error && <p className="text-destructive text-sm">{error}</p>}
      {saved && <p className="text-sm text-green-600">הנוכחות נשמרה בהצלחה.</p>}

      <Button disabled={saving || assignments.length === 0} onClick={handleSave}>
        שמירת נוכחות
      </Button>
    </div>
  )
}
