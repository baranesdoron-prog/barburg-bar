import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { Shift, ShiftStatus } from '@/lib/types'

interface Employee {
  id: string
  full_name: string
}

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

function toDatetimeLocal(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ShiftForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [shiftType, setShiftType] = useState('')
  const [shiftManagerId, setShiftManagerId] = useState('')
  const [notes, setNotes] = useState('')
  const [requiredStaffCount, setRequiredStaffCount] = useState('')
  const [status, setStatus] = useState<ShiftStatus>('draft')
  const [loading, setLoading] = useState(isEdit)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .rpc('list_shift_manager_employees')
      .then(({ data }) => setEmployees((data as Employee[]) ?? []))
  }, [])

  useEffect(() => {
    if (!id) return

    supabase
      .from('shifts')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error: fetchError }) => {
        setLoading(false)
        if (fetchError || !data) {
          setError(fetchError?.message ?? 'משמרת לא נמצאה')
          return
        }
        const shift = data as Shift
        setStartTime(toDatetimeLocal(shift.start_time))
        setEndTime(toDatetimeLocal(shift.end_time))
        setShiftType(shift.shift_type)
        setShiftManagerId(shift.shift_manager_id ?? '')
        setNotes(shift.notes ?? '')
        setRequiredStaffCount(shift.required_staff_count?.toString() ?? '')
        setStatus(shift.status)
      })
  }, [id])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!startTime || !endTime || !shiftType.trim()) {
      setError('יש למלא תאריך/שעת התחלה, סיום וסוג משמרת')
      return
    }

    if (status === 'published' && !shiftManagerId) {
      setError('פרסום משמרת דורש בחירת אחראי/ת משמרת')
      return
    }

    setSubmitting(true)

    const payload = {
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      shift_type: shiftType.trim(),
      shift_manager_id: shiftManagerId || null,
      notes: notes.trim() || null,
      required_staff_count: requiredStaffCount ? Number(requiredStaffCount) : null,
      status,
    }

    const { error: saveError, data: saved } = isEdit
      ? await supabase.from('shifts').update(payload).eq('id', id).select('id').single()
      : await supabase.from('shifts').insert(payload).select('id').single()

    setSubmitting(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    navigate(`/shifts/${saved.id}`)
  }

  if (loading) return null

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>{isEdit ? 'עריכת משמרת' : 'משמרת חדשה'}</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="shift-type">סוג משמרת</Label>
            <Input id="shift-type" value={shiftType} onChange={(e) => setShiftType(e.target.value)} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="start-time">התחלה</Label>
            <Input
              id="start-time"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="end-time">סיום</Label>
            <Input
              id="end-time"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="shift-manager">אחראי/ת משמרת</Label>
            <select
              id="shift-manager"
              className={selectClass}
              value={shiftManagerId}
              onChange={(e) => setShiftManagerId(e.target.value)}
            >
              <option value="">— ללא —</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="required-staff-count">מספר עובדים נדרש (לא חובה)</Label>
            <Input
              id="required-staff-count"
              type="number"
              min={1}
              value={requiredStaffCount}
              onChange={(e) => setRequiredStaffCount(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">הערות</Label>
            <textarea
              id="notes"
              className={selectClass + ' min-h-20'}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="status">סטטוס</Label>
            <select
              id="status"
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as ShiftStatus)}
            >
              <option value="draft">טיוטה</option>
              <option value="published">מפורסמת</option>
            </select>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={submitting} className="w-full">
            {isEdit ? 'שמירה' : 'יצירה'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
