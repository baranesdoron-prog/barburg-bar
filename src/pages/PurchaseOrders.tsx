import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { purchaseOrderStatusLabels, purchaseOrderStatusBadgeClass } from '@/lib/purchaseOrderLabels'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PurchaseOrder, PurchaseOrderItem, Supplier } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

export function PurchaseOrders() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [totals, setTotals] = useState<Record<string, number>>({})
  const [newSupplierId, setNewSupplierId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    async function load() {
      const [ordersRes, suppliersRes, itemsRes] = await Promise.all([
        supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('purchase_order_items').select('*'),
      ])

      setOrders((ordersRes.data as PurchaseOrder[]) ?? [])
      setSuppliers((suppliersRes.data as Supplier[]) ?? [])

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
    const { data, error: insertError } = await supabase
      .from('purchase_orders')
      .insert({ supplier_id: newSupplierId })
      .select('id')
      .single()
    setCreating(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    navigate(`/purchase-orders/${data.id}`)
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">הזמנות רכש</h1>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          {orders.length === 0 && <p className="text-muted-foreground text-sm">אין הזמנות רכש עדיין.</p>}
          {orders.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => navigate(`/purchase-orders/${order.id}`)}
              className="hover:bg-accent flex items-center justify-between rounded-md border p-2 text-start text-sm transition-colors"
            >
              <div>
                <p className="font-medium">{supplierNames.get(order.supplier_id) ?? '—'}</p>
                <p className="text-muted-foreground text-xs">{order.order_number}</p>
                <p className="text-muted-foreground">₪{(totals[order.id] ?? 0).toFixed(2)}</p>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-1 text-xs font-medium',
                  purchaseOrderStatusBadgeClass[order.status],
                )}
              >
                {purchaseOrderStatusLabels[order.status]}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">הזמנה חדשה</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <select
            className={selectClass}
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
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button disabled={!newSupplierId || creating} onClick={handleCreate}>
            יצירת הזמנה
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
