import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Minus, Plus, Pencil } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { C } from '@/lib/designTokens'
import { useAppUserContext } from '@/lib/outletContext'
import { ROLES_MANAGING_SHIFTS } from '@/lib/roleLabels'
import { SHEKELS_PER_TOKEN, formatDate, tokensLabel } from '@/lib/punchcards'

interface MenuCategory {
  id: string
  name: string
  default_tokens: number | null
  staff_notes: string | null
  sort_order: number
}

interface MenuItem {
  id: string
  category_id: string
  name: string
  description: string | null
  staff_notes: string | null
  tokens: number
  sort_order: number
  one_shift: boolean
  expired_at: string | null
  created_at: string
}

const fieldClass = 'rounded-xl border px-3 text-base outline-none focus-visible:ring-2'

// Staff view of the bar menu: what customers see plus the serving and
// preparation notes. Administrators and bar managers can add items, mark
// one-shift items as expired and bring expired items back.
export function BarMenu() {
  const { effectiveRole } = useAppUserContext()
  const canManage = ROLES_MANAGING_SHIFTS.includes(effectiveRole)
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[] | null>(null)
  const [tab, setTab] = useState<'menu' | 'expired'>('menu')
  const [editing, setEditing] = useState<MenuItem | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [catRes, itemRes] = await Promise.all([
      supabase.from('menu_categories').select('*').order('sort_order'),
      supabase.from('menu_items').select('*').order('sort_order').order('name'),
    ])
    if (catRes.error || itemRes.error) setError((catRes.error ?? itemRes.error)!.message)
    setCategories((catRes.data as MenuCategory[]) ?? [])
    setItems((itemRes.data as MenuItem[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function update(id: string, patch: Partial<MenuItem>) {
    setError(null)
    const { error: updateError } = await supabase.from('menu_items').update(patch).eq('id', id)
    if (updateError) setError(updateError.message)
    load()
  }

  if (items === null) return null

  const active = items.filter((i) => !i.expired_at)
  const expired = items.filter((i) => i.expired_at).sort((a, b) => (b.expired_at ?? '').localeCompare(a.expired_at ?? ''))

  if (editing) {
    return (
      <ItemForm
        item={editing === 'new' ? null : editing}
        categories={categories}
        onDone={() => {
          setEditing(null)
          load()
        }}
      />
    )
  }

  return (
    <div dir="rtl" className="mx-auto flex max-w-md flex-col gap-3 pb-24" style={{ color: C.text }}>
      <h1 className="text-2xl font-extrabold">תפריט הבר</h1>
      <p className="text-sm" style={{ color: C.textSecondary }}>
        תצוגת צוות: כולל הוראות הגשה והכנה (בירוק). לקוחות רואים רק את שם המשקה, מה יש בו ומספר הניקובים.
      </p>

      {canManage && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="h-11 flex-1 rounded-xl text-sm font-bold text-white"
            style={{ background: C.primary }}
          >
            הוספת פריט
          </button>
          <button
            type="button"
            onClick={() => setTab(tab === 'menu' ? 'expired' : 'menu')}
            className="h-11 flex-1 rounded-xl border text-sm font-semibold"
            style={{ borderColor: C.border, background: C.card }}
          >
            {tab === 'menu' ? `פג תוקף · ${expired.length}` : 'חזרה לתפריט'}
          </button>
        </div>
      )}

      {error && <p style={{ color: C.error }}>{error}</p>}

      {tab === 'expired' ? (
        <>
          <p className="text-sm" style={{ color: C.textSecondary }}>
            פריטים שהוצאו מהתפריט. אפשר להחזיר פריט למשמרת אחת נוספת, או להפוך אותו לחלק קבוע מהתפריט.
          </p>
          {expired.length === 0 && <p className="text-sm">אין פריטים שפג תוקפם.</p>}
          {expired.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: C.border, background: C.card }}>
              <ItemBody item={item} category={categories.find((c) => c.id === item.category_id)} />
              <span className="text-xs" style={{ color: C.textSecondary }}>
                פג ב־{formatDate(item.expired_at!)}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => update(item.id, { expired_at: null, one_shift: true })}
                  className="h-11 flex-1 rounded-lg border text-sm font-bold"
                  style={{ borderColor: C.primary, color: C.primary, background: C.card }}
                >
                  להחזיר למשמרת אחת
                </button>
                <button
                  type="button"
                  onClick={() => update(item.id, { expired_at: null, one_shift: false })}
                  className="h-11 flex-1 rounded-lg text-sm font-bold text-white"
                  style={{ background: C.primary }}
                >
                  לתפריט הקבוע
                </button>
              </div>
            </div>
          ))}
        </>
      ) : (
        categories.map((cat) => {
          const catItems = active.filter((i) => i.category_id === cat.id)
          if (catItems.length === 0) return null
          return (
            <div key={cat.id} className="mt-1 flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-extrabold">{cat.name}</h2>
                {cat.default_tokens !== null && (
                  <span className="text-sm font-extrabold" style={{ color: '#7A5230' }}>
                    {tokensLabel(cat.default_tokens)}
                  </span>
                )}
              </div>
              {cat.staff_notes && (
                <div className="rounded-lg px-3 py-2 text-sm" style={{ background: C.primaryLight, color: C.primary }}>
                  <b>הגשה:</b> {cat.staff_notes}
                </div>
              )}
              {catItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-2 rounded-xl border p-3"
                  style={{ borderColor: item.one_shift ? C.accent : C.border, background: C.card }}
                >
                  <ItemBody item={item} category={cat} />
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-dashed pt-2" style={{ borderColor: C.border }}>
                      {item.one_shift && (
                        <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: C.warningBg, color: '#7A4A0A' }}>
                          רק למשמרת אחת
                        </span>
                      )}
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => setEditing(item)}
                        className="flex h-9 items-center gap-1 rounded-lg border px-3 text-xs font-bold"
                        style={{ borderColor: C.border }}
                      >
                        <Pencil className="size-3.5" />
                        עריכה
                      </button>
                      <button
                        type="button"
                        onClick={() => update(item.id, { expired_at: new Date().toISOString() })}
                        className="h-9 rounded-lg border px-3 text-xs font-bold"
                        style={{ borderColor: C.border }}
                      >
                        סימון כפג תוקף
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        })
      )}
    </div>
  )
}

