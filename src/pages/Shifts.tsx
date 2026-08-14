import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { ROLES_MANAGING_SHIFTS } from '@/lib/roleLabels'
import { effectiveStatusLabels, effectiveStatusBadgeClass, shiftTypeLabel } from '@/lib/shiftLabels'
import { cn, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Shift } from '@/lib/types'

export function Shifts() {
  const { effectiveRole } = useAppUserContext()
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({})

  useEffect(() => {
    async function load() {
      const [shiftsRes, employeesRes] = await Promise.all([
        supabase
          .from('shifts_with_effective_status')
          .select('*')
          .order('start_time', { ascending: false }),
        supabase.from('employees').select('id, full_name'),
      ])

      setShifts((shiftsRes.data as Shift[]) ?? [])

      const names: Record<string, string> = {}
      for (const emp of (employeesRes.data as { id: string; full_name: string }[]) ?? []) {
        names[emp.id] = emp.full_name
      }
      setEmployeeNames(names)
    }

    load()
  }, [])

  const canManage = ROLES_MANAGING_SHIFTS.includes(effectiveRole)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">משמרות</h1>
        {canManage && (
          <Button asChild>
            <Link to="/shifts/new">משמרת חדשה</Link>
          </Button>
        )}
      </div>

      {shifts?.length === 0 && (
        <p className="text-muted-foreground text-sm">אין משמרות עדיין.</p>
      )}

      {shifts?.map((shift) => (
        <Link key={shift.id} to={`/shifts/${shift.id}`}>
          <Card className="hover:bg-accent/50 transition-colors">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{shiftTypeLabel(shift.shift_type)}</CardTitle>
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
            <CardContent className="text-muted-foreground flex flex-col gap-1 text-sm">
              <p>
                {formatDateTime(shift.start_time)} – {formatDateTime(shift.end_time)}
              </p>
              {shift.shift_manager_id && (
                <p>אחראי/ת: {employeeNames[shift.shift_manager_id] ?? '—'}</p>
              )}
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
