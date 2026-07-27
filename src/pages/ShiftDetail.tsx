import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { ROLES_MANAGING_SHIFTS } from '@/lib/roleLabels'
import { effectiveStatusLabels, effectiveStatusBadgeClass } from '@/lib/shiftLabels'
import { cn, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { Shift } from '@/lib/types'

export function ShiftDetail() {
  const { id } = useParams()
  const { appUser } = useAppUserContext()
  const [shift, setShift] = useState<Shift | null>(null)
  const [managerName, setManagerName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

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

    if (loadedShift.shift_manager_id) {
      const { data: emp } = await supabase
        .from('employees')
        .select('full_name')
        .eq('id', loadedShift.shift_manager_id)
        .single()
      setManagerName(emp?.full_name ?? null)
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

  if (error) return <p className="text-destructive text-center text-sm">{error}</p>
  if (!shift) return null

  const canManage = ROLES_MANAGING_SHIFTS.includes(appUser.role!)

  return (
    <Card className="mx-auto max-w-md">
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
        {shift.notes && (
          <p>
            <span className="text-muted-foreground">הערות: </span>
            {shift.notes}
          </p>
        )}
      </CardContent>
      {canManage && shift.status !== 'cancelled' && (
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
      <CardFooter className="justify-center pt-0">
        <Button asChild variant="ghost">
          <Link to="/shifts">חזרה לרשימת המשמרות</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
