import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Check, RotateCcw, WifiOff, X } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { AttendanceStep } from '@/components/AttendanceStep'
import { journalCategoryLabels } from '@/lib/journalLabels'
import { shiftTypeLabel } from '@/lib/shiftLabels'
import { cn, formatDateTime } from '@/lib/utils'
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
  // Added with migration 106; absent if the database hasn't been updated.
  skipped_names?: string[]
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
        // Filtered to 'published' so a stale cancelled duplicate for the
        // same (week, type) -- see the dedup fix elsewhere -- never makes
        // this .maybeSingle() see two rows and silently come back empty,
        // which was dropping the real opening shift's roster entirely.
        supabase
          .from('shifts')
          .select('id')
          .eq('week_start', loadedShift.week_start)
          .eq('shift_type', 'opening')
          .eq('status', 'published')
          .maybeSingle()
          .then(({ data: opening }) => setOpeningShiftId((opening as { id: string } | null)?.id ?? null))
      })
  }, [id])

  const attendanceShiftIds = [openingShiftId, shift?.id].filter((v): v is string => !!v)

  if (error) return <p className="text-destructive text-center text-sm">{error}</p>
  if (!shift) return null

  // Open for prep (attendance, journal, inventory counts) once the closing
  // shift has actually started, not only once it's already over -- lets
  // staff record things as the night happens. Since migration 113 the shift
  // can also be finished before its scheduled end time (the bar may close
  // early).
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
          <JournalEntryRow
            key={entry.id}
            entry={entry}
            onChanged={() => {
              load()
              onSaved()
            }}
          />
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

function JournalEntryRow({ entry, onChanged }: { entry: JournalEntry; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [category, setCategory] = useState(entry.category)
  const [description, setDescription] = useState(entry.description)
  const [quantity, setQuantity] = useState(entry.quantity !== null ? String(entry.quantity) : '')
  const [requiresFollowUp, setRequiresFollowUp] = useState(entry.requires_follow_up)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setError(null)

    if (!description.trim()) {
      setError('יש להזין תיאור')
      return
    }

    setSaving(true)
    const { error: updateError } = await supabase
      .from('journal_entries')
      .update({
        category,
        description: description.trim(),
        quantity: quantity ? Number(quantity) : null,
        requires_follow_up: requiresFollowUp,
      })
      .eq('id', entry.id)
    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setEditing(false)
    onChanged()
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-md border p-2 text-sm">
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
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Input type="number" placeholder="כמות (לא חובה)" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={requiresFollowUp} onChange={(e) => setRequiresFollowUp(e.target.checked)} />
          דורש מעקב
        </label>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" className="flex-1" disabled={saving} onClick={handleSave}>
            שמירה
          </Button>
          <Button type="button" variant="ghost" className="flex-1" onClick={() => setEditing(false)}>
            ביטול
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border p-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{journalCategoryLabels[entry.category]}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
          עריכה
        </Button>
      </div>
      <p>{entry.description}</p>
      {entry.quantity !== null && <p className="text-muted-foreground">כמות: {entry.quantity}</p>}
      {entry.requires_follow_up && <p className="text-destructive">דורש מעקב</p>}
    </div>
  )
}

// Counts typed but not yet confirmed by the server, kept on the phone so a
// lock screen, a reload or a dropped connection never loses them. '' means
// "clear this count".
function pendingKey(shiftId: string) {
  return `shift-closing:${shiftId}:pending-counts`
}

