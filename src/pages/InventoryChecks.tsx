import { useEffect, useState } from 'react'
import { ChevronDown, ClipboardList, Search } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import { weekLabelFormatter } from '@/lib/weeklyChecklist'
import { C } from '@/lib/designTokens'
import { BottomNav } from '@/components/BottomNav'
import type { InventoryCount } from '@/lib/types'

const monthLabelFormatter = new Intl.DateTimeFormat('he-IL', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jerusalem',
})

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
  category_id: string | null
  display_order: number | null
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
  const [search, setSearch] = useState('')

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

      const [shiftsRes, itemsRes, categoriesRes] = await Promise.all([
        supabase.from('shifts').select('id, start_time, shift_manager_id').in('id', shiftIds),
        supabase.from('inventory_items').select('id, name, unit, category_id, display_order').in('id', itemIds),
        supabase.from('product_categories').select('id, sort_order'),
      ])

      const shifts = (shiftsRes.data as ShiftRow[]) ?? []
      const managerIds = [...new Set(shifts.map((s) => s.shift_manager_id).filter((id): id is string => !!id))]

      const { data: employeesData } =
        managerIds.length > 0
          ? await supabase.from('employees').select('id, full_name').in('id', managerIds)
          : { data: [] }

      const employeeNames = new Map(((employeesData as EmployeeNameRow[]) ?? []).map((e) => [e.id, e.full_name]))
      const shiftsById = new Map(shifts.map((s) => [s.id, s]))
      const itemsById = new Map(((itemsRes.data as InventoryItemNameRow[]) ?? []).map((i) => [i.id, i]))
      setItemNames(itemsById)

      const categorySortOrder = new Map(
        ((categoriesRes.data as { id: string; sort_order: number }[]) ?? []).map((c) => [c.id, c.sort_order])
      )
      function sortKey(itemId: string) {
        const item = itemsById.get(itemId)
        const categoryOrder = item?.category_id ? (categorySortOrder.get(item.category_id) ?? Infinity) : Infinity
        const displayOrder = item?.display_order ?? Infinity
        return [categoryOrder, displayOrder, item?.name ?? ''] as const
      }

      const countsByShift = new Map<string, InventoryCount[]>()
      for (const count of counts) {
        const list = countsByShift.get(count.shift_id) ?? []
        list.push(count)
        countsByShift.set(count.shift_id, list)
      }
      for (const list of countsByShift.values()) {
        list.sort((a, b) => {
          const [catA, orderA, nameA] = sortKey(a.inventory_item_id)
          const [catB, orderB, nameB] = sortKey(b.inventory_item_id)
          if (catA !== catB) return catA - catB
          if (orderA !== orderB) return orderA - orderB
          return nameA.localeCompare(nameB)
        })
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

  const term = search.trim()
  const filtered = term ? checks.filter((check) => check.managerName.includes(term)) : checks

  const groups: { label: string; checks: ShiftCheck[] }[] = []
  for (const check of filtered) {
    const label = monthLabelFormatter.format(new Date(check.shiftDate))
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.checks.push(check)
    else groups.push({ label, checks: [check] })
  }

  return (
    <div dir="rtl" className="min-h-svh pb-24" style={{ background: C.appBg, color: C.text }}>
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.primaryLight }}>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ background: C.primary }}>
            <ClipboardList className="size-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: C.primary }}>
            בדיקות מלאי
          </h1>
        </div>

        <div
          className="flex items-center gap-2 rounded-full border px-4"
          style={{ borderColor: C.border, background: C.card, height: 44 }}
        >
          <Search className="size-[18px] shrink-0" style={{ color: C.textMuted }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי מנהל/ת בר"
            className="h-full flex-1 bg-transparent text-sm outline-none"
            style={{ color: C.text }}
          />
        </div>

        {groups.length === 0 && (
          <p className="text-center" style={{ color: C.textMuted }}>
            {checks.length === 0 ? 'אין עדיין בדיקות מלאי.' : 'אין בדיקות תואמות.'}
          </p>
        )}

        {groups.length > 0 && (
          <div className="flex flex-col gap-3 rounded-3xl border p-3.5" style={{ background: C.subtleBg, borderColor: C.border }}>
            {groups.map((group, i) => (
              <div key={group.label} className={i === 0 ? 'flex flex-col gap-2' : 'flex flex-col gap-2 pt-2'}>
                <p className="px-0.5 text-xs font-bold" style={{ color: C.textMuted }}>
                  {group.label}
                </p>
                {group.checks.map((check) => {
                  const isOpen = expanded.has(check.shiftId)
                  return (
                    <div
                      key={check.shiftId}
                      className="overflow-hidden rounded-2xl border"
                      style={{ background: C.card, borderColor: C.border }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleExpanded(check.shiftId)}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start"
                      >
                        <div
                          className="flex size-[34px] shrink-0 items-center justify-center rounded-full"
                          style={{ background: C.accent }}
                        >
                          <ClipboardList className="size-[15px] text-white" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {check.managerName} · {weekLabelFormatter.format(new Date(check.shiftDate))}
                          </p>
                          <p className="text-xs" style={{ color: C.textMuted }}>
                            {check.counts.length} פריטים נספרו
                          </p>
                        </div>
                        <ChevronDown
                          className="size-4 shrink-0 transition-transform"
                          style={{ color: C.textMuted, transform: isOpen ? undefined : 'rotate(90deg)' }}
                        />
                      </button>
                      {isOpen && (
                        <div className="flex flex-col border-t px-3 py-1.5" style={{ borderColor: C.border }}>
                          {check.counts.map((count, index) => {
                            const item = itemNames.get(count.inventory_item_id)
                            return (
                              <div
                                key={count.id}
                                className="flex items-center justify-between gap-2 py-1.5 text-sm"
                                style={{ borderTop: index === 0 ? undefined : `1px solid ${C.border}` }}
                              >
                                <span className="min-w-0 truncate">{item?.name ?? '—'}</span>
                                <span className="shrink-0 text-xs" style={{ color: C.textMuted }}>
                                  <span className="text-sm font-bold tabular-nums" style={{ color: C.text }}>
                                    {count.quantity_counted}
                                  </span>{' '}
                                  {item?.unit ?? ''} · {formatDateTime(count.created_at)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav active="/inventory/items" />
    </div>
  )
}
