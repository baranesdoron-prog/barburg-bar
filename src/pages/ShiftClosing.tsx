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
import type { AttendanceRecord, InventoryItem, JournalCategory, JournalEntry, Shift } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

const journalCategories = Object.keys(journalCategoryLabels) as JournalCategory[]

export function ShiftClosing() {
  const { id } = useParams()
  const { appUser, effectiveRole } = useAppUserContext()
  const [shift, setShift] = useState<Shift | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reportId, setReportId] = useState<string | null>(null)
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
        setShift(data as Shift)
      })
  }, [id])

  if (error) return <p className="text-destructive text-center text-sm">{error}</p>
  if (!shift) return null

  if (
    shift.shift_type !== 'closing' ||
    (shift.effective_status !== 'waiting_for_closure' && shift.effective_status !== 'reopened')
  ) {
    return <Navigate to={`/shifts/${id}`} replace />
  }

  if (reportId) {
    return <ClosingComplete shiftId={shift.id} />
  }

  const canClose =
    effectiveRole === 'administrator' ||
    (appUser.employee_id !== null && appUser.employee_id === shift.shift_manager_id)

  if (!canClose) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardHeader>
          <CardTitle>אין הרשאה לסגור משמרת זו</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            רק אחראי/ת המשמרת שמונה/תה למשמרת זו, או מנהל/ת בר, יכולים לסגור אותה.
          </p>
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
          <AttendanceStep shiftId={shift.id} onSaved={bumpRefresh} />
        </CardContent>
      </Card>

      <JournalSection shiftId={shift.id} onSaved={bumpRefresh} />
      <InventorySection shiftId={shift.id} onSaved={bumpRefresh} />
      <SummarySection shift={shift} refreshKey={refreshKey} onFinished={setReportId} />
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
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      const [itemsRes, countsRes] = await Promise.all([
        supabase.from('inventory_items').select('*').eq('active', true).order('name'),
        supabase.from('inventory_counts').select('*').eq('shift_id', shiftId),
      ])

      setItems((itemsRes.data as InventoryItem[]) ?? [])

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
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
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
  refreshKey,
  onFinished,
}: {
  shift: Shift
  refreshKey: number
  onFinished: (reportId: string) => void
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
      .eq('shift_id', shift.id)

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
  }, [shift.id, refreshKey])

  async function handleFinish() {
    if (!confirm('לסיים ולסגור את המשמרת?')) return

    setFinishing(true)
    setError(null)

    const { data, error: finishError } = await supabase.rpc('finish_shift_closing', {
      p_shift_id: shift.id,
    })

    setFinishing(false)

    if (finishError) {
      setError(finishError.message)
      return
    }

    onFinished(data.id)
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

function ClosingComplete({ shiftId }: { shiftId: string }) {
  return (
    <Card className="mx-auto max-w-md text-center">
      <CardHeader>
        <CardTitle>המשמרת הושלמה בהצלחה</CardTitle>
        <CardDescription>הדוח נוצר ונשמר.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {/* Reserved space for a future WhatsApp share action — not implemented yet. */}
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
