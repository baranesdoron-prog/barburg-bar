import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, ChevronRight, Minus, Plus, X } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { formatMoney, purchaseOrderStatusLabels, purchaseOrderStatusTone } from '@/lib/purchaseOrderLabels'
import { formatDateTime } from '@/lib/utils'
import { C } from '@/lib/designTokens'
import type { InventoryItem, ProductCategory, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus, Supplier } from '@/lib/types'

const STEPS: PurchaseOrderStatus[] = ['draft', 'ordered', 'received']

export function PurchaseOrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [items, setItems] = useState<PurchaseOrderItem[]>([])
  const [catalog, setCatalog] = useState<InventoryItem[]>([])
  const [newItemId, setNewItemId] = useState('')
  const [newQuantity, setNewQuantity] = useState('')
  const [newUnitPrice, setNewUnitPrice] = useState('')
  const [updateCatalogPrice, setUpdateCatalogPrice] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const { data, error: fetchError } = await supabase
      .from('purchase_orders')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !data) {
      setError(fetchError?.message ?? 'הזמנה לא נמצאה')
      return
    }

    const loadedOrder = data as PurchaseOrder
    setOrder(loadedOrder)

    const [supplierRes, itemsRes, catalogRes, categoriesRes] = await Promise.all([
      supabase.from('suppliers').select('*').eq('id', loadedOrder.supplier_id).single(),
      supabase.from('purchase_order_items').select('*').eq('purchase_order_id', id).order('created_at').order('id'),
      supabase.from('inventory_items').select('*').eq('active', true).order('name'),
      supabase.from('product_categories').select('*'),
    ])

    const categories = (categoriesRes.data as ProductCategory[]) ?? []
    const categorySortOrder = new Map(categories.map((c) => [c.id, c.sort_order]))
    const sortedCatalog = ((catalogRes.data as InventoryItem[]) ?? []).sort((a, b) => {
      const orderA = a.category_id ? (categorySortOrder.get(a.category_id) ?? Infinity) : Infinity
      const orderB = b.category_id ? (categorySortOrder.get(b.category_id) ?? Infinity) : Infinity
      if (orderA !== orderB) return orderA - orderB
      const displayA = a.display_order ?? Infinity
      const displayB = b.display_order ?? Infinity
      if (displayA !== displayB) return displayA - displayB
      return a.name.localeCompare(b.name)
    })

    const loadedItems = (itemsRes.data as PurchaseOrderItem[]) ?? []
    setSupplier(supplierRes.data as Supplier)
    setItems(loadedItems)
    setCatalog(sortedCatalog)
    setQuantities(Object.fromEntries(loadedItems.map((item) => [item.id, String(item.quantity)])))
  }

  useEffect(() => {
    load()
  }, [id])

  function handleSelectItem(itemId: string) {
    setNewItemId(itemId)
    const catalogItem = catalog.find((c) => c.id === itemId)
    setNewUnitPrice(catalogItem?.unit_price !== null && catalogItem?.unit_price !== undefined ? String(catalogItem.unit_price) : '')
    setUpdateCatalogPrice(false)
  }

  async function handleAddItem() {
    setError(null)

    if (!newItemId || !newQuantity) {
      setError('יש לבחור פריט ולהזין כמות')
      return
    }

    setSubmitting(true)

    const { error: insertError } = await supabase.from('purchase_order_items').insert({
      purchase_order_id: id,
      inventory_item_id: newItemId,
      quantity: Number(newQuantity),
      unit_price: newUnitPrice ? Number(newUnitPrice) : null,
    })

    if (insertError) {
      setSubmitting(false)
      setError(insertError.message)
      return
    }

    if (updateCatalogPrice && newUnitPrice) {
      const { error: catalogError } = await supabase
        .from('inventory_items')
        .update({ unit_price: Number(newUnitPrice) })
        .eq('id', newItemId)

      if (catalogError) {
        setSubmitting(false)
        setError(catalogError.message)
        return
      }
    }

    setSubmitting(false)
    setNewItemId('')
    setNewQuantity('')
    setNewUnitPrice('')
    setUpdateCatalogPrice(false)
    load()
  }

  async function handleRemoveItem(itemId: string) {
    await supabase.from('purchase_order_items').delete().eq('id', itemId)
    load()
  }

  async function handleSetStatus(status: 'ordered' | 'received' | 'cancelled') {
    if (status === 'cancelled' && !confirm('לבטל את ההזמנה?')) return

    const { error: updateError } =
      status === 'received'
        ? await supabase.rpc('receive_purchase_order', { p_order_id: id })
        : await supabase.from('purchase_orders').update({ status }).eq('id', id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    load()
  }

  async function handleDelete() {
    if (!confirm('למחוק את ההזמנה לצמיתות?')) return

    const { error: itemsError } = await supabase.from('purchase_order_items').delete().eq('purchase_order_id', id)
    if (itemsError) {
      setError(itemsError.message)
      return
    }

    const { error: deleteError } = await supabase.from('purchase_orders').delete().eq('id', id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }

    navigate('/purchase-orders')
  }

  async function saveQuantity(item: PurchaseOrderItem, quantity: number) {
    if (quantity <= 0 || quantity === item.quantity) {
      setQuantities((prev) => ({ ...prev, [item.id]: String(item.quantity) }))
      return
    }
    setQuantities((prev) => ({ ...prev, [item.id]: String(quantity) }))
    const { error: updateError } = await supabase.from('purchase_order_items').update({ quantity }).eq('id', item.id)
    if (updateError) {
      setError(updateError.message)
      setQuantities((prev) => ({ ...prev, [item.id]: String(item.quantity) }))
      return
    }
    // Update in place rather than reloading, so the lines keep their position
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, quantity } : i)))
  }

  if (!order && error) {
    return (
      <p className="text-center text-sm" style={{ color: C.error }}>
        {error}
      </p>
    )
  }
  if (!order || !supplier) return null

  const catalogById = new Map(catalog.map((c) => [c.id, c]))
  const total = items.reduce((sum, item) => sum + item.quantity * (item.unit_price ?? 0), 0)
  const isDraft = order.status === 'draft'
  const tone = purchaseOrderStatusTone[order.status]
  const stepIndex = order.status === 'draft' ? 0 : order.status === 'ordered' ? 1 : 2

  const actionButtonClass = 'flex h-11 items-center justify-center rounded-xl px-4 text-sm font-bold'

  return (
    <div dir="rtl" className="min-h-svh pb-48" style={{ background: C.appBg, color: C.text }}>
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <Link
          to="/purchase-orders"
          className="flex items-center gap-1 self-start text-sm font-semibold"
          style={{ color: C.textSecondary }}
        >
          <ChevronRight className="size-4" />
          הזמנות רכש
        </Link>

        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.primaryLight }}>
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-white"
            style={{ background: C.primary }}
          >
            {supplier.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold" style={{ color: C.primary }}>
              {supplier.name}
            </h1>
            <p className="truncate text-xs font-semibold" style={{ color: C.textSecondary }}>
              {order.order_number} · נוצר {formatDateTime(order.created_at)}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold"
            style={{
              background: tone.bg,
              color: tone.fg,
              textDecoration: order.status === 'cancelled' ? 'line-through' : undefined,
            }}
          >
            {purchaseOrderStatusLabels[order.status]}
          </span>
        </div>

        {order.status === 'cancelled' ? (
          <p className="rounded-2xl px-3 py-2.5 text-sm font-semibold" style={{ background: C.errorBg, color: C.error }}>
            ההזמנה בוטלה.
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-2xl border px-3 py-2.5" style={{ background: C.card, borderColor: C.border }}>
            <div className="flex items-center gap-1.5">
              {STEPS.map((step, i) => {
                const done = i < stepIndex || order.status === 'received'
                const current = i === stepIndex && order.status !== 'received'
                return (
                  <Fragment key={step}>
                    {i > 0 && (
                      <div className="h-0.5 flex-1 rounded-full" style={{ background: i <= stepIndex ? C.primary : C.border }} />
                    )}
                    <div
                      className="flex items-center gap-1.5 text-xs font-bold"
                      style={{ color: done ? C.primary : current ? C.warning : C.textMuted }}
                    >
                      <span
                        className="flex size-[22px] items-center justify-center rounded-full border-2 text-[11px]"
                        style={{
                          background: done ? C.primary : C.card,
                          borderColor: done ? C.primary : current ? C.accent : C.border,
                          color: done ? '#fff' : undefined,
                        }}
                      >
                        {done ? <Check className="size-3" /> : i + 1}
                      </span>
                      {purchaseOrderStatusLabels[step]}
                    </div>
                  </Fragment>
                )
              })}
            </div>
            {(order.ordered_at || order.received_at) && (
              <p className="text-xs" style={{ color: C.textMuted }}>
                {[
                  order.ordered_at && `הוזמן ${formatDateTime(order.ordered_at)}`,
                  order.received_at && `התקבל ${formatDateTime(order.received_at)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-3xl border p-3.5" style={{ background: C.subtleBg, borderColor: C.border }}>
          <p className="flex justify-between px-0.5 text-xs font-bold">
            <span>פריטים</span>
            <span style={{ color: C.textMuted }}>{items.length}</span>
          </p>

          {items.length === 0 && (
            <p className="py-2 text-center text-sm" style={{ color: C.textMuted }}>
              אין פריטים עדיין.
            </p>
          )}

          {items.map((item) => {
            const catalogItem = catalogById.get(item.inventory_item_id)
            const isLow =
              catalogItem?.minimum_quantity != null && catalogItem.current_stock < catalogItem.minimum_quantity
            const sub = [
              item.unit_price !== null ? `${formatMoney(item.unit_price)} ליח'` : null,
              catalogItem
                ? `מלאי ${catalogItem.current_stock}${catalogItem.minimum_quantity !== null ? ` / מינ' ${catalogItem.minimum_quantity}` : ''}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-2xl border px-3 py-2.5"
                style={{ background: C.card, borderColor: C.border }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {catalogItem?.name ?? '—'}
                    {catalogItem?.unit && (
                      <span className="font-medium" style={{ color: C.textMuted }}>
                        {' '}
                        ({catalogItem.unit})
                      </span>
                    )}
                  </p>
                  {sub && (
                    <p className="truncate text-xs" style={{ color: isLow ? C.error : C.textMuted }}>
                      {sub}
                    </p>
                  )}
                </div>
                {isDraft ? (
                  <>
                    <div className="flex shrink-0 items-center overflow-hidden rounded-xl border" style={{ borderColor: C.border }}>
                      <button
                        type="button"
                        aria-label="הפחתה"
                        disabled={item.quantity <= 1}
                        onClick={() => saveQuantity(item, item.quantity - 1)}
                        className="flex h-8 w-7 items-center justify-center disabled:opacity-40"
                        style={{ background: C.subtleBg, color: C.textSecondary }}
                      >
                        <Minus className="size-3.5" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        aria-label="כמות"
                        value={quantities[item.id] ?? ''}
                        onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        onBlur={() => saveQuantity(item, Number(quantities[item.id]) || 0)}
                        className="h-8 w-10 bg-transparent text-center text-sm font-bold tabular-nums outline-none"
                        style={{ color: C.text }}
                      />
                      <button
                        type="button"
                        aria-label="הוספה"
                        onClick={() => saveQuantity(item, item.quantity + 1)}
                        className="flex h-8 w-7 items-center justify-center"
                        style={{ background: C.subtleBg, color: C.textSecondary }}
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label="הסרה"
                      onClick={() => handleRemoveItem(item.id)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full"
                      style={{ color: C.textMuted }}
                    >
                      <X className="size-4" />
                    </button>
                  </>
                ) : (
                  <span className="shrink-0 text-base font-bold tabular-nums">{item.quantity}</span>
                )}
              </div>
            )
          })}

          {isDraft && (
            <div
              className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-dashed p-3"
              style={{ background: C.card, borderColor: C.border }}
            >
              <select
                className="h-10 w-full rounded-xl border px-3 text-sm"
                style={{ borderColor: C.border, background: C.card, color: C.text }}
                value={newItemId}
                onChange={(e) => handleSelectItem(e.target.value)}
              >
                <option value="">בחר/י פריט להוספה</option>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="כמות"
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(e.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm outline-none"
                  style={{ borderColor: C.border, background: C.card, color: C.text }}
                />
                <input
                  type="number"
                  placeholder="מחיר ליחידה (לא חובה)"
                  value={newUnitPrice}
                  onChange={(e) => setNewUnitPrice(e.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm outline-none"
                  style={{ borderColor: C.border, background: C.card, color: C.text }}
                />
              </div>
              <label className="flex items-center gap-2 text-xs" style={{ color: C.textSecondary }}>
                <input
                  type="checkbox"
                  checked={updateCatalogPrice}
                  onChange={(e) => setUpdateCatalogPrice(e.target.checked)}
                />
                עדכון מחיר זה גם בקטלוג המוצרים
              </label>
              <button
                type="button"
                disabled={submitting}
                onClick={handleAddItem}
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: C.border, color: C.primary }}
              >
                <Plus className="size-4" />
                הוספת פריט
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-xl px-3 py-2 text-sm" style={{ background: C.errorBg, color: C.error }}>
            {error}
          </p>
        )}
      </div>

      <div
        className="fixed inset-x-0 z-10 border-t"
        style={{
          background: C.card,
          borderColor: C.border,
          // Sits right on top of BottomNav, whose height is 54px of
          // content plus its own max(8px, safe-area) bottom padding.
          bottom: 'calc(55px + max(8px, env(safe-area-inset-bottom, 0px)))',
        }}
      >
        <div className="mx-auto flex max-w-xl items-center gap-2 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold" style={{ color: C.textMuted }}>
              סה"כ · {items.length} פריטים
            </p>
            <p className="text-lg font-bold tabular-nums">{formatMoney(total)}</p>
          </div>
          {(order.status === 'draft' || order.status === 'ordered') && (
            <button
              type="button"
              onClick={() => handleSetStatus('cancelled')}
              className={`${actionButtonClass} border`}
              style={{ borderColor: C.border, color: C.error }}
            >
              ביטול הזמנה
            </button>
          )}
          {order.status === 'draft' && (
            <button
              type="button"
              onClick={() => handleSetStatus('ordered')}
              className={`${actionButtonClass} text-white`}
              style={{ background: C.primary }}
            >
              סימון כהוזמן
            </button>
          )}
          {order.status === 'ordered' && (
            <button
              type="button"
              onClick={() => handleSetStatus('received')}
              className={`${actionButtonClass} text-white`}
              style={{ background: C.primary }}
            >
              סימון כהתקבל
            </button>
          )}
          {order.status === 'cancelled' && (
            <button
              type="button"
              onClick={handleDelete}
              className={`${actionButtonClass} text-white`}
              style={{ background: C.error }}
            >
              מחיקת הזמנה
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
