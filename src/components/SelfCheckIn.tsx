import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { attendanceStatusLabels } from '@/lib/shiftLabels'
import type { AttendanceStatus } from '@/lib/types'

export function SelfCheckIn({ shiftAssignmentId }: { shiftAssignmentId: string }) {
  const [status, setStatus] = useState<AttendanceStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('attendance_records')
      .select('status')
      .eq('shift_assignment_id', shiftAssignmentId)
      .maybeSingle()
      .then(({ data }) => {
        setStatus((data?.status as AttendanceStatus) ?? null)
        setLoaded(true)
      })
  }, [shiftAssignmentId])

  async function handleCheckIn() {
    setSaving(true)
    const { error } = await supabase
      .from('attendance_records')
      .upsert({ shift_assignment_id: shiftAssignmentId, status: 'present' }, { onConflict: 'shift_assignment_id' })
    setSaving(false)
    if (!error) setStatus('present')
  }

  if (!loaded) return null

  if (status) {
    return (
      <p className="text-sm text-green-600">
        סימנת נוכחות: {attendanceStatusLabels[status]}
        {status !== 'present' && (
          <button type="button" className="text-muted-foreground ms-2 underline" onClick={handleCheckIn} disabled={saving}>
            סימון כנוכח/ת
          </button>
        )}
      </p>
    )
  }

  return (
    <button
      type="button"
      onClick={handleCheckIn}
      disabled={saving}
      className="bg-primary text-primary-foreground w-full rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
    >
      צ&apos;ק אין למשמרת
    </button>
  )
}
