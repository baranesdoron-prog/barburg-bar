import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { roleLabels, ROLES_VIEWING_SHIFTS } from '@/lib/roleLabels'
import { useAppUserContext } from '@/lib/outletContext'
import { effectiveStatusLabels } from '@/lib/shiftLabels'
import { formatDateTime } from '@/lib/utils'
import type { EffectiveShiftStatus, Shift } from '@/lib/types'

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

  useEffect(() => {
    supabase
      .from('shifts_with_effective_status')
      .select('*')
      .order('start_time', { ascending: true })
      .then(({ data }) => setShifts((data as Shift[]) ?? []))
  }, [])

  if (!shifts) return null

  const byStatus = (status: EffectiveShiftStatus) => shifts.filter((s) => s.effective_status === status)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <ShiftSection title={effectiveStatusLabels.active} shifts={byStatus('active')} />
      <ShiftSection title={effectiveStatusLabels.published} shifts={byStatus('published')} />
      <ShiftSection title={effectiveStatusLabels.waiting_for_closure} shifts={byStatus('waiting_for_closure')} />
    </div>
  )
}

export function Dashboard() {
  const { appUser } = useAppUserContext()

  if (ROLES_VIEWING_SHIFTS.includes(appUser.role!)) {
    return <ManagerDashboard />
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