function ItemBody({ item, category }: { item: MenuItem; category: MenuCategory | undefined }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-bold">{item.name}</span>
        <span className="text-sm font-bold whitespace-nowrap" style={{ color: '#7A5230' }}>
          {category?.default_tokens === item.tokens ? '' : tokensLabel(item.tokens)}
        </span>
      </div>
      {item.description && (
        <span className="text-sm" style={{ color: C.textSecondary }}>
          {item.description}
        </span>
      )}
      {item.staff_notes && (
        <div className="rounded-md px-2 py-1.5 text-sm" style={{ background: C.primaryLight, color: C.primary }}>
          <b>הכנה:</b> {item.staff_notes}
        </div>
      )}
    </div>
  )
}

function ItemForm({ item, categories, onDone }: { item: MenuItem | null; categories: MenuCategory[]; onDone: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [categoryId, setCategoryId] = useState(item?.category_id ?? categories[0]?.id ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [staffNotes, setStaffNotes] = useState(item?.staff_notes ?? '')
  const [tokens, setTokens] = useState(item?.tokens ?? categories.find((c) => c.id === categoryId)?.default_tokens ?? 4)
  const [oneShift, setOneShift] = useState(item?.one_shift ?? true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('יש להזין שם לפריט')
      return
    }
    setSaving(true)
    const payload = {
      name: name.trim(),
      category_id: categoryId,
      description: description.trim() || null,
      staff_notes: staffNotes.trim() || null,
      tokens,
      one_shift: oneShift,
    }
    const { error: saveError } = item
      ? await supabase.from('menu_items').update(payload).eq('id', item.id)
      : await supabase.from('menu_items').insert({ ...payload, sort_order: 99 })
    setSaving(false)
    if (saveError) setError(saveError.message)
    else onDone()
  }

  return (
    <form onSubmit={submit} dir="rtl" className="mx-auto flex max-w-md flex-col gap-4 pb-24" style={{ color: C.text }}>
      <h1 className="text-2xl font-extrabold">{item ? 'עריכת פריט' : 'פריט חדש בתפריט'}</h1>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="menu-name" className="text-sm font-bold">
          שם הפריט
        </label>
        <input id="menu-name" value={name} onChange={(e) => setName(e.target.value)} className={`${fieldClass} h-12`} style={{ borderColor: C.border, background: C.card }} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="menu-category" className="text-sm font-bold">
          קטגוריה
        </label>
        <select
          id="menu-category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={`${fieldClass} h-12`}
          style={{ borderColor: C.border, background: C.card }}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="menu-description" className="text-sm font-bold">
          מה יש בפנים (הלקוח/ה רואה)
        </label>
        <textarea
          id="menu-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${fieldClass} min-h-20 py-2`}
          style={{ borderColor: C.border, background: C.card }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="menu-staff" className="text-sm font-bold">
          הוראות הכנה (רק לצוות)
        </label>
        <textarea
          id="menu-staff"
          value={staffNotes}
          onChange={(e) => setStaffNotes(e.target.value)}
          className={`${fieldClass} min-h-20 py-2`}
          style={{ borderColor: '#9CC7B0', background: C.primaryLight }}
        />
        <span className="text-xs" style={{ color: C.textSecondary }}>
          לקוחות לא רואים את השדה הזה. אפשר להשאיר ריק כשההגשה היא כמו של הקטגוריה.
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">מחיר בניקובים</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="פחות"
            onClick={() => setTokens((t) => Math.max(1, t - 1))}
            className="flex size-12 items-center justify-center rounded-xl border"
            style={{ borderColor: C.border, background: C.card }}
          >
            <Minus className="size-4" />
          </button>
          <span className="w-10 text-center text-2xl font-extrabold">{tokens}</span>
          <button
            type="button"
            aria-label="עוד"
            onClick={() => setTokens((t) => Math.min(100, t + 1))}
            className="flex size-12 items-center justify-center rounded-xl text-white"
            style={{ background: C.primary }}
          >
            <Plus className="size-4" />
          </button>
          <span style={{ color: C.textSecondary }}>= {tokens * SHEKELS_PER_TOKEN} ₪</span>
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-xl border p-3.5" style={{ borderColor: C.accent, background: C.accentLight }}>
        <input type="checkbox" checked={oneShift} onChange={(e) => setOneShift(e.target.checked)} className="mt-1 size-5" />
        <span className="flex flex-col gap-1">
          <span className="font-bold">רק למשמרת אחת</span>
          <span className="text-sm" style={{ color: C.textSecondary }}>
            בסוף הערב צריך לסמן אותו כ"פג תוקף". אחר כך אפשר להחזיר אותו מרשימת "פג תוקף".
          </span>
        </span>
      </label>

      {error && <p style={{ color: C.error }}>{error}</p>}

      <button type="submit" disabled={saving} className="h-13 rounded-xl text-base font-bold text-white disabled:opacity-50" style={{ background: C.primary }}>
        {item ? 'שמירה' : 'הוספה לתפריט'}
      </button>
      <button type="button" onClick={onDone} className="h-12 rounded-xl border text-base font-semibold" style={{ borderColor: C.border }}>
        ביטול
      </button>
    </form>
  )
}
