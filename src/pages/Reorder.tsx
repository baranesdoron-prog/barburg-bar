import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Minus, PackagePlus, Plus, X } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { formatMoney } from '@/lib/purchaseOrderLabels'
import { C } from '@/lib/designTokens'
import type { InventoryItemWithStock, ProductCategory, Supplier } from '@/lib/types'


export function Reorder() {
  const [items, setItems] = useState<InventoryItemWithStock[] | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  useEffect(() => {
    async function load() {
      const [itemsRes, suppliersRes, categoriesRes] = await Promise.all([
        supabase.from('inventory_items_with_latest_count').select('*').eq('active', true).order('name'),
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('product_categories').select('*'),
      ])
      const categories = (categoriesRes.data as ProductCategory[]) ?? []
      const categorySortOrder = new Map(categories.map((c) => [c.id, c.sort_order]))
      const sortedItems = ((itemsRes.data as InventoryItemWithStock[]) ?? []).sort((a, b) => {
        const orderA = a.category_id ? (categorySortOrder.get(a.category_id) ?? Infinity) : Infinity
        const orderB = b.category_id ? (categorySortOrder.get(b.category_id) ?? Infinity) : Infinity
        if (orderA !== orderB) return orderA - orderB
        const displayA = a.display_order ?? Infinity
        const displayB = b.display_order ?? Infinity
        if (displayA !== displayB) return displayA - displayB
        return a.name.localeCompare(b.name)
      })
      setItems(sortedItems)
      setSuppliers((suppliersRes.data as Supplier[]) ?? [])
    }

    load()
  }, [])

  if (items === null) return null

  const lowStockItems = items.filter((i) => i.is_low_stock)
  const supplierIds = [
    ...new Set(lowStockItems.map((i) => i.resolved_supplier_id).filter((id): id is string => id !== null)),
  ]
  const unassigned = lowStockItems.filter((i) => i.resolved_supplier_id === null)

  return (
    <div dir="rtl" className="min-h-svh pb-24" style={{ background: C.appBg, color: C.text }}>
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.primaryLight }}>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ background: C.primary }}>
            <PackagePlus className="size-6 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold" style={{ color: C.primary }}>
              השלמת מלאי
            </h1>
            {lowStockItems.length > 0 && (
              <p className="text-xs font-semibold" style={{ color: C.textSecondary }}>
                {lowStockItems.length} מוצרים מתחת למינימום
                {supplierIds.length > 0 && ` · ${supplierIds.length} ספקים`}
              </p>
            )}
          </div>
        </div>

        {lowStockItems.length === 0 && (
          <div
            className="flex items-center gap-2.5 rounded-2xl px-3 py-3 text-sm font-semibold"
            style={{ background: C.successBg, color: C.success }}
          >
            <CheckCircle2 className="size-5 shrink-0" />
            אין כרגע מוצרים מתחת לכמות המינימום.
          </div>
        )}

        {supplierIds.map((supplierId) => {
          const supplier = suppliers.find((s) => s.id === supplierId)
          if (!supplier) return null
          return (
            <SupplierGroup
              key={supplierId}
              supplier={supplier}
              lowStockItems={lowStockItems.filter((i) => i.resolved_supplier_id === supplierId)}
              allSupplierItems={items.filter((i) => i.resolved_supplier_id === supplierId)}
            />
          )
        })}

        {unassigned.length > 0 && (
          <div className="flex flex-col gap-2 rounded-3xl p-4" style={{ background: C.warningBg }}>
            <p className="text-sm font-bold" style={{ color: C.warning }}>
              ללא ספק משויך · {unassigned.length}
            </p>
            <p className="text-xs" style={{ color: C.textSecondary }}>
              יש להקצות ספק למוצרים אלו כדי שניתן יהיה להזמין אותם.
            </p>
            <div className="flex flex-col rounded-2xl px-3 py-1" style={{ background: C.card }}>
              {unassigned.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 py-1.5 text-sm"
                  style={{ borderTop: index === 0 ? undefined : `1px solid ${C.border}` }}
                >
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="shrink-0 text-xs tabular-nums" style={{ color: C.error }}>
                    {item.latest_counted_quantity ?? 0} / מינ' {item.minimum_quantity}
                  </span>
                </div>
              ))}
            </div>
            <Link
              to="/inventory/items?unassigned_supplier=1"
              className="self-start text-xs font-bold"
              style={{ color: C.primary }}
            >
              שיוך ספקים בפריטי מלאי ←
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

