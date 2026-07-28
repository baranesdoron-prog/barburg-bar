import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { purchaseOrderStatusLabels, purchaseOrderStatusBadgeClass } from '@/lib/purchaseOrderLabels'
import { cn, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { InventoryItem, PurchaseOrder, PurchaseOrderItem, Supplier } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

export function PurchaseOrderDetail() {
  const { id } = useParams()
  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [items, setItems] = useState<PurchaseOrderItem[]>([])
  const [catalog, setCatalog] = useState<InventoryItem[]>([])
  const [newItemId, setNewItemId] = useState('')
  const [newQuantity, setNewQuantity] = useState('')
  const [newUnitPrice, setNewUnitPrice] = useState('')
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

    const [supplierRes, itemsRes, catalogRes] = await Promise.all([
      supabase.from('suppliers').select('*').eq('id', loadedOrder.supplier_id).single(),
      supabase.from('purchase_order_items').select('*').eq('purchase_order_id', id),
      supabase.from('inventory_items').select('*').eq('active', true).order('name'),
    ])

    setSupplier(supplierRes.data as Supplier)
    setItems((itemsRes.data as PurchaseOrderItem[]) ?? [])
    setCatalog((catalogRes.data as InventoryItem[]) ?? [])
  }

  useEffect(() => {
    load()
  }, [id])

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
    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setNewItemId('')
    setNewQuantity('')
    setNewUnitPrice('')
    load()
  }

  async function handleRemoveItem(itemId: string) {
    await supabase.from('purchase_order_items').delete().eq('id', itemId)
    load()
  }

  async function handleSetStatus(status: 'ordered' | 'received' | 'cancelled') {
    if (status === 'cancelled' && !confirm('לבטל את ההזמנה?')) return

    const { error: updateError } = await supabase.from('purchase_orders').update({ status }).eq('id', id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    load()
  }

  if (error) return <p className="text-destructive text-center text-sm">{error}</p>
  if (!order || !supplier) return null

  const catalogNames = new Map(catalog.map((c) => [c.id, c]))
  const total = items.reduce((sum, item) => sum + item.quantity * (item.unit_price ?? 0), 0)
  const isDraft = order.status === 'draft'

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{supplier.name}</CardTitle>
            <span
              className={cn(
                'rounded-full px-2 py-1 text-xs font-medium',
                purchaseOrderStatusBadgeClass[order.status],
              )}
            >
              {purchaseOrderStatusLabels[order.status]}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {order.ordered_at && (
            <p>
              <span className="text-muted-foreground">הוזמן: </span>
              {formatDateTime(order.ordered_at)}
            </p>
          )}
          {order.received_at && (
            <p>
              <span className="text-muted-foreground">התקבל: </span>
              {formatDateTime(order.received_at)}
            </p>
          )}
          <p className="font-medium">סה"כ: ₪{total.toFixed(2)}</p>
        </CardContent>
        {order.status !== 'cancelled' && order.status !== 'received' && (
          <CardFooter className="flex gap-2">
            {order.status === 'draft' && (
              <Button className="flex-1" onClick={() => handleSetStatus('ordered')}>
                סימון כהוזמן
              </Button>
            )}
            {order.status === 'ordered' && (
              <Button className="flex-1" onClick={() => handleSetStatus('received')}>
                סימון כהתקבל
              </Button>
            )}
            <Button variant="destructive" className="flex-1" onClick={() => handleSetStatus('cancelled')}>
              ביטול הזמנה
            </Button>
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">פריטים</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {items.length === 0 && <p className="text-muted-foreground text-sm">אין פריטים עדיין.</p>}
          {items.map((item) => {
            const catalogItem = catalogNames.get(item.inventory_item_id)
            return (
              <div key={item.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span>
                  {catalogItem?.name ?? '—'} — {item.quantity}
                  {catalogItem?.unit && ` ${catalogItem.unit}`}
                  {item.unit_price !== null && ` × ₪${item.unit_price}`}
                </span>
                {isDraft && (
                  <Button variant="ghost" size="sm" onClick={() => handleRemoveItem(item.id)}>
                    הסרה
                  </Button>
                )}
              </div>
            )
          })}

          {isDraft && (
            <div className="flex flex-col gap-2 border-t pt-3">
              <select
                className={selectClass}
                value={newItemId}
                onChange={(e) => setNewItemId(e.target.value)}
              >
                <option value="">בחר/י פריט</option>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                placeholder="כמות"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
              />
              <Input
                type="number"
                placeholder="מחיר ליחידה (לא חובה)"
                value={newUnitPrice}
                onChange={(e) => setNewUnitPrice(e.target.value)}
              />
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button disabled={submitting} onClick={handleAddItem}>
                הוספת פריט
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button asChild variant="ghost">
          <Link to="/purchase-orders">חזרה לרשימת ההזמנות</Link>
        </Button>
      </div>
    </div>
  )
}
