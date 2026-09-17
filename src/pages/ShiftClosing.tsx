import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { AttendanceStep } from '@/components/AttendanceStep'
import { journalCategoryLabels } from '@/lib/journalLabels'
import { shiftTypeLabel } from '@/lib/shiftLabels'
import { formatDateTime } from '@/lib/utils'
import { useAppUserContext } from '@/lib/outletContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { AttendanceRecord, InventoryItem, JournalCategory, JournalEntry, ProductCategory, Shift } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

const journalCategories = Object.keys(journalCategoryLabels) as JournalCategory[]

interface ReorderSummary {
  orders: { supplier_name: string; order_number: string; item_count: number }[]
  skipped_no_supplier: number
}

export function ShiftClosing() {
  const { id } = useParams()
  const { effectiveRole } = useAppUserContext()
  const [shift, setShift] = useState<Shift | null>(null)
  const [openingShiftId, setOpeningShiftId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reportId, setReportId] = useState<string | null>(null)
  const [reorderSummary, setReorderSummary] = useState<ReorderSummary | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpRefresh = () => setRefreshKey((k) => k + 1)

  useEffect(() => {
    supabase
      .from('shifts_with_effective_status')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError || !data) {
          setError(fetchError?.message ?? 'משמרת לא נמצאה')
          return
        }
        const loadedShift = data as Shift
        setShift(loadedShift)

        // Attendance covers the whole night's roster, not just whoever was
        // assigned to the closing shift specifically -- someone who only
        // worked the opening slot still needs their attendance recorded
        // somewhere, and this is the only closing workflow there is.
        supabase
          .from('shifts')
          .select('id')
          .eq('week_start', loadedShift.week_start)
          .eq('shift_type', 'opening')
          .maybeSingle()
          .then(({ data: opening }) => setOpeningShiftId((opening as { id: string } | null)?.id ?? null))
      })
  }, [id])

  const attendanceShiftIds = [openingShiftId, shift?.id].filter((v): v is string => !!v)

  if (error) return <p className="text-destructive text-center text-sm">{error}</p>
  if (!shift) return null

  // Open for prep (attendance, journal, inventory counts) once the closing
  // shift has actually started, not only once it's already over -- lets
  // staff record things as the night happens. finish_shift_closing() still
  // refuses to actually complete the shift before its scheduled end time.
  if (
    shift.shift_type !== 'closing' ||
    !['active', 'waiting_for_closure', 'reopened'].includes(shift.effective_status)
  ) {
    return <Navigate to={`/shifts/${id}`} replace />
  }

  if (reportId) {
    return <ClosingComplete shiftId={shift.id} reorderSummary={reorderSummary} />
  }

  // Any bar manager can close a shift, not just whoever was assigned to it
  // -- matches ROLES_MANAGING_SHIFTS everywhere else in the shifts area.
  const canClose = effectiveRole === 'administrator' || effectiveRole === 'shift_manager'

  if (!canClose) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardHeader>
          <CardTitle>אין הרשאה לסגור משמרת זו</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">רק מנהל/ת בר או מנהל/ת מערכת יכולים לסגור משמרת.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">סגירת משמרת — {shiftTypeLabel(shift.shift_type)}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">שלב 1: נוכחות</CardTitle>
        </CardHeader>
        <CardContent>
          <AttendanceStep shiftIds={attendanceShiftIds} onSaved={bumpRefresh} />
        </CardContent>
      </Card>

      <JournalSection shiftId={shift.id} onSaved={bumpRefresh} />
      <InventorySection shiftId={shift.id} onSaved={bumpRefresh} />
      <SummarySection
        shift={shift}
        attendanceShiftIds={attendanceShiftIds}
        refreshKey={refreshKey}
        onFinished={(id, summary) => {
          setReorderSummary(summary)
          setReportId(id)
        }}
      />
    </div>
  )
}

