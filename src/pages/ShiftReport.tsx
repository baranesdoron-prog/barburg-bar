import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { attendanceStatusLabels, shiftAssignmentRoleLabels } from '@/lib/shiftLabels'
import { journalCategoryLabels } from '@/lib/journalLabels'
import { purchaseOrderStatusLabels, purchaseOrderStatusBadgeClass } from '@/lib/purchaseOrderLabels'
import { cn, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { PurchaseOrder, ShiftReportRow, Supplier } from '@/lib/types'

interface FlaggedOrder {
  order_number: string
  supplier_name: string
  status: string
}

export function ShiftReport() {
  const { id } = useParams()
  const { effectiveRole } = useAppUserContext()
  const [report, setReport] = useState<ShiftReportRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [relatedOrders, setRelatedOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [inventoryItemIds, setInventoryItemIds] = useState<Map<string, string>>(new Map())
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map())

  const [editingInventory, setEditingInventory] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [savingInventory, setSavingInventory] = useState(false)
  const [inventoryError, setInventoryError] = useState<string | null>(null)
  const [flaggedOrders, setFlaggedOrders] = useState<FlaggedOrder[]>([])

  // Bar manager/admin only -- matches ShiftClosing.tsx's own canClose gate.
  const canEditInventory = effectiveRole === 'administrator' || effectiveRole === 'shift_manager'

  async function loadReport() {
    const { data, error: fetchError } = await supabase
      .from('shift_reports')
      .select('*')
      .eq('shift_id', id)
      .single()

    if (fetchError || !data) {
      setError(fetchError?.message ?? 'הדוח לא נמצא')
      return
    }
    setReport(data as ShiftReportRow)
  }

  async function loadOrders() {
    const [ordersRes, suppliersRes] = await Promise.all([
      supabase.from('purchase_orders').select('*').eq('created_from_shift_id', id),
      supabase.from('suppliers').select('*'),
    ])
    setRelatedOrders((ordersRes.data as PurchaseOrder[]) ?? [])
    setSuppliers((suppliersRes.data as Supplier[]) ?? [])
  }

  useEffect(() => {
    loadReport()
    loadOrders()
    // shift_reports.generated_by/updated_by are app_users ids -- RLS
    // only lets a non-admin read their own app_users row, so resolving
    // anyone else's name needs this RPC rather than a plain select.
    supabase
      .rpc('list_app_user_names')
      .then(({ data }) => {
        setUserNames(new Map(((data as { id: string; full_name: string }[]) ?? []).map((u) => [u.id, u.full_name])))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!canEditInventory) return
    supabase
      .from('inventory_items')
      .select('id, name')
      .then(({ data }) => {
        setInventoryItemIds(new Map(((data as { id: string; name: string }[]) ?? []).map((i) => [i.name, i.id])))
      })
  }, [canEditInventory])

  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]))

  if (error) return <p className="text-destructive text-center text-sm">{error}</p>
  if (!report) return null

  function handleStartEdit() {
    const initial: Record<string, string> = {}
    for (const c of report!.snapshot.inventory_counts) {
      initial[c.item_name] = String(c.quantity_counted)
    }
    setQuantities(initial)
    setFlaggedOrders([])
    setInventoryError(null)
    setEditingInventory(true)
  }

  async function handleSaveInventory() {
    setSavingInventory(true)
    setInventoryError(null)

    const changed = report!.snapshot.inventory_counts.filter((c) => {
      const edited = quantities[c.item_name]
      return edited !== undefined && edited.trim() !== '' && Number(edited) !== c.quantity_counted
    })

    const allFlagged: FlaggedOrder[] = []

    for (const c of changed) {
      const itemId = inventoryItemIds.get(c.item_name)
      if (!itemId) continue

      const { data, error: rpcError } = await supabase.rpc('correct_shift_inventory_count', {
        p_shift_id: id,
        p_inventory_item_id: itemId,
        p_new_quantity: Number(quantities[c.item_name]),
      })

      if (rpcError) {
        setInventoryError(rpcError.message)
        setSavingInventory(false)
        return
      }

      const flagged = (data as { flagged_orders?: FlaggedOrder[] } | null)?.flagged_orders ?? []
      allFlagged.push(...flagged)
    }

    await Promise.all([loadReport(), loadOrders()])

    setFlaggedOrders(allFlagged)
    setSavingInventory(false)
    setEditingInventory(false)
  }

  const { snapshot } = report

  // Older reports (closed before this comparison existed) simply have no
  // previous_quantity on their frozen snapshot -- treated as "no data",
  // not zero, same as an item counted for the first time ever.
  const usageItems = snapshot.inventory_counts.filter(
    (c) => c.previous_quantity !== null && c.previous_quantity !== undefined && c.used_quantity !== null,
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
          <CardTitle>דוח סגירת משמרת</CardTitle>
          <CardDescription>
            בוצע ע&quot;י {userNames.get(report.generated_by) ?? '—'} בתאריך {formatDateTime(report.generated_at)}
          </CardDescription>
        </CardHeader>
        {report.updated_at && (
          <CardContent className="text-muted-foreground text-sm">
            <p>
              עודכן לאחרונה בתאריך {formatDateTime(report.updated_at)} על ידי{' '}
              {(report.updated_by && userNames.get(report.updated_by)) ?? '—'}
            </p>
          </CardContent>
        )}
      </Card>

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
              <span>
                {a.employee_name}
                <span className="text-muted-foreground"> · {shiftAssignmentRoleLabels[a.role]}</span>
              </span>
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
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">ספירת מלאי</CardTitle>
          {canEditInventory && !editingInventory && (
            <Button variant="outline" size="sm" className="print:hidden" onClick={handleStartEdit}>
              עריכת ספירה
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {snapshot.inventory_counts.length === 0 && (
            <p className="text-muted-foreground text-sm">אין נתוני מלאי.</p>
          )}
          {snapshot.inventory_counts.map((c, i) =>
            editingInventory ? (
              <div key={i} className="flex items-center justify-between gap-2 text-sm">
                <span>{c.item_name}</span>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    className="h-8 w-20"
                    value={quantities[c.item_name] ?? ''}
                    disabled={!inventoryItemIds.has(c.item_name)}
                    onChange={(e) =>
                      setQuantities((prev) => ({ ...prev, [c.item_name]: e.target.value }))
                    }
                  />
                  <span className="text-muted-foreground">{c.unit}</span>
                </div>
              </div>
            ) : (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{c.item_name}</span>
                <span className="text-muted-foreground">
                  {c.quantity_counted} {c.unit}
                </span>
              </div>
            ),
          )}

          {editingInventory && (
            <div className="mt-2 flex flex-col gap-2 border-t pt-2 print:hidden">
              {inventoryError && <p className="text-destructive text-sm">{inventoryError}</p>}
              <div className="flex gap-2">
                <Button className="flex-1" disabled={savingInventory} onClick={handleSaveInventory}>
                  שמירה
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1"
                  disabled={savingInventory}
                  onClick={() => setEditingInventory(false)}
                >
                  ביטול
                </Button>
              </div>
            </div>
          )}

          {flaggedOrders.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-800 dark:bg-amber-950">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                השינוי משפיע על הזמנות שכבר יצאו/התקבלו ולא עודכנו אוטומטית — יש לעדכן מול הספק ידנית:
              </p>
              {flaggedOrders.map((f, i) => (
                <p key={i} className="text-amber-800 dark:text-amber-300">
                  {f.supplier_name} — {f.order_number} ({purchaseOrderStatusLabels[f.status as keyof typeof purchaseOrderStatusLabels]})
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {usageItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">צריכה</CardTitle>
            <CardDescription>בהשוואה לספירה הקודמת</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {usageItems.map((c, i) => {
              const delta = c.quantity_counted - c.previous_quantity!
              return (
                <div key={i} className="flex flex-col gap-0.5 border-b pb-2 text-sm last:border-0 last:pb-0">
                  <span>{c.item_name}</span>
                  <span className="text-muted-foreground text-xs">
                    לפני המשמרת {c.previous_quantity} {c.unit ?? ''} · אחרי המשמרת {c.quantity_counted} {c.unit ?? ''} ·
                    הפרש {delta > 0 ? '+' : ''}
                    {delta} {c.unit ?? ''}
                  </span>
                </div>
              )
            })}
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