function SupplierGroup({
  supplier,
  lowStockItems,
  allSupplierItems,
}: {
  supplier: Supplier
  lowStockItems: InventoryItemWithStock[]
  allSupplierItems: InventoryItemWithStock[]
}) {
  const [lines, setLines] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const item of lowStockItems) {
      // A box item can't be ordered in a partial case -- round the
      // shortfall up to a whole number of cases, same formula used when
      // auto-generating reorder POs (create_purchase_order_with_reorder_items).
      const unitSize = item.unit_type === 'box' && item.units_per_box ? item.units_per_box : 1
      const shortfall =
        item.minimum_quantity !== null && item.latest_counted_quantity !== null
          ? Math.max(unitSize, Math.ceil((item.minimum_quantity - item.latest_counted_quantity) / unitSize) * unitSize)
          : unitSize
      initial[item.id] = String(shortfall)
    }
    return initial
  })
  const [addItemId, setAddItemId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null)

  const itemsById = new Map(allSupplierItems.map((i) => [i.id, i]))
  const lowStockIds = new Set(lowStockItems.map((i) => i.id))
  const includedIds = Object.keys(lines)
  const availableToAdd = allSupplierItems.filter((i) => !includedIds.includes(i.id))

  function handleAdd() {
    if (!addItemId) return
    const item = itemsById.get(addItemId)
    const unitSize = item?.unit_type === 'box' && item.units_per_box ? item.units_per_box : 1
    setLines((prev) => ({ ...prev, [addItemId]: String(unitSize) }))
    setAddItemId('')
  }

  function handleRemove(itemId: string) {
    setLines((prev) => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
  }

  async function handleCreate() {
    setSubmitting(true)
    setError(null)

    const { data: order, error: orderError } = await supabase
      .from('purchase_orders')
      .insert({ supplier_id: supplier.id, status: 'draft' })
      .select('id')
      .single()

    if (orderError || !order) {
      setSubmitting(false)
      setError(orderError?.message ?? 'שגיאה ביצירת ההזמנה')
      return
    }

    const payload = Object.entries(lines)
      .filter(([, qty]) => qty.trim() !== '' && Number(qty) > 0)
      .map(([itemId, qty]) => ({
        purchase_order_id: order.id,
        inventory_item_id: itemId,
        quantity: Number(qty),
        unit_price: itemsById.get(itemId)?.unit_price ?? null,
      }))

    const { error: itemsError } = await supabase.from('purchase_order_items').insert(payload)

    setSubmitting(false)

    if (itemsError) {
      setError(itemsError.message)
      return
    }

    setCreatedOrderId(order.id)
  }

  const total = includedIds.reduce(
    (sum, itemId) => sum + (Number(lines[itemId]) || 0) * (itemsById.get(itemId)?.unit_price ?? 0),
    0,
  )

  function stepBy(itemId: string, direction: 1 | -1) {
    const item = itemsById.get(itemId)
    const unitSize = item?.unit_type === 'box' && item.units_per_box ? item.units_per_box : 1
    const current = Number(lines[itemId]) || 0
    const next = Math.max(unitSize, current + direction * unitSize)
    setLines((prev) => ({ ...prev, [itemId]: String(next) }))
  }

  if (createdOrderId) {
    return (
      <div
        className="flex items-center gap-2.5 rounded-3xl border p-4"
        style={{ background: C.successBg, borderColor: C.success }}
      >
        <CheckCircle2 className="size-5 shrink-0" style={{ color: C.success }} />
        <p className="min-w-0 flex-1 text-sm font-semibold" style={{ color: C.success }}>
          ההזמנה ל{supplier.name} נוצרה.
        </p>
        <Link
          to={`/purchase-orders/${createdOrderId}`}
          className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold text-white"
          style={{ background: C.primary }}
        >
          פתיחת ההזמנה
        </Link>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-3xl border" style={{ background: C.card, borderColor: C.border }}>
      <div className="flex items-center gap-2.5 px-3 py-3">
        <div
          className="flex size-[34px] shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
          style={{ background: C.primary }}
        >
          {supplier.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{supplier.name}</p>
          {supplier.average_delivery_days !== null && (
            <p className="text-xs" style={{ color: C.textMuted }}>
              זמן אספקה ממוצע:{' '}
              {supplier.average_delivery_days === 1 ? 'יום' : `${supplier.average_delivery_days} ימים`}
            </p>
          )}
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold"
          style={{ background: C.errorBg, color: C.error }}
        >
          {lowStockItems.length} נמוך
        </span>
      </div>

      <div className="flex flex-col gap-2 border-t p-2.5" style={{ background: C.subtleBg, borderColor: C.border }}>
        {includedIds.map((itemId) => {
          const item = itemsById.get(itemId)
          if (!item) return null
          const isLow = lowStockIds.has(itemId)
          const isBox = item.unit_type === 'box' && !!item.units_per_box

          return (
            <div
              key={itemId}
              className="flex items-center gap-2 rounded-2xl border px-3 py-2.5"
              style={{ background: C.card, borderColor: C.border }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{item.name}</p>
                <p className="truncate text-xs" style={{ color: isLow ? C.error : C.textMuted }}>
                  {[
                    isLow ? `מלאי ${item.latest_counted_quantity ?? 0} / מינ' ${item.minimum_quantity}` : 'נוסף ידנית',
                    isBox ? `קופסה של ${item.units_per_box}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 items-center overflow-hidden rounded-xl border" style={{ borderColor: C.border }}>
                <button
                  type="button"
                  aria-label="הפחתה"
                  onClick={() => stepBy(itemId, -1)}
                  className="flex h-8 w-7 items-center justify-center"
                  style={{ background: C.subtleBg, color: C.textSecondary }}
                >
                  <Minus className="size-3.5" />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label="כמות"
                  min={isBox ? item.units_per_box! : 1}
                  step={isBox ? item.units_per_box! : 1}
                  value={lines[itemId]}
                  onChange={(e) => setLines((prev) => ({ ...prev, [itemId]: e.target.value }))}
                  className="h-8 w-10 bg-transparent text-center text-sm font-bold tabular-nums outline-none"
                  style={{ color: C.text }}
                />
                <button
                  type="button"
                  aria-label="הוספה"
                  onClick={() => stepBy(itemId, 1)}
                  className="flex h-8 w-7 items-center justify-center"
                  style={{ background: C.subtleBg, color: C.textSecondary }}
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <button
                type="button"
                aria-label="הסרה"
                onClick={() => handleRemove(itemId)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full"
                style={{ color: C.textMuted }}
              >
                <X className="size-4" />
              </button>
            </div>
          )
        })}

        {availableToAdd.length > 0 && (
          <div
            className="flex gap-2 rounded-2xl border-[1.5px] border-dashed p-2.5"
            style={{ background: C.card, borderColor: C.border }}
          >
            <select
              className="h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm"
              style={{ borderColor: C.border, background: C.card, color: C.text }}
              value={addItemId}
              onChange={(e) => setAddItemId(e.target.value)}
            >
              <option value="">הוספת מוצר נוסף</option>
              {availableToAdd.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!addItemId}
              className="flex h-10 shrink-0 items-center gap-1 rounded-xl border px-3 text-sm font-semibold disabled:opacity-50"
              style={{ borderColor: C.border, color: C.primary }}
            >
              <Plus className="size-4" />
              הוספה
            </button>
          </div>
        )}

        {error && (
          <p className="text-sm" style={{ color: C.error }}>
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={submitting || includedIds.length === 0}
          onClick={handleCreate}
          className="flex h-11 items-center justify-between rounded-xl px-4 text-sm font-bold text-white disabled:opacity-50"
          style={{ background: C.primary }}
        >
          <span>יצירת הזמנת רכש</span>
          <span className="tabular-nums">{formatMoney(total)}</span>
        </button>
      </div>
    </div>
  )
}