function JournalSection({ shiftId, onSaved }: { shiftId: string; onSaved: () => void }) {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [category, setCategory] = useState<JournalCategory>('general_note')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('')
  const [requiresFollowUp, setRequiresFollowUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false })
    setEntries((data as JournalEntry[]) ?? [])
  }

  useEffect(() => {
    load()
  }, [shiftId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!description.trim()) {
      setError('יש להזין תיאור')
      return
    }

    setSubmitting(true)
    const { error: insertError } = await supabase.from('journal_entries').insert({
      shift_id: shiftId,
      category,
      description: description.trim(),
      quantity: quantity ? Number(quantity) : null,
      requires_follow_up: requiresFollowUp,
    })
    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setDescription('')
    setQuantity('')
    setRequiresFollowUp(false)
    load()
    onSaved()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">שלב 2: יומן משמרת</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {entries.length === 0 && <p className="text-muted-foreground text-sm">אין רשומות יומן עדיין.</p>}
        {entries.map((entry) => (
          <div key={entry.id} className="rounded-md border p-2 text-sm">
            <p className="font-medium">{journalCategoryLabels[entry.category]}</p>
            <p>{entry.description}</p>
            {entry.quantity !== null && <p className="text-muted-foreground">כמות: {entry.quantity}</p>}
            {entry.requires_follow_up && <p className="text-destructive">דורש מעקב</p>}
          </div>
        ))}

        <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t pt-3">
          <select
            className={selectClass}
            value={category}
            onChange={(e) => setCategory(e.target.value as JournalCategory)}
          >
            {journalCategories.map((cat) => (
              <option key={cat} value={cat}>
                {journalCategoryLabels[cat]}
              </option>
            ))}
          </select>
          <textarea
            className={selectClass + ' min-h-16'}
            placeholder="תיאור"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Input
            type="number"
            placeholder="כמות (לא חובה)"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requiresFollowUp}
              onChange={(e) => setRequiresFollowUp(e.target.checked)}
            />
            דורש מעקב
          </label>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" disabled={submitting}>
            הוספת רשומה
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function InventorySection({ shiftId, onSaved }: { shiftId: string; onSaved: () => void }) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      const [itemsRes, countsRes, categoriesRes] = await Promise.all([
        supabase.from('inventory_items').select('*').eq('active', true).order('name'),
        supabase.from('inventory_counts').select('*').eq('shift_id', shiftId),
        supabase.from('product_categories').select('*').order('sort_order'),
      ])

      setItems((itemsRes.data as InventoryItem[]) ?? [])
      setCategories((categoriesRes.data as ProductCategory[]) ?? [])

      const initial: Record<string, string> = {}
      for (const count of countsRes.data ?? []) {
        initial[count.inventory_item_id] = String(count.quantity_counted)
      }
      setQuantities(initial)
    }

    load()
  }, [shiftId])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)

    const payload = Object.entries(quantities)
      .filter(([, value]) => value.trim() !== '')
      .map(([itemId, value]) => ({
        shift_id: shiftId,
        inventory_item_id: itemId,
        quantity_counted: Number(value),
      }))

    const { error: saveError } = await supabase
      .from('inventory_counts')
      .upsert(payload, { onConflict: 'shift_id,inventory_item_id' })

    setSaving(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    setSaved(true)
    onSaved()
  }

  const categorySortOrder = new Map(categories.map((c) => [c.id, c.sort_order]))
  const sortedItems = items
    .map((item) => ({ item, categoryName: categories.find((c) => c.id === item.category_id)?.name }))
    .sort((a, b) => {
      const orderA = a.item.category_id ? (categorySortOrder.get(a.item.category_id) ?? Infinity) : Infinity
      const orderB = b.item.category_id ? (categorySortOrder.get(b.item.category_id) ?? Infinity) : Infinity
      if (orderA !== orderB) return orderA - orderB
      return a.item.name.localeCompare(b.item.name)
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">שלב 3: ספירת מלאי</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {items.length === 0 && (
          <p className="text-muted-foreground text-sm">
            אין פריטי מלאי מוגדרים. ניתן להוסיף בעמוד "פריטי מלאי".
          </p>
        )}
        {sortedItems.map(({ item, categoryName }, index) => (
          <div key={item.id}>
            {categoryName !== sortedItems[index - 1]?.categoryName && (
              <p className="text-muted-foreground mt-2 text-xs font-semibold first:mt-0">
                {categoryName ?? 'ללא קטגוריה'}
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm">
                {item.name}
                {item.unit && <span className="text-muted-foreground"> ({item.unit})</span>}
              </span>
              <Input
                type="number"
                className="w-24"
                value={quantities[item.id] ?? ''}
                onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
              />
            </div>
          </div>
        ))}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {saved && <p className="text-sm text-green-600">ספירת המלאי נשמרה בהצלחה.</p>}
        {items.length > 0 && (
          <Button disabled={saving} onClick={handleSave}>
            שמירת ספירה
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function SummarySection({
  shift,
  attendanceShiftIds,
  refreshKey,
  onFinished,
}: {
  shift: Shift
  attendanceShiftIds: string[]
  refreshKey: number
  onFinished: (reportId: string, reorderSummary: ReorderSummary | null) => void
}) {
  const [attendanceCount, setAttendanceCount] = useState(0)
  const [journalCount, setJournalCount] = useState(0)
  const [followUpCount, setFollowUpCount] = useState(0)
  const [inventoryCount, setInventoryCount] = useState(0)
  const [activeItemCount, setActiveItemCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)

  async function load() {
    const { data: assignments } = await supabase
      .from('shift_assignments')
      .select('id')
      .in('shift_id', attendanceShiftIds)

    const assignmentIds = (assignments as { id: string }[] | null)?.map((a) => a.id) ?? []

    const [attendanceRes, journalRes, inventoryRes, activeItemsRes] = await Promise.all([
      assignmentIds.length > 0
        ? supabase.from('attendance_records').select('*').in('shift_assignment_id', assignmentIds)
        : Promise.resolve({ data: [] as AttendanceRecord[] }),
      supabase.from('journal_entries').select('requires_follow_up').eq('shift_id', shift.id),
      supabase.from('inventory_counts').select('id').eq('shift_id', shift.id),
      supabase.from('inventory_items').select('id').eq('active', true),
    ])

    setAttendanceCount((attendanceRes.data as AttendanceRecord[]).length)
    const journalRows = (journalRes.data as { requires_follow_up: boolean }[]) ?? []
    setJournalCount(journalRows.length)
    setFollowUpCount(journalRows.filter((r) => r.requires_follow_up).length)
    setInventoryCount((inventoryRes.data as { id: string }[] | null)?.length ?? 0)
    setActiveItemCount((activeItemsRes.data as { id: string }[] | null)?.length ?? 0)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift.id, attendanceShiftIds.join(','), refreshKey])

  async function handleFinish() {
    if (!confirm('לסיים ולסגור את המשמרת?')) return

    setFinishing(true)
    setError(null)

    const { data, error: finishError } = await supabase.rpc('finish_shift_closing', {
      p_shift_id: shift.id,
    })

    if (finishError) {
      setFinishing(false)
      setError(
        finishError.message.includes('before its scheduled end time')
          ? 'אי אפשר לסיים לסגור את המשמרת לפני שעת הסיום המתוכננת שלה'
          : finishError.message,
      )
      return
    }

    const { data: reorderData } = await supabase.rpc('generate_reorder_purchase_orders')

    setFinishing(false)
    onFinished(data.id, (reorderData as ReorderSummary | null) ?? null)
  }

  const missingJournal = journalCount === 0
  const missingInventory = activeItemCount > 0 && inventoryCount < activeItemCount
  const canFinish = !missingJournal && !missingInventory

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">שלב 4: סיכום</CardTitle>
        <CardDescription>
          {formatDateTime(shift.start_time)} – {formatDateTime(shift.end_time)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        <p>רשומות נוכחות: {attendanceCount}</p>
        <p>
          רשומות יומן: {journalCount} (מתוכן {followUpCount} דורשות מעקב)
        </p>
        <p>
          פריטי מלאי שנספרו: {inventoryCount} מתוך {activeItemCount}
        </p>
        {missingJournal && (
          <p className="text-destructive">יש להוסיף לפחות רשומת יומן אחת (מה עבד טוב, מה השתבש וכו') לפני הסיום.</p>
        )}
        {missingInventory && <p className="text-destructive">יש להשלים ספירה של כל פריטי המלאי הפעילים לפני הסיום.</p>}
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={finishing || !canFinish} onClick={handleFinish}>
          סיום משמרת
        </Button>
      </CardFooter>
    </Card>
  )
}

function ClosingComplete({
  shiftId,
  reorderSummary,
}: {
  shiftId: string
  reorderSummary: ReorderSummary | null
}) {
  return (
    <Card className="mx-auto max-w-md text-center">
      <CardHeader>
        <CardTitle>המשמרת הושלמה בהצלחה</CardTitle>
        <CardDescription>הדוח נוצר ונשמר.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {reorderSummary && reorderSummary.orders.length > 0 && (
          <div className="rounded-md border p-3 text-start">
            <p className="mb-1 font-medium">נוצרו {reorderSummary.orders.length} הזמנות רכש חדשות:</p>
            <ul className="text-muted-foreground list-inside list-disc">
              {reorderSummary.orders.map((o) => (
                <li key={o.order_number}>
                  {o.supplier_name} ({o.order_number}) — {o.item_count} פריטים
                </li>
              ))}
            </ul>
          </div>
        )}
        {reorderSummary && reorderSummary.skipped_no_supplier > 0 && (
          <p className="text-amber-600 dark:text-amber-400">
            {reorderSummary.skipped_no_supplier} פריטים דורשים הזמנה אך אין להם ספק משויך — לא הוזמנו אוטומטית.
          </p>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button asChild className="w-full">
          <Link to={`/shifts/${shiftId}/report`}>פתיחת הדוח</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link to="/">חזרה ללוח הבקרה</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
