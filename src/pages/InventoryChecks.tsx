import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { InventoryCount } from '@/lib/types'

interface ShiftRow {
  id: string
  start_time: string
  shift_manager_id: string | null
}

interface EmployeeNameRow {
  id: string
  full_name: string
}

interface InventoryItemNameRow {
  id: string
  name: string
  unit: string | null
}

interface ShiftCheck {
  shiftId: string
  shiftDate: string
  managerName: string
  counts: InventoryCount[]
}

export function InventoryChecks() {
  const [checks, setChecks] = useState<ShiftCheck[] | null>(null)
  const [itemNames, setItemNames] = useState<Map<string, InventoryItemNameRow>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      const { data: countsData } = await supabase
        .from('inventory_counts')
        .select('*')
        .order('created_at', { ascending: false })

      const counts = (countsData as InventoryCount[]) ?? []
      if (counts.length === 0) {
        setChecks([])
        return
      }

      const shiftIds = [...new Set(counts.map((c) => c.shift_id))]
      const itemIds = [...new Set(counts.map((c) => c.inventory_item_id))]

      const [shiftsRes, itemsRes] = await Promise.all([
        supabase.from('shifts').select('id, start_time, shift_manager_id').in('id', shiftIds),
        supabase.from('inventory_items').select('id, name, unit').in('id', itemIds),
      ])

      const shifts = (shiftsRes.data as ShiftRow[]) ?? []
      const managerIds = [...new Set(shifts.map((s) => s.shift_manager_id).filter((id): id is string => !!id))]

      const { data: employeesData } =
        managerIds.length > 0
          ? await supabase.from('employees').select('id, full_name').in('id', managerIds)
          : { data: [] }

      const employeeNames = new Map(((employeesData as EmployeeNameRow[]) ?? []).map((e) => [e.id, e.full_name]))
      const shiftsById = new Map(shifts.map((s) => [s.id, s]))
      setItemNames(new Map(((itemsRes.data as InventoryItemNameRow[]) ?? []).map((i) => [i.id, i])))

      const countsByShift = new Map<string, InventoryCount[]>()
      for (const count of counts) {
        const list = countsByShift.get(count.shift_id) ?? []
        list.push(count)
        countsByShift.set(count.shift_id, list)
      }

      const shiftChecks: ShiftCheck[] = [...countsByShift.entries()]
        .map(([shiftId, shiftCounts]) => {
          const shift = shiftsById.get(shiftId)
          return {
            shiftId,
            shiftDate: shift?.start_time ?? shiftCounts[0].created_at,
            managerName: shift?.shift_manager_id ? (employeeNames.get(shift.shift_manager_id) ?? '—') : '—',
            counts: shiftCounts,
          }
        })
        .sort((a, b) => b.shiftDate.localeCompare(a.shiftDate))

      setChecks(shiftChecks)
    }

    load()
  }, [])

  function toggleExpanded(shiftId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(shiftId)) next.delete(shiftId)
      else next.add(shiftId)
      return next
    })
  }

  if (checks === null) return null

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">בדיקות מלאי</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">כל בדיקות המלאי לפי משמרת</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {checks.length === 0 && <p className="text-muted-foreground text-sm">אין עדיין בדיקות מלאי.</p>}
          {checks.map((check) => {
            const isOpen = expanded.has(check.shiftId)
            return (
              <div key={check.shiftId} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{formatDate(check.shiftDate)}</p>
                    <p className="text-muted-foreground text-xs">
                      אחראי/ת משמרת: {check.managerName} · {check.counts.length} פריטים נספרו
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => toggleExpanded(check.shiftId)}>
                    {isOpen ? 'הסתרה' : 'פירוט'}
                  </Button>
                </div>
                {isOpen && (
                  <div className="mt-2 flex flex-col gap-1 border-t pt-2">
                    {check.counts.map((count) => {
                      const item = itemNames.get(count.inventory_item_id)
                      return (
                        <div key={count.id} className="flex items-center justify-between text-xs">
                          <span>{item?.name ?? '—'}</span>
                          <span className="text-muted-foreground">
                            {count.quantity_counted} {item?.unit ?? ''} · {formatDateTime(count.created_at)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
