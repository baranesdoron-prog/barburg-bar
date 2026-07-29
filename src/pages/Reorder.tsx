import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { InventoryItemWithStock, Supplier } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

export function Reorder() {
  const [items, setItems] = useState<InventoryItemWithStock[] | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  useEffect(() => {
    async function load() {
      const [itemsRes, suppliersRes] = await Promise.all([
        supabase.from('inventory_items_with_latest_count').select('*').eq('active', true).order('name'),
        supabase.from('suppliers').select('*').order('name'),
      ])
      setItems((itemsRes.data as InventoryItemWithStock[]) ?? [])
      setSuppliers((suppliersRes.data as Supplier[]) ?? [])
    }

    load()
  }, [])

  if (items === null) return null

  const lowStockItems = items.filter((i) => i.is_low_stock)
  const supplierIds = [
    ...new Set(lowStockItems.map((i) => i.supplier_id).filter((id): id is string => id !== null)),
  ]
  const unassigned = lowStockItems.filter((i) => i.supplier_id === null)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">השלמת מלאי</h1>

      {lowStockItems.length === 0 && (
        <p className="text-muted-foreground text-sm">אין כרגע מוצרים מתחת לכמות המינימום.</p>
      )}

      {supplierIds.map((supplierId) => {
        const supplier = suppliers.find((s) => s.id === supplierId)
        if (!supplier) return null
        return (
          <SupplierGroup
            key={supplierId}
            supplier={supplier}
            lowStockItems={lowStockItems.filter((i) => i.supplier_id === supplierId)}
            allSupplierItems={items.filter((i) => i.supplier_id === supplierId)}
          />
        )
      })}

      {unassigned.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ללא ספק משויך</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">
              יש להקצות ספק למוצרים אלו (בעמוד "פריטי מלאי") כדי שניתן יהיה להזמין אותם.
            </p>
            {unassigned.map((item) => (
              <p key={item.id} className="text-sm">
                {item.name} — {item.latest_counted_quantity} מתוך מינימום {item.minimum_quantity}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
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
      const shortfall =
        item.minimum_quantity !== null && item.latest_counted_quantity !== null
          ? Math.max(1, Math.ceil(item.minimum_quantity - item.latest_counted_quantity))
          : 1
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
    setLines((prev) => ({ ...prev, [addItemId]: '1' }))
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

  if (createdOrderId) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 pt-6 text-sm">
          <p>ההזמנה ל{supplier.name} נוצרה בהצלחה.</p>
          <Button asChild variant="outline">
            <Link to={`/purchase-orders/${createdOrderId}`}>פתיחת ההזמנה</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{supplier.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {includedIds.map((itemId) => {
          const item = itemsById.get(itemId)
          if (!item) return null
          const isLow = lowStockIds.has(itemId)

          return (
            <div key={itemId} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <div className="flex-1">
                <p className="font-medium">{item.name}</p>
                {isLow && (
                  <p className="text-destructive text-xs">
                    מלאי נוכחי: {item.latest_counted_quantity ?? 0} מתוך מינימום {item.minimum_quantity}
                  </p>
                )}
              </div>
              <Input
                type="number"
                min={1}
                className="w-20"
                value={lines[itemId]}
                onChange={(e) => setLines((prev) => ({ ...prev, [itemId]: e.target.value }))}
              />
              <Button variant="ghost" size="sm" onClick={() => handleRemove(itemId)}>
                הסרה
              </Button>
            </div>
          )
        })}

        {availableToAdd.length > 0 && (
          <div className="flex gap-2 border-t pt-3">
            <select
              className={selectClass}
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
            <Button variant="outline" onClick={handleAdd}>
              הוספה
            </Button>
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={submitting || includedIds.length === 0} onClick={handleCreate}>
          יצירת הזמנת רכש
        </Button>
      </CardFooter>
    </Card>
  )
}
