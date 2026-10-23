import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus, Tags } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { C, CATEGORY_COLORS } from '@/lib/designTokens'
import { BottomNav } from '@/components/BottomNav'
import type { ProductCategory, Supplier } from '@/lib/types'

const fieldClass = 'h-10 w-full min-w-0 rounded-xl border px-3 text-sm outline-none'
const fieldStyle = { borderColor: C.border, background: C.card, color: C.text }

function friendlyCategoryError(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'כבר קיימת קטגוריה בשם זה'
  return error.message
}

export function Categories() {
  const [categories, setCategories] = useState<ProductCategory[] | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [itemCounts, setItemCounts] = useState<Map<string, number>>(new Map())
  const [newName, setNewName] = useState('')
  const [newSupplierId, setNewSupplierId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const [categoriesRes, suppliersRes, itemsRes] = await Promise.all([
      supabase.from('product_categories').select('*').order('sort_order'),
      supabase.from('suppliers').select('*').eq('active', true).order('name'),
      supabase.from('inventory_items').select('category_id').eq('active', true),
    ])
    const counts = new Map<string, number>()
    for (const row of (itemsRes.data as { category_id: string | null }[]) ?? []) {
      if (row.category_id) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1)
    }
    setItemCounts(counts)
    setCategories((categoriesRes.data as ProductCategory[]) ?? [])
    setSuppliers((suppliersRes.data as Supplier[]) ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const name = newName.trim()
    if (!name) {
      setError('יש להזין שם קטגוריה')
      return
    }

    setSubmitting(true)
    const nextSortOrder = categories && categories.length > 0 ? Math.max(...categories.map((c) => c.sort_order)) + 1 : 1
    const { error: insertError } = await supabase
      .from('product_categories')
      .insert({ name, sort_order: nextSortOrder, default_supplier_id: newSupplierId || null })
    setSubmitting(false)

    if (insertError) {
      setError(friendlyCategoryError(insertError))
      return
    }

    setNewName('')
    setNewSupplierId('')
    load()
  }

  if (categories === null) return null

  return (
    <div dir="rtl" className="min-h-svh pb-24" style={{ background: C.appBg, color: C.text }}>
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.primaryLight }}>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ background: C.primary }}>
            <Tags className="size-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: C.primary }}>
            קטגוריות מוצרים
          </h1>
        </div>

        {categories.length === 0 ? (
          <p className="text-center" style={{ color: C.textMuted }}>
            אין קטגוריות עדיין.
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-3xl border p-3.5" style={{ background: C.subtleBg, borderColor: C.border }}>
            {categories.map((category, index) => (
              <CategoryRow
                key={category.id}
                category={category}
                color={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                itemCount={itemCounts.get(category.id) ?? 0}
                suppliers={suppliers}
                onChanged={load}
              />
            ))}
          </div>
        )}

        <form
          onSubmit={handleAdd}
          className="flex flex-col gap-3 rounded-3xl border p-4"
          style={{ background: C.card, borderColor: C.border }}
        >
          <h2 className="text-base font-bold">הוספת קטגוריה</h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-category-name" className="text-xs font-semibold" style={{ color: C.textSecondary }}>
              שם הקטגוריה
            </label>
            <input
              id="new-category-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={fieldClass}
              style={fieldStyle}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-category-supplier" className="text-xs font-semibold" style={{ color: C.textSecondary }}>
              ספק ברירת מחדל (לא חובה)
            </label>
            <select
              id="new-category-supplier"
              className={fieldClass}
              style={fieldStyle}
              value={newSupplierId}
              onChange={(e) => setNewSupplierId(e.target.value)}
            >
              <option value="">— ללא —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="text-sm" style={{ color: C.error }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ background: C.primary }}
          >
            <Plus className="size-4" />
            הוספה
          </button>
        </form>
      </div>

      <BottomNav active="/inventory/items" />
    </div>
  )
}

function CategoryRow({
  category,
  color,
  itemCount,
  suppliers,
  onChanged,
}: {
  category: ProductCategory
  color: string
  itemCount: number
  suppliers: Supplier[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(category.name)
  const [supplierId, setSupplierId] = useState(category.default_supplier_id ?? '')
  const [sortOrder, setSortOrder] = useState(String(category.sort_order))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSave() {
    setError(null)

    if (!name.trim()) {
      setError('יש להזין שם קטגוריה')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase
      .from('product_categories')
      .update({
        name: name.trim(),
        default_supplier_id: supplierId || null,
        sort_order: Number(sortOrder) || 0,
      })
      .eq('id', category.id)
    setSubmitting(false)

    if (updateError) {
      setError(friendlyCategoryError(updateError))
      return
    }

    setEditing(false)
    onChanged()
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2.5 rounded-2xl border p-3" style={{ background: C.card, borderColor: C.primary }}>
        <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} style={fieldStyle} />
        <select
          className={fieldClass}
          style={fieldStyle}
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
        >
          <option value="">— ללא ספק ברירת מחדל —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label
            htmlFor={`sort-order-${category.id}`}
            className="shrink-0 text-xs font-semibold"
            style={{ color: C.textSecondary }}
          >
            סדר תצוגה
          </label>
          <input
            id={`sort-order-${category.id}`}
            type="number"
            className="h-10 w-20 rounded-xl border px-3 text-sm outline-none"
            style={fieldStyle}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm" style={{ color: C.error }}>
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={handleSave}
            className="h-10 flex-1 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ background: C.primary }}
          >
            שמירה
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="h-10 flex-1 rounded-xl border text-sm font-semibold"
            style={{ borderColor: C.border, color: C.textSecondary }}
          >
            ביטול
          </button>
        </div>
      </div>
    )
  }

  const supplierName = suppliers.find((s) => s.id === category.default_supplier_id)?.name

  return (
    <div className="flex items-center gap-2.5 rounded-2xl border px-3 py-2.5" style={{ background: C.card, borderColor: C.border }}>
      <div className="flex size-[34px] shrink-0 items-center justify-center rounded-xl" style={{ background: color }}>
        <Tags className="size-4 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{category.name}</p>
        <p className="truncate text-xs" style={{ color: C.textMuted }}>
          {itemCount} מוצרים · ספק ברירת מחדל: {supplierName ?? 'ללא'}
        </p>
      </div>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
        style={{ background: C.subtleBg, color: C.textMuted }}
        title="סדר תצוגה"
      >
        #{category.sort_order}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="עריכה"
        className="flex size-8 shrink-0 items-center justify-center rounded-full"
        style={{ color: C.textSecondary }}
      >
        <Pencil className="size-4" />
      </button>
    </div>
  )
}