function readPending(shiftId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(pendingKey(shiftId))
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function writePending(shiftId: string, pending: Record<string, string>) {
  try {
    if (Object.keys(pending).length === 0) localStorage.removeItem(pendingKey(shiftId))
    else localStorage.setItem(pendingKey(shiftId), JSON.stringify(pending))
  } catch {
    // Storage unavailable (private mode): the server save still happens.
  }
}

function isValidCount(value: string) {
  const n = Number(value)
  return value.trim() !== '' && Number.isFinite(n) && n >= 0
}

type RowState = 'saving' | 'saved' | 'waiting' | 'invalid'
type CountFilter = 'all' | 'todo' | 'done'

const AUTOSAVE_DELAY_MS = 600

function InventorySection({ shiftId, onSaved }: { shiftId: string; onSaved: () => void }) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  const [waitingCount, setWaitingCount] = useState(0)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [resumeCount, setResumeCount] = useState(0)
  const [filter, setFilter] = useState<CountFilter>('all')
  const [, setTick] = useState(0)

  const pendingRef = useRef<Record<string, string>>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushingRef = useRef(false)
  const mountedRef = useRef(true)
  const excludedRef = useRef<Set<string>>(new Set())
  excludedRef.current = excludedIds

  const [newItemName, setNewItemName] = useState('')
  const [newItemQuantity, setNewItemQuantity] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  async function load() {
    const [itemsRes, countsRes, categoriesRes, exclusionsRes] = await Promise.all([
      supabase.from('inventory_items').select('*').eq('active', true).order('name'),
      supabase.from('inventory_counts').select('*').eq('shift_id', shiftId),
      supabase.from('product_categories').select('*').order('sort_order'),
      supabase.from('shift_inventory_exclusions').select('inventory_item_id').eq('shift_id', shiftId),
    ])

    setItems((itemsRes.data as InventoryItem[]) ?? [])
    setCategories((categoriesRes.data as ProductCategory[]) ?? [])
    const excluded = new Set(
      ((exclusionsRes.data as { inventory_item_id: string }[]) ?? []).map((r) => r.inventory_item_id),
    )
    setExcludedIds(excluded)

    const initial: Record<string, string> = {}
    const states: Record<string, RowState> = {}
    for (const count of countsRes.data ?? []) {
      initial[count.inventory_item_id] = String(count.quantity_counted)
      states[count.inventory_item_id] = 'saved'
    }
    // Anything typed on this phone that never reached the server wins over
    // the server copy, then goes up right away.
    const pending = { ...readPending(shiftId), ...pendingRef.current }
    pendingRef.current = pending
    for (const [itemId, value] of Object.entries(pending)) {
      initial[itemId] = value
      states[itemId] = 'saving'
    }
    setQuantities(initial)
    setRowState(states)
    setLoaded(true)
    return { initial, excluded, hadPending: Object.keys(pending).length > 0 }
  }

  async function flush() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (flushingRef.current) return
    const batch = { ...pendingRef.current }
    const entries = Object.entries(batch).filter(([, value]) => value === '' || isValidCount(value))
    if (entries.length === 0) return
    flushingRef.current = true

    const upserts = entries
      .filter(([itemId, value]) => value !== '' && !excludedRef.current.has(itemId))
      .map(([itemId, value]) => ({ shift_id: shiftId, inventory_item_id: itemId, quantity_counted: Number(value) }))
    const clears = entries.filter(([, value]) => value === '').map(([itemId]) => itemId)

    setRowState((prev) => {
      const next = { ...prev }
      for (const [itemId] of entries) next[itemId] = 'saving'
      return next
    })

    const results = await Promise.all([
      upserts.length
        ? supabase.from('inventory_counts').upsert(upserts, { onConflict: 'shift_id,inventory_item_id' })
        : Promise.resolve({ error: null }),
      clears.length
        ? supabase.from('inventory_counts').delete().eq('shift_id', shiftId).in('inventory_item_id', clears)
        : Promise.resolve({ error: null }),
    ])
    flushingRef.current = false
    const failed = results.find((r) => r.error)

    if (failed) {
      // Most likely no connection: keep everything on the phone and retry.
      setRowState((prev) => {
        const next = { ...prev }
        for (const [itemId] of entries) next[itemId] = 'waiting'
        return next
      })
      setWaitingCount(Object.keys(pendingRef.current).length)
      if (navigator.onLine) setError(failed.error?.message ?? 'השמירה נכשלה')
      if (mountedRef.current) timerRef.current = setTimeout(flush, 15_000)
      return
    }

    setError(null)
    // Only drop what was saved; a value edited meanwhile stays pending.
    const remaining = { ...pendingRef.current }
    for (const [itemId, value] of entries) {
      if (remaining[itemId] === value) delete remaining[itemId]
    }
    pendingRef.current = remaining
    writePending(shiftId, remaining)
    setWaitingCount(0)
    setRowState((prev) => {
      const next = { ...prev }
      for (const [itemId, value] of entries) {
        if (remaining[itemId] !== undefined) continue
        if (value === '') delete next[itemId]
        else next[itemId] = 'saved'
      }
      return next
    })
    setLastSavedAt(new Date())
    onSaved()
    if (Object.keys(remaining).length > 0 && mountedRef.current) scheduleFlush()
  }

  function scheduleFlush() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS)
  }

  function handleChange(itemId: string, value: string) {
    setQuantities((prev) => ({ ...prev, [itemId]: value }))
    setResumeCount(0)
    if (value.trim() !== '' && !isValidCount(value)) {
      setRowState((prev) => ({ ...prev, [itemId]: 'invalid' }))
      return
    }
    pendingRef.current = { ...pendingRef.current, [itemId]: value.trim() }
    writePending(shiftId, pendingRef.current)
    setRowState((prev) => ({ ...prev, [itemId]: 'saving' }))
    scheduleFlush()
  }

  async function handleExclude(itemId: string) {
    setExcludedIds((prev) => new Set(prev).add(itemId))
    const { error: excludeError } = await supabase
      .from('shift_inventory_exclusions')
      .insert({ shift_id: shiftId, inventory_item_id: itemId })
    if (excludeError) {
      setError(excludeError.message)
      await load()
      return
    }
    onSaved()
  }

  async function handleIncludeBack(itemId: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
    const { error: includeError } = await supabase
      .from('shift_inventory_exclusions')
      .delete()
      .eq('shift_id', shiftId)
      .eq('inventory_item_id', itemId)
    if (includeError) {
      setError(includeError.message)
      await load()
      return
    }
    onSaved()
  }

  useEffect(() => {
    let cancelled = false
    mountedRef.current = true
    load().then(({ initial, excluded, hadPending }) => {
      if (cancelled) return
      const already = Object.entries(initial).filter(([itemId, v]) => v !== '' && !excluded.has(itemId)).length
      setResumeCount(already)
      if (hadPending) flush()
    })

    // Phone locked or app switched: send what's waiting right now. Back
    // online or back on screen: retry anything still waiting.
    const onVisibility = () => {
      if (Object.keys(pendingRef.current).length > 0) flush()
    }
    window.addEventListener('online', onVisibility)
    window.addEventListener('pagehide', onVisibility)
    document.addEventListener('visibilitychange', onVisibility)
    const clock = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => {
      cancelled = true
      window.removeEventListener('online', onVisibility)
      window.removeEventListener('pagehide', onVisibility)
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(clock)
      if (timerRef.current) clearTimeout(timerRef.current)
      mountedRef.current = false
      // Leaving the page: send what's waiting (it also stays on the phone).
      if (Object.keys(pendingRef.current).length > 0) flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId])

  // Quick-add for a product that isn't in the catalog yet -- just name and
  // quantity, no category/supplier/pricing. It's created active with no
  // category, which is exactly what flags it on the admin/bar-manager
  // dashboard's "products missing classification" KPI, so someone goes and
  // fills in the rest of the details later.
  async function handleAddItem(e: FormEvent) {
    e.preventDefault()
    const name = newItemName.trim()
    if (!name) return

    setAddError(null)
    setAdding(true)

    const { data: newItem, error: insertError } = await supabase
      .from('inventory_items')
      .insert({ name })
      .select()
      .single()

    if (insertError || !newItem) {
      setAddError(insertError?.message ?? 'שגיאה בהוספת המוצר')
      setAdding(false)
      return
    }

    const quantity = newItemQuantity.trim()
    if (quantity !== '') {
      const { error: countError } = await supabase
        .from('inventory_counts')
        .upsert(
          { shift_id: shiftId, inventory_item_id: newItem.id, quantity_counted: Number(quantity) },
          { onConflict: 'shift_id,inventory_item_id' },
        )
      if (countError) {
        setAddError(countError.message)
        setAdding(false)
        return
      }
    }

    setNewItemName('')
    setNewItemQuantity('')
    setAdding(false)
    await load()
    onSaved()
  }

  async function handleFinish() {
    await flush()
    document.getElementById('closing-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const categorySortOrder = new Map(categories.map((c) => [c.id, c.sort_order]))
  function sortByCategory(list: InventoryItem[]) {
    return list
      .map((item) => ({ item, categoryName: categories.find((c) => c.id === item.category_id)?.name }))
      .sort((a, b) => {
        const orderA = a.item.category_id ? (categorySortOrder.get(a.item.category_id) ?? Infinity) : Infinity
        const orderB = b.item.category_id ? (categorySortOrder.get(b.item.category_id) ?? Infinity) : Infinity
        if (orderA !== orderB) return orderA - orderB
        const displayA = a.item.display_order ?? Infinity
        const displayB = b.item.display_order ?? Infinity
        if (displayA !== displayB) return displayA - displayB
        return a.item.name.localeCompare(b.item.name)
      })
  }

  const isCounted = (itemId: string) => (quantities[itemId] ?? '').trim() !== ''
  const sortedItems = sortByCategory(items.filter((i) => !excludedIds.has(i.id)))
  const excludedItems = sortByCategory(items.filter((i) => excludedIds.has(i.id)))
  const countedTotal = sortedItems.filter(({ item }) => isCounted(item.id)).length
  const shownItems = sortedItems.filter(({ item }) =>
    filter === 'todo' ? !isCounted(item.id) : filter === 'done' ? isCounted(item.id) : true,
  )
  const nextItem = sortedItems.find(({ item }) => !isCounted(item.id))?.item
  const anySaving = Object.values(rowState).some((s) => s === 'saving')

  function jumpToNext() {
    if (!nextItem) return
    const input = document.getElementById(`count-${nextItem.id}`) as HTMLInputElement | null
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    input?.focus({ preventScroll: true })
    setResumeCount(0)
  }

  function savedAgo() {
    if (!lastSavedAt) return null
    const seconds = Math.round((Date.now() - lastSavedAt.getTime()) / 1000)
    if (seconds < 45) return 'לפני רגע'
    const minutes = Math.round(seconds / 60)
    return minutes === 1 ? 'לפני דקה' : `לפני ${minutes} דקות`
  }

  const filterChip = (value: CountFilter, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setFilter(value)}
      className={cn(
        'h-8 rounded-full border px-3 text-xs font-semibold',
        filter === value ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
      )}
    >
      {label}
    </button>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">שלב 3: ספירת מלאי</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {items.length === 0 && loaded && (
          <p className="text-muted-foreground text-sm">
            אין פריטי מלאי מוגדרים. ניתן להוסיף בעמוד "פריטי מלאי".
          </p>
        )}

        {resumeCount > 0 && nextItem && (
          <div className="flex flex-col gap-2 rounded-xl bg-[#174D3B] p-3 text-white">
            <div className="flex items-center gap-2 font-bold">
              <RotateCcw className="size-4 text-[#E9A23B]" />
              ממשיכים מאיפה שעצרת
            </div>
            <p className="text-sm text-white/85">
              {resumeCount} פריטים כבר נספרו ונשמרו. נשארו {sortedItems.length - countedTotal}.
            </p>
            <button
              type="button"
              onClick={jumpToNext}
              className="h-11 rounded-lg bg-[#E9A23B] text-sm font-bold text-[#2B1A02]"
            >
              לפריט הבא: {nextItem.name}
            </button>
          </div>
        )}

        {sortedItems.length > 0 && (
          <div
            className={cn(
              'sticky top-0 z-10 flex items-center gap-2 rounded-xl px-3 py-2 text-sm',
              waitingCount > 0 ? 'bg-[#FBEBD2] text-[#7A4A0A]' : 'bg-[#E3EFE9] text-[#174D3B]',
            )}
          >
            {waitingCount > 0 ? <WifiOff className="size-4 shrink-0" /> : <Check className="size-4 shrink-0" />}
            <div className="flex flex-col">
              <span className="font-bold">
                {waitingCount > 0
                  ? 'שמור בטלפון · ממתין לחיבור'
                  : anySaving
                    ? 'שומר…'
                    : lastSavedAt
                      ? `נשמר אוטומטית · ${savedAgo()}`
                      : 'כל מספר נשמר אוטומטית'}
              </span>
              <span className="text-xs">
                {waitingCount > 0
                  ? `${waitingCount} פריטים יישלחו כשהחיבור יחזור`
                  : `${countedTotal} מתוך ${sortedItems.length} פריטים נספרו`}
              </span>
            </div>
          </div>
        )}

        {sortedItems.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {filterChip('all', `הכל · ${sortedItems.length}`)}
            {filterChip('todo', `טרם נספרו · ${sortedItems.length - countedTotal}`)}
            {filterChip('done', `נספרו · ${countedTotal}`)}
          </div>
        )}

        {shownItems.map(({ item, categoryName }, index) => {
          const state = rowState[item.id]
          return (
            <div key={item.id}>
              {categoryName !== shownItems[index - 1]?.categoryName && (
                <p className="text-muted-foreground mt-2 text-xs font-semibold first:mt-0">
                  {categoryName ?? 'ללא קטגוריה'}
                </p>
              )}
              <div className={cn('flex items-center gap-2 rounded-md', item.id === nextItem?.id && resumeCount > 0 && 'bg-[#FFF7EA]')}>
                <label htmlFor={`count-${item.id}`} className="flex-1 text-sm">
                  {item.name}
                  {item.unit && <span className="text-muted-foreground"> ({item.unit})</span>}
                </label>
                <Input
                  id={`count-${item.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  className={cn('w-24', state === 'invalid' && 'border-destructive')}
                  value={quantities[item.id] ?? ''}
                  onChange={(e) => handleChange(item.id, e.target.value)}
                  onBlur={() => {
                    if (pendingRef.current[item.id] !== undefined) flush()
                  }}
                />
                <span className="w-12 shrink-0 text-[11px]">
                  {state === 'saved' && (
                    <span className="flex items-center gap-0.5 text-[#174D3B]">
                      <Check className="size-3" />
                      נשמר
                    </span>
                  )}
                  {state === 'saving' && <span className="text-muted-foreground">שומר…</span>}
                  {state === 'waiting' && <span className="text-[#7A4A0A]">בטלפון</span>}
                  {state === 'invalid' && <span className="text-destructive">לא תקין</span>}
                </span>
                <button
                  type="button"
                  title="הסרת הפריט מספירת המלאי של משמרת זו"
                  aria-label={`הסרת ${item.name} מספירת המלאי`}
                  onClick={() => handleExclude(item.id)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          )
        })}
        {filter !== 'all' && shownItems.length === 0 && (
          <p className="text-muted-foreground text-sm">{filter === 'todo' ? 'הכל נספר.' : 'עוד לא נספר שום פריט.'}</p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {sortedItems.length > 0 && (
          <Button onClick={handleFinish} className="mt-1">
            סיום ספירה והמשך
          </Button>
        )}

        {excludedItems.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 border-t pt-3">
            <p className="text-muted-foreground text-xs font-semibold">
              פריטים שהוסרו מספירת המלאי של משמרת זו
            </p>
            {excludedItems.map(({ item }) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground flex-1 line-through">{item.name}</span>
                <button
                  type="button"
                  onClick={() => handleIncludeBack(item.id)}
                  className="text-primary text-xs underline-offset-2 hover:underline"
                >
                  החזרה לספירה
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAddItem} className="mt-2 flex flex-col gap-2 border-t pt-3">
          <p className="text-muted-foreground text-xs font-semibold">מוצר שלא ברשימה?</p>
          <div className="flex items-center gap-2">
            <Input
              placeholder="שם המוצר"
              className="flex-1"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
            />
            <Input
              type="number"
              placeholder="כמות"
              className="w-24"
              value={newItemQuantity}
              onChange={(e) => setNewItemQuantity(e.target.value)}
            />
          </div>
          {addError && <p className="text-destructive text-sm">{addError}</p>}
          <Button type="submit" variant="outline" disabled={adding || !newItemName.trim()}>
            הוספת מוצר
          </Button>
        </form>
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
  const [excludedCount, setExcludedCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)

  async function load() {
    const { data: assignments } = await supabase
      .from('shift_assignments')
      .select('id')
      .in('shift_id', attendanceShiftIds)

    const assignmentIds = (assignments as { id: string }[] | null)?.map((a) => a.id) ?? []

    const [attendanceRes, journalRes, inventoryRes, activeItemsRes, exclusionsRes] = await Promise.all([
      assignmentIds.length > 0
        ? supabase.from('attendance_records').select('*').in('shift_assignment_id', assignmentIds)
        : Promise.resolve({ data: [] as AttendanceRecord[] }),
      supabase.from('journal_entries').select('requires_follow_up').eq('shift_id', shift.id),
      supabase.from('inventory_counts').select('id').eq('shift_id', shift.id),
      supabase.from('inventory_items').select('id').eq('active', true),
      supabase.from('shift_inventory_exclusions').select('inventory_item_id').eq('shift_id', shift.id),
    ])

    setAttendanceCount((attendanceRes.data as AttendanceRecord[]).length)
    const journalRows = (journalRes.data as { requires_follow_up: boolean }[]) ?? []
    setJournalCount(journalRows.length)
    setFollowUpCount(journalRows.filter((r) => r.requires_follow_up).length)
    setInventoryCount((inventoryRes.data as { id: string }[] | null)?.length ?? 0)
    setActiveItemCount((activeItemsRes.data as { id: string }[] | null)?.length ?? 0)
    setExcludedCount((exclusionsRes.data as { inventory_item_id: string }[] | null)?.length ?? 0)
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

    const { data: reorderData } = await supabase.rpc('generate_reorder_purchase_orders', { p_shift_id: shift.id })

    setFinishing(false)
    onFinished(data.id, (reorderData as ReorderSummary | null) ?? null)
  }

  const requiredInventoryCount = Math.max(activeItemCount - excludedCount, 0)
  const missingJournal = journalCount === 0
  const missingInventory = requiredInventoryCount > 0 && inventoryCount < requiredInventoryCount
  const canFinish = !missingJournal && !missingInventory

  return (
    <Card id="closing-summary">
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
          פריטי מלאי שנספרו: {inventoryCount} מתוך {requiredInventoryCount}
          {excludedCount > 0 && ` (${excludedCount} הוסרו מהספירה)`}
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
          <div className="text-amber-600 dark:text-amber-400">
            <p>
              {reorderSummary.skipped_no_supplier} פריטים מתחת למינימום לא הוזמנו כי אין להם ספק (גם לא בקטגוריה):
            </p>
            {reorderSummary.skipped_names && reorderSummary.skipped_names.length > 0 && (
              <p className="font-medium">{reorderSummary.skipped_names.join(', ')}</p>
            )}
            <Link to="/inventory/items" className="underline underline-offset-2">
              הוספת ספק בעמוד המוצרים
            </Link>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button asChild className="w-full">
          <Link to={`/shifts/${shiftId}/report`}>פתיחת הדוח</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link to="/dashboard">חזרה ללוח הבקרה</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
