import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { AttendanceStep } from '@/components/AttendanceStep'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { Shift } from '@/lib/types'

export function AttendanceForm() {
  const { id } = useParams()
  const [shift, setShift] = useState<Shift | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('shifts_with_effective_status')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError || !data) {
          setError(fetchError?.message ?? 'משמרת לא נמצאה')
          return
        }
        setShift(data as Shift)
      })
  }, [id])

  if (error) return <p className="text-destructive text-center text-sm">{error}</p>
  if (!shift) return null

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>רישום נוכחות — {shift.shift_type}</CardTitle>
      </CardHeader>
      <CardContent>
        <AttendanceStep shiftId={shift.id} />
      </CardContent>
      <CardFooter>
        <Button asChild variant="ghost" className="w-full">
          <Link to={`/shifts/${id}`}>חזרה למשמרת</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
