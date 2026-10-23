import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ClipboardList, Plus, Search } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { formatMoney, purchaseOrderStatusLabels, purchaseOrderStatusTone } from '@/lib/purchaseOrderLabels'
import { roleLabels } from '@/lib/roleLabels'
import { shiftTypeLabel } from '@/lib/shiftLabels'
import { weekLabelFormatter } from '@/lib/weeklyChecklist'
import { C } from '@/lib/designTokens'
import type { AppRole, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus, Shift, Supplier } from '@/lib/types'

const monthLabelFormatter = new Intl.DateTimeFormat('he-IL', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jerusalem',
})

const STATUS_ORDER: PurchaseOrderStatus[] = ['draft', 'ordered', 'received', 'cancelled']

interface AppUserDisplayInfo {
  app_user_id: string
  employee_name: string | null
  role: AppRole
}

export function PurchaseOrders() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [totals, setTotals] = useState<Record<string, number>>({})
  const [shiftsById, setShiftsById] = useState<Map<string, Shift>>(new Map())
  const [creatorNames, setCreatorNames] = useState<Map<string, string>>(new Map())
  const [newSupplierId, setNewSupplierId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | null>(null)

  useEffect(() => {
    async function load() {
      const [ordersRes, suppliersRes, itemsRes, creatorsRes] = await Promise.all([
        supabase
          .from('purchase_orders')
          .select('*')
          .order('created_at', { ascending: false })
          .order('order_number', { ascending: false }),
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('purchase_order_items').select('*'),
        supabase.rpc('list_app_user_display_info'),
      ])

      const loadedOrders = (ordersRes.data as PurchaseOrder[]) ?? []
      setOrders(loadedOrders)
      setSuppliers((suppliersRes.data as Supplier[]) ?? [])

      const creators = (creatorsRes.data as AppUserDisplayInfo[]) ?? []
      setCreatorNames(
        new Map(creators.map((c) => [c.app_user_id, c.employee_name ?? roleLabels[c.role]])),
      )

      const shiftIds = [...new Set(loadedOrders.map((o) => o.created_from_shift_id).filter((id): id is string => !!id))]
      if (shiftIds.length > 0) {
        const { data: shiftsData } = await supabase.from('shifts').select('*').in('id', shiftIds)
        setShiftsById(new Map(((shiftsData as Shift[]) ?? []).map((s) => [s.id, s])))
      }

      const items = (itemsRes.data as PurchaseOrderItem[]) ?? []
      const sums: Record<string, number> = {}
      for (const item of items) {
        const lineTotal = item.quantity * (item.unit_price ?? 0)
        sums[item.purchase_order_id] = (sums[item.purchase_order_id] ?? 0) + lineTotal
      }
      setTotals(sums)
    }

    load()
  }, [])

  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]))
  const activeSuppliers = suppliers.filter((s) => s.active)

  async function handleCreate() {
    if (!newSupplierId) return

    setError(null)
    setCreating(true)
    const { data, error: rpcError } = await supabase.rpc('create_purchase_order_with_reorder_items', {
      p_supplier_id: newSupplierId,
    })
    setCreating(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    navigate(`/purchase-orders/${data.id}`)
  }

  if (orders === null) return null

  const statusCounts = new Map<PurchaseOrderStatus, number>()
  for (const order of orders) statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1)

  const term = search.trim()
  const filtered = orders.filter((order) => {
    if (statusFilter && order.status !== statusFilter) return false
    if (!term) return true
    return order.order_number.includes(term) || (supplierNames.get(order.supplier_id) ?? '').includes(term)
  })

  const groups: { label: string; total: number; orders: PurchaseOrder[] }[] = []
  for (const order of filtered) {
    const label = monthLabelFormatter.format(new Date(order.created_at))
    // Cancelled orders stay listed but don't count toward the month's spend.
    const amount = order.status === 'cancelled' ? 0 : (totals[order.id] ?? 0)
    const last = groups[groups.length - 1]
    if (last && last.label === label) {
      last.orders.push(order)
      last.total += amount
    } else groups.push({ label, total: amount, orders: [order] })
  }

  const chips: { status: PurchaseOrderStatus | null; label: string }[] = [
    { status: null, label: 'הכל' },
    ...STATUS_ORDER.map((status) => ({
      status,
      label: `${purchaseOrderStatusLabels[status]}${statusCounts.get(status) ? ` ${statusCounts.get(status)}` : ''}`,
    })),
  ]

  return (
    <div dir="rtl" className="min-h-svh pb-40" style={{ background: C.appBg, color: C.text }}>
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.primaryLight }}>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ background: C.primary }}>
            <ClipboardList className="size-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: C.primary }}>
            הזמנות רכש
          </h1>
        </div>

        {showNew && (
          <div className="flex flex-col gap-3 rounded-3xl border p-4" style={{ background: C.card, borderColor: C.primary }}>
            <h2 className="text-base font-bold">הזמנה חדשה</h2>
            <p className="text-xs" style={{ color: C.textMuted }}>
              ההזמנה נפתחת כטיוטה עם המוצרים של הספק שנמצאים מתחת למינימום.
            </p>
            <select
              className="h-10 w-full rounded-xl border px-3 text-sm"
              style={{ borderColor: C.border, background: C.card, color: C.text }}
              value={newSupplierId}
              onChange={(e) => setNewSupplierId(e.target.value)}
            >
              <option value="">בחר/י ספק</option>
              {activeSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {error && (
              <p className="text-sm" style={{ color: C.error }}>
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!newSupplierId || creating}
                onClick={handleCreate}
                className="h-10 flex-1 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: C.primary }}
              >
                יצירת הזמנה
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNew(false)
                  setError(null)
                }}
                className="h-10 flex-1 rounded-xl border text-sm font-semibold"
                style={{ borderColor: C.border, background: C.card, color: C.textSecondary }}
              >
                ביטול
              </button>
            </div>
          </div>
        )}

        <div
          className="flex items-center gap-2 rounded-full border px-4"
          style={{ borderColor: C.border, background: C.card, height: 44 }}
        >
          <Search className="size-[18px] shrink-0" style={{ color: C.textMuted }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי ספק או מספר הזמנה"
            className="h-full flex-1 bg-transparent text-sm outline-none"
            style={{ color: C.text }}
          />
        </div>

        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4" style={{ scrollbarWidth: 'none' }}>
          {chips.map((chip) => {
            const on = statusFilter === chip.status
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => setStatusFilter(chip.status)}
                className="h-8 shrink-0 rounded-full border px-3 text-xs font-semibold"
                style={{
                  background: on ? C.primary : C.card,
                  borderColor: on ? C.primary : C.border,
                  color: on ? '#fff' : C.textSecondary,
                }}
              >
                {chip.label}
              </button>
            )
          })}
        </div>

        {groups.length === 0 && (
          <p className="text-center" style={{ color: C.textMuted }}>
            {orders.length === 0 ? 'אין הזמנות רכש עדיין.' : 'אין הזמנות תואמות.'}
          </p>
        )}

        {groups.length > 0 && (
          <div className="flex flex-col gap-3 rounded-3xl border p-3.5" style={{ background: C.subtleBg, borderColor: C.border }}>
            {groups.map((group, i) => (
              <div key={group.label} className={i === 0 ? 'flex flex-col gap-2' : 'flex flex-col gap-2 pt-2'}>
                <p className="flex justify-between px-0.5 text-xs font-bold" style={{ color: C.textMuted }}>
                  <span>{group.label}</span>
                  <span className="tabular-nums">{formatMoney(group.total)}</span>
                </p>
                {group.orders.map((order) => {
                  const sourceShift = order.created_from_shift_id ? shiftsById.get(order.created_from_shift_id) : null
                  const creatorName = creatorNames.get(order.created_by)
                  const tone = purchaseOrderStatusTone[order.status]
                  const sub = [
                    order.order_number,
                    weekLabelFormatter.format(new Date(order.created_at)),
                    sourceShift ? `ממשמרת ${shiftTypeLabel(sourceShift.shift_type)}` : creatorName,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <Link
                      key={order.id}
                      to={`/purchase-orders/${order.id}`}
                      className="flex items-center gap-2.5 rounded-2xl border px-3 py-2.5"
                      style={{ background: C.card, borderColor: C.border }}
                    >
                      <div
                        className="flex size-[34px] shrink-0 items-center justify-center rounded-full"
                        style={{ background: C.accent }}
                      >
                        <ClipboardList className="size-[15px] text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {supplierNames.get(order.supplier_id) ?? '—'} · {formatMoney(totals[order.id] ?? 0)}
                        </p>
                        <p className="truncate text-xs" style={{ color: C.textMuted }}>
                          {sub}
                        </p>
                      </div>
                      <span
                        className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                        style={{
                          background: tone.bg,
                          color: tone.fg,
                          textDecoration: order.status === 'cancelled' ? 'line-through' : undefined,
                        }}
                      >
                        {purchaseOrderStatusLabels[order.status]}
                      </span>
                    </Link>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {!showNew && (
        <button
          type="button"
          onClick={() => {
            setShowNew(true)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
          className="fixed bottom-20 left-4 z-10 flex h-12 items-center gap-1.5 rounded-full px-5 text-sm font-bold text-white shadow-lg"
          style={{ background: C.primary }}
        >
          <Plus className="size-4" />
          הזמנה חדשה
        </button>
      )}
    </div>
  )
}
