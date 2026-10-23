import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FileText, Printer, ChevronLeft } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { attendanceStatusLabels, shiftAssignmentRoleLabels } from '@/lib/shiftLabels'
import { journalCategoryLabels } from '@/lib/journalLabels'
import { purchaseOrderStatusLabels, purchaseOrderStatusBadgeClass } from '@/lib/purchaseOrderLabels'
import { cn, formatDateTime } from '@/lib/utils'
import { C } from '@/lib/designTokens'
import type { AttendanceStatus, PurchaseOrder, ShiftReportRow, Supplier } from '@/lib/types'

interface FlaggedOrder {
  order_number: string
  supplier_name: string
  status: string
}

const attendanceStatusColor: Record<AttendanceStatus, string> = {
  present: C.success,
  late: C.warning,
  absent: C.error,
}

function SectionLabel({ children, suffix }: { children: ReactNode; suffix?: ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-extrabold tracking-wide" style={{ color: C.textMuted }}>
      {children}
      {suffix && (
        <span className="font-medium normal-case" style={{ color: C.textMuted }}>
          {' '}
          · {suffix}
        </span>
      )}
    </p>
  )
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-center justify-between gap-2 py-[7px] text-sm last:border-0"
      style={{ borderBottom: `1px solid ${C.border}` }}
    >
      {children}
    </div>
  )
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
  const [historicalCorrections, setHistoricalCorrections] = useState<string[]>([])

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
    setHistoricalCorrections([])
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
    const allHistorical: string[] = []

    for (const c of changed) {
      const itemId = inventoryItemIds.get(c.item_name)
      if (!itemId) continue

      const { data, error: rpcError } = await supabase.rpc('correct_shift_inventory_count', {
        p_shift_id: id,
        p_inventory_item_id: itemId,
        p_new_quantity: Number(quantities[c.item_name]),
      })

      if (rpcError) {
        // This count has already been superseded by a newer one -- a
        // plain correction would roll live current_stock back to a
        // stale value, so it's refused server-side. Fall back to the
        // history-only correction instead, which fixes the recorded
        // number for reporting without touching live stock.
        if (rpcError.message.includes('more recent count already exists')) {
          const { error: historicalError } = await supabase.rpc('correct_historical_inventory_count', {
            p_shift_id: id,
            p_inventory_item_id: itemId,
            p_new_quantity: Number(quantities[c.item_name]),
          })
          if (historicalError) {
            setInventoryError(historicalError.message)
            setSavingInventory(false)
            return
          }
          allHistorical.push(c.item_name)
          continue
        }

        setInventoryError(rpcError.message)
        setSavingInventory(false)
        return
      }

      const flagged = (data as { flagged_orders?: FlaggedOrder[] } | null)?.flagged_orders ?? []
      allFlagged.push(...flagged)
    }

    await Promise.all([loadReport(), loadOrders()])

    setFlaggedOrders(allFlagged)
    setHistoricalCorrections(allHistorical)
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
    <div dir="rtl" className="min-h-svh pb-24 print:pb-0" style={{ background: C.appBg, color: C.text }}>
      <header
        className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3 print:hidden"
        style={{ background: C.card, borderColor: C.border }}
      >
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="ברבורג" className="size-9 shrink-0 rounded-full object-cover" />
          <span className="text-lg font-bold">ברבורג</span>
        </div>
        <Link to="/reports" className="flex items-center gap-1 text-sm font-semibold" style={{ color: C.textSecondary }}>
          <ChevronLeft className="size-4" />
          לדוחות
        </Link>
      </header>

      <div className="mx-auto flex max-w-xl flex-col gap-3.5 px-4 pt-5 print:px-0 print:pt-0">
        <div className="hidden items-center gap-3 print:flex">
          <img src="/logo.png" alt="ברבורג" className="size-16 rounded-full object-cover" />
          <div>
            <h1 className="text-2xl font-bold">ברבורג</h1>
            <p className="text-lg">דוח סגירת משמרת</p>
          </div>
        </div>

        {/* Summary hero */}
        <div
          className="flex items-center justify-between gap-2.5 rounded-2xl p-3.5 print:hidden"
          style={{ background: C.primaryLight }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex size-11 shrink-0 items-center justify-center rounded-xl"
              style={{ background: C.primary }}
            >
              <FileText className="size-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[17px] font-bold" style={{ color: C.primary }}>
                דוח סגירת משמרת
              </h1>
              <p className="truncate text-xs" style={{ color: C.primaryHover }}>
                {userNames.get(report.generated_by) ?? '—'} · {formatDateTime(report.generated_at)}
              </p>
              {report.updated_at && (
                <p className="truncate text-[11px]" style={{ color: C.primaryHover }}>
                  עודכן {formatDateTime(report.updated_at)} ע&quot;י {(report.updated_by && userNames.get(report.updated_by)) ?? '—'}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border"
            style={{ background: C.card, borderColor: C.border }}
            aria-label="הדפסה / ייצוא PDF"
          >
            <Printer className="size-4" style={{ color: C.primary }} />
          </button>
        </div>

        {/* One continuous document bracket, dense rows, label-only sections */}
        <div
          className="flex flex-col gap-4 rounded-3xl border p-4 print:rounded-none print:border-none print:p-0"
          style={{ background: C.subtleBg, borderColor: C.border }}
        >
          {relatedOrders.length > 0 && (
            <div className="print:hidden">
              <SectionLabel>הזמנות רכש מהמשמרת</SectionLabel>
              {relatedOrders.map((order) => (
                <Link key={order.id} to={`/purchase-orders/${order.id}`} className="block">
                  <Row>
                    <span>
                      {supplierNames.get(order.supplier_id) ?? '—'}
                      <span style={{ color: C.textMuted }}> · {order.order_number}</span>
                    </span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', purchaseOrderStatusBadgeClass[order.status])}>
                      {purchaseOrderStatusLabels[order.status]}
                    </span>
                  </Row>
                </Link>
              ))}
            </div>
          )}

          <div>
            <SectionLabel>נוכחות</SectionLabel>
            {snapshot.attendance.length === 0 && (
              <p className="text-sm" style={{ color: C.textMuted }}>
                אין נתוני נוכחות.
              </p>
            )}
            {snapshot.attendance.map((a, i) => (
              <Row key={i}>
                <span>
                  {a.employee_name}
                  <span style={{ color: C.textMuted }}> · {shiftAssignmentRoleLabels[a.role]}</span>
                </span>
                <span
                  className="font-semibold"
                  style={{ color: a.status ? attendanceStatusColor[a.status] : C.textMuted }}
                >
                  {a.status ? attendanceStatusLabels[a.status] : '—'}
                </span>
              </Row>
            ))}
          </div>

          <div>
            <SectionLabel>יומן משמרת</SectionLabel>
            {snapshot.journal_entries.length === 0 && (
              <p className="text-sm" style={{ color: C.textMuted }}>
                אין רשומות יומן.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              {snapshot.journal_entries.map((entry, i) => (
                <p key={i} className="text-sm">
                  <span className="font-bold">{journalCategoryLabels[entry.category]} — </span>
                  {entry.description}
                  {entry.requires_follow_up && (
                    <span className="font-bold" style={{ color: C.error }}>
                      {' '}
                      · דורש מעקב
                    </span>
                  )}
                </p>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-extrabold tracking-wide" style={{ color: C.textMuted }}>
                ספירת מלאי
              </p>
              {canEditInventory && !editingInventory && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="h-6 shrink-0 rounded-full border px-2.5 text-[11px] font-bold print:hidden"
                  style={{ background: C.card, borderColor: C.border, color: C.textSecondary }}
                >
                  עריכת ספירה
                </button>
              )}
            </div>

            {snapshot.inventory_counts.length === 0 && (
              <p className="text-sm" style={{ color: C.textMuted }}>
                אין נתוני מלאי.
              </p>
            )}

            {snapshot.inventory_counts.map((c, i) =>
              editingInventory ? (
                <Row key={i}>
                  <span>{c.item_name}</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={quantities[c.item_name] ?? ''}
                      disabled={!inventoryItemIds.has(c.item_name)}
                      onChange={(e) => setQuantities((prev) => ({ ...prev, [c.item_name]: e.target.value }))}
                      className="h-8 w-20 rounded-lg border px-2 text-sm outline-none disabled:opacity-50"
                      style={{ borderColor: C.border, background: C.card, color: C.text }}
                    />
                    <span style={{ color: C.textMuted }}>{c.unit}</span>
                  </div>
                </Row>
              ) : (
                <Row key={i}>
                  <span>{c.item_name}</span>
                  <span style={{ color: C.textMuted }}>
                    {c.quantity_counted} {c.unit}
                  </span>
                </Row>
              ),
            )}

            {editingInventory && (
              <div className="mt-2 flex flex-col gap-2 border-t pt-2 print:hidden" style={{ borderColor: C.border }}>
                {inventoryError && (
                  <p className="text-sm" style={{ color: C.error }}>
                    {inventoryError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={savingInventory}
                    onClick={handleSaveInventory}
                    className="h-9 flex-1 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: C.primary }}
                  >
                    שמירה
                  </button>
                  <button
                    type="button"
                    disabled={savingInventory}
                    onClick={() => setEditingInventory(false)}
                    className="h-9 flex-1 rounded-xl text-sm font-semibold disabled:opacity-50"
                    style={{ background: C.card, color: C.textSecondary, border: `1px solid ${C.border}` }}
                  >
                    ביטול
                  </button>
                </div>
              </div>
            )}

            {flaggedOrders.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 rounded-xl p-2.5 text-sm" style={{ background: C.warningBg }}>
                <p className="font-semibold" style={{ color: C.warning }}>
                  השינוי משפיע על הזמנות שכבר יצאו/התקבלו ולא עודכנו אוטומטית — יש לעדכן מול הספק ידנית:
                </p>
                {flaggedOrders.map((f, i) => (
                  <p key={i} style={{ color: C.warning }}>
                    {f.supplier_name} — {f.order_number} ({purchaseOrderStatusLabels[f.status as keyof typeof purchaseOrderStatusLabels]})
                  </p>
                ))}
              </div>
            )}

            {historicalCorrections.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 rounded-xl p-2.5 text-sm" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <p className="font-semibold">
                  ספירה זו כבר הוחלפה בספירה מאוחרת יותר — התיקון חל רק על הרישום ההיסטורי (כולל הדוח הבא שהשתמש בה
                  כ&quot;לפני המשמרת&quot;), ולא שינה את המלאי הנוכחי בפועל:
                </p>
                <p style={{ color: C.textMuted }}>{historicalCorrections.join(', ')}</p>
              </div>
            )}
          </div>

          {usageItems.length > 0 && (
            <div>
              <SectionLabel suffix="בהשוואה לספירה הקודמת">צריכה</SectionLabel>
              {usageItems.map((c, i) => {
                const delta = c.quantity_counted - c.previous_quantity!
                return (
                  <Row key={i}>
                    <span>{c.item_name}</span>
                    <span style={{ color: C.textMuted }}>
                      {c.previous_quantity} {c.unit ?? ''} ← {c.quantity_counted} {c.unit ?? ''} ({delta > 0 ? '+' : ''}
                      {delta})
                    </span>
                  </Row>
                )
              })}
            </div>
          )}
        </div>

        <Link
          to="/reports"
          className="self-center px-1 py-2 text-sm font-bold print:hidden"
          style={{ color: C.primary }}
        >
          חזרה לדוחות
        </Link>
      </div>
    </div>
  )
}
