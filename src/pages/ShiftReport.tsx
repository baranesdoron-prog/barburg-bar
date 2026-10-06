import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { attendanceStatusLabels, shiftTypeLabel } from '@/lib/shiftLabels'
import { journalCategoryLabels } from '@/lib/journalLabels'
import { purchaseOrderStatusLabels, purchaseOrderStatusBadgeClass } from '@/lib/purchaseOrderLabels'
import { cn, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { PurchaseOrder, ShiftReportRow, Supplier } from '@/lib/types'

export function ShiftReport() {
  const { id } = useParams()
  const [report, setReport] = useState<ShiftReportRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [relatedOrders, setRelatedOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  useEffect(() => {
    supabase
      .from('shift_reports')
      .select('*')
      .eq('shift_id', id)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError || !data) {
          setError(fetchError?.message ?? 'הדוח לא נמצא')
          return
        }
        setReport(data as ShiftReportRow)
      })
  }, [id])

  useEffect(() => {
    async function load() {
      const [ordersRes, suppliersRes] = await Promise.all([
        supabase.from('purchase_orders').select('*').eq('created_from_shift_id', id),
        supabase.from('suppliers').select('*'),
      ])
      setRelatedOrders((ordersRes.data as PurchaseOrder[]) ?? [])
      setSuppliers((suppliersRes.data as Supplier[]) ?? [])
    }

    load()
  }, [id])

  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]))

  if (error) return <p className="text-destructive text-center text-sm">{error}</p>
  if (!report) return null

  const { snapshot } = report

  // Older reports (closed before this comparison existed) simply have no
  // previous_quantity on their frozen snapshot -- treated as "no data",
  // not zero, same as an item counted for the first time ever.
  const usageItems = snapshot.inventory_counts.filter(
    (c) => c.previous_quantity !== null && c.previous_quantity !== undefined && c.used_quantity !== null,
  )
  const totalCost = usageItems.reduce(
    (sum, c) => sum + (c.cost !== null && c.used_quantity! > 0 ? c.cost : 0),
    0,
  )

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="hidden items-center gap-3 print:flex">
        <img src="/logo.png" alt="ברבורג" className="size-16 rounded-full object-cover" />
        <div>
          <h1 className="text-2xl font-bold">ברבורג</h1>
          <p className="text-lg">דוח סגירת משמרת</p>
        </div>
      </div>

      <div className="flex justify-end print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          הדפסה / ייצוא PDF
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>דוח סגירת משמרת — {shiftTypeLabel(snapshot.shift.shift_type)}</CardTitle>
          <CardDescription>
            {formatDateTime(snapshot.shift.start_time)} – {formatDateTime(snapshot.shift.end_time)}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <p>נוצר: {formatDateTime(report.generated_at)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">נוכחות</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {snapshot.attendance.length === 0 && (
            <p className="text-muted-foreground text-sm">אין נתוני נוכחות.</p>
          )}
          {snapshot.attendance.map((a, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span>{a.employee_name}</span>
              <span className="text-muted-foreground">
                {a.status ? attendanceStatusLabels[a.status] : '—'}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">יומן משמרת</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {snapshot.journal_entries.length === 0 && (
            <p className="text-muted-foreground text-sm">אין רשומות יומן.</p>
          )}
          {snapshot.journal_entries.map((entry, i) => (
            <div key={i} className="rounded-md border p-2 text-sm">
              <p className="font-medium">{journalCategoryLabels[entry.category]}</p>
              <p>{entry.description}</p>
              {entry.requires_follow_up && <p className="text-destructive">דורש מעקב</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ספירת מלאי</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {snapshot.inventory_counts.length === 0 && (
            <p className="text-muted-foreground text-sm">אין נתוני מלאי.</p>
          )}
          {snapshot.inventory_counts.map((c, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span>{c.item_name}</span>
              <span className="text-muted-foreground">
                {c.quantity_counted} {c.unit}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {usageItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">צריכה ועלות</CardTitle>
            <CardDescription>בהשוואה לספירה הקודמת</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {usageItems.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{c.item_name}</span>
                <span className="text-muted-foreground">
                  {c.used_quantity! > 0
                    ? `נצרכו ${c.used_quantity} ${c.unit ?? ''}`
                    : c.used_quantity! < 0
                      ? `נוספו ${Math.abs(c.used_quantity!)} ${c.unit ?? ''}`
                      : 'ללא שינוי'}
                  {c.cost !== null && c.used_quantity! > 0 && ` · ₪${c.cost.toFixed(2)}`}
                </span>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-medium">
              <span>סה&quot;כ עלות צריכה משוערת</span>
              <span>₪{totalCost.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {relatedOrders.length > 0 && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">הזמנות רכש שנוצרו בעקבות משמרת זו</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {relatedOrders.map((order) => (
              <Link
                key={order.id}
                to={`/purchase-orders/${order.id}`}
                className="hover:bg-accent flex items-center justify-between rounded-md border p-2 text-sm transition-colors"
              >
                <div>
                  <p className="font-medium">{supplierNames.get(order.supplier_id) ?? '—'}</p>
                  <p className="text-muted-foreground text-xs">{order.order_number}</p>
                </div>
                <span
                  className={cn(
                    'rounded-full px-2 py-1 text-xs font-medium',
                    purchaseOrderStatusBadgeClass[order.status],
                  )}
                >
                  {purchaseOrderStatusLabels[order.status]}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-center print:hidden">
        <Button asChild variant="ghost">
          <Link to={`/shifts/${id}`}>חזרה למשמרת</Link>
        </Button>
      </div>
    </div>
  )
}
