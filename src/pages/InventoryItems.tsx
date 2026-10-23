import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown, Download, MoreVertical, Package, Plus, Search, Upload } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { parseCsv, toCsv } from '@/lib/csv'
import { C, CATEGORY_COLORS } from '@/lib/designTokens'
import type { InventoryItem, InventoryItemWithStock, InventoryUnitType, ProductCategory, Supplier } from '@/lib/types'

type StatusFilter = 'all' | 'low' | 'inactive'

const CSV_TEMPLATE_HEADER = [
  'name',
  'category',
  'vendor',
  'supplier',
  'sku',
  'unit',
  'unit_type',
  'units_per_box',
  'unit_price',
  'minimum_quantity',
]

export function InventoryItems() {
  const [searchParams] = useSearchParams()
  const unclassifiedOnly = searchParams.get('unclassified') === '1'
  const unassignedSupplierOnly = searchParams.get('unassigned_supplier') === '1'

  const [items, setItems] = useState<InventoryItemWithStock[] | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])

  const [nameFilter, setNameFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const [importSummary, setImportSummary] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function loadFilters() {
    const [suppliersRes, categoriesRes] = await Promise.all([
      supabase.from('suppliers').select('*').eq('active', true).order('name'),
      supabase.from('product_categories').select('*').order('sort_order'),
    ])
    setSuppliers((suppliersRes.data as Supplier[]) ?? [])
    setCategories((categoriesRes.data as ProductCategory[]) ?? [])
  }

  async function search(overrides?: { name?: string; category?: string; supplier?: string }) {
    const name = overrides?.name ?? nameFilter
    const category = overrides?.category ?? categoryFilter
    const supplier = overrides?.supplier ?? supplierFilter

    let query = supabase.from('inventory_items_with_latest_count').select('*')

    if (name.trim()) query = query.ilike('name', `%${name.trim()}%`)
    if (unclassifiedOnly) {
      query = query.is('category_id', null)
    } else if (category) {
      query = query.eq('category_id', category)
    }
    if (unassignedSupplierOnly) {
      query = query.is('resolved_supplier_id', null)
    } else if (supplier) {
      query = query.eq('resolved_supplier_id', supplier)
    }

    const { data } = await query.order('name')
    setItems((data as InventoryItemWithStock[]) ?? [])
  }

  useEffect(() => {
    loadFilters()
    search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unclassifiedOnly, unassignedSupplierOnly])

  function handleClearFilters() {
    setNameFilter('')
    setCategoryFilter('')
    setSupplierFilter('')
    setStatusFilter('all')
    search({ name: '', category: '', supplier: '' })
  }

  async function handleToggleActive(item: InventoryItem) {
    await supabase.from('inventory_items').update({ active: !item.active }).eq('id', item.id)
    search()
  }

  async function handleDelete(item: InventoryItem) {
    if (!window.confirm(`למחוק לצמיתות את "${item.name}"? הפעולה אינה הפיכה.`)) return

    setDeleteError(null)
    const { error: deleteErr } = await supabase.from('inventory_items').delete().eq('id', item.id)

    if (deleteErr) {
      setDeleteError(
        deleteErr.code === '23503'
          ? `לא ניתן למחוק את "${item.name}" — קיימת עבורו היסטוריה של ספירות מלאי או הזמנות רכש.`
          : deleteErr.message,
      )
      return
    }

    search()
  }

  function handleDownloadTemplate() {
    const csv = toCsv([
      CSV_TEMPLATE_HEADER,
      ['וודקה', 'בקבוקי אלכוהול', 'Absolut', 'ספק לדוגמה', 'SKU-001', 'בקבוקים', 'box', '12', '45.5', '10'],
    ])
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'inventory-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setImportSummary(null)
    const text = await file.text()
    const rows = parseCsv(text)
    if (rows.length === 0) return

    const [header, ...dataRows] = rows
    const colIndex = (col: string) => header.indexOf(col)

    const supplierByName = new Map(suppliers.map((s) => [s.name, s.id]))
    const categoryByName = new Map(categories.map((c) => [c.name, c.id]))
    const unmatchedSuppliers = new Set<string>()
    const unmatchedCategories = new Set<string>()

    const payload = dataRows
      .filter((row) => row.some((cell) => cell.trim() !== ''))
      .map((row) => {
        const get = (col: string) => {
          const idx = colIndex(col)
          return idx >= 0 ? (row[idx] ?? '').trim() : ''
        }

        const supplierName = get('supplier')
        let supplierId: string | null = null
        if (supplierName) {
          supplierId = supplierByName.get(supplierName) ?? null
          if (!supplierId) unmatchedSuppliers.add(supplierName)
        }

        const categoryName = get('category')
        let categoryId: string | null = null
        if (categoryName) {
          categoryId = categoryByName.get(categoryName) ?? null
          if (!categoryId) unmatchedCategories.add(categoryName)
        }

        const unitTypeRaw = get('unit_type').toLowerCase()
        const unitType: InventoryUnitType = unitTypeRaw === 'box' ? 'box' : 'single'
        const unitsPerBoxRaw = get('units_per_box')

        return {
          name: get('name'),
          category_id: categoryId,
          vendor: get('vendor') || null,
          supplier_id: supplierId,
          sku: get('sku') || null,
          unit: get('unit') || null,
          unit_type: unitType,
          units_per_box: unitType === 'box' && unitsPerBoxRaw ? Number(unitsPerBoxRaw) : null,
          unit_price: get('unit_price') ? Number(get('unit_price')) : null,
          minimum_quantity: get('minimum_quantity') ? Number(get('minimum_quantity')) : null,
        }
      })
      .filter((row) => row.name)

    if (payload.length === 0) {
      setImportSummary('לא נמצאו שורות תקינות לייבוא.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const { error: insertError } = await supabase.from('inventory_items').insert(payload)

    if (insertError) {
      setImportSummary(`שגיאה בייבוא: ${insertError.message}`)
    } else {
      let summary = `יובאו ${payload.length} מוצרים בהצלחה.`
      if (unmatchedSuppliers.size > 0) {
        summary += ` ספקים שלא נמצאו (יובאו ללא ספק): ${[...unmatchedSuppliers].join(', ')}`
      }
      if (unmatchedCategories.size > 0) {
        summary += ` קטגוריות שלא נמצאו (יובאו ללא קטגוריה): ${[...unmatchedCategories].join(', ')}`
      }
      setImportSummary(summary)
      loadFilters()
      search()
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (items === null) return null

  const categorySortOrder = new Map(categories.map((c) => [c.id, c.sort_order]))
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]))

  const lowCount = items.filter((i) => i.active && i.is_low_stock).length
  const inactiveCount = items.filter((i) => !i.active).length

  // Name/category/supplier narrow server-side (see search()); the stat
  // tiles are a client-side view on top of that, so their counts always
  // describe what the current filters returned.
  const visibleItems = items.filter((item) => {
    if (statusFilter === 'low') return item.active && item.is_low_stock
    if (statusFilter === 'inactive') return !item.active
    return true
  })

  const sortedItems = [...visibleItems].sort((a, b) => {
    const orderA = a.category_id ? (categorySortOrder.get(a.category_id) ?? Infinity) : Infinity
    const orderB = b.category_id ? (categorySortOrder.get(b.category_id) ?? Infinity) : Infinity
    if (orderA !== orderB) return orderA - orderB
    const displayA = a.display_order ?? Infinity
    const displayB = b.display_order ?? Infinity
    if (displayA !== displayB) return displayA - displayB
    return a.name.localeCompare(b.name)
  })

  const groups: { key: string; name: string; items: InventoryItemWithStock[] }[] = []
  for (const item of sortedItems) {
    const key = item.category_id ?? 'none'
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else
      groups.push({
        key,
        name: categories.find((c) => c.id === item.category_id)?.name ?? 'ללא קטגוריה',
        items: [item],
      })
  }

  function toggleCategory(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const stats: { key: StatusFilter; label: string; value: number; color: string; bg: string }[] = [
    { key: 'all', label: 'מוצרים', value: items.length, color: C.primary, bg: C.primaryLight },
    { key: 'low', label: 'מלאי נמוך', value: lowCount, color: C.error, bg: C.errorBg },
    { key: 'inactive', label: 'מושבתים', value: inactiveCount, color: C.textSecondary, bg: C.subtleBg },
  ]

  return (
    <div dir="rtl" className="min-h-svh pb-40" style={{ background: C.appBg, color: C.text }}>
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.primaryLight }}>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ background: C.primary }}>
            <Package className="size-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: C.primary }}>
            פריטי מלאי
          </h1>
        </div>

        {unclassifiedOnly && <FilterBanner text="מוצג: מוצרים ללא סיווג (קטגוריה) בלבד" />}
        {unassignedSupplierOnly && <FilterBanner text="מוצג: מוצרים ללא ספק משויך בלבד" />}

        <div className="grid grid-cols-3 gap-2">
          {stats.map((stat) => {
            const selected = statusFilter === stat.key
            return (
              <button
                key={stat.key}
                type="button"
                onClick={() => setStatusFilter(selected && stat.key !== 'all' ? 'all' : stat.key)}
                className="flex flex-col items-start gap-0.5 rounded-2xl border p-3 text-start"
                style={{
                  background: selected ? stat.bg : C.card,
                  borderColor: selected ? stat.color : C.border,
                }}
              >
                <span className="text-2xl font-bold tabular-nums" style={{ color: selected ? stat.color : C.text }}>
                  {stat.value}
                </span>
                <span className="text-xs font-semibold" style={{ color: selected ? stat.color : C.textMuted }}>
                  {stat.label}
                </span>
              </button>
            )
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            search()
          }}
          className="flex items-center gap-2 rounded-full border px-4"
          style={{ borderColor: C.border, background: C.card, height: 44 }}
        >
          <Search className="size-[18px] shrink-0" style={{ color: C.textMuted }} />
          <input
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            onBlur={() => search()}
            placeholder="חיפוש לפי שם מוצר"
            className="h-full flex-1 bg-transparent text-sm outline-none"
            style={{ color: C.text }}
          />
        </form>

        <div className="flex gap-2">
          <select
            className="h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm disabled:opacity-50"
            style={{ borderColor: C.border, background: C.card, color: C.text }}
            value={categoryFilter}
            disabled={unclassifiedOnly}
            onChange={(e) => {
              setCategoryFilter(e.target.value)
              search({ category: e.target.value })
            }}
          >
            <option value="">כל הקטגוריות</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm disabled:opacity-50"
            style={{ borderColor: C.border, background: C.card, color: C.text }}
            value={supplierFilter}
            disabled={unassignedSupplierOnly}
            onChange={(e) => {
              setSupplierFilter(e.target.value)
              search({ supplier: e.target.value })
            }}
          >
            <option value="">כל הספקים</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {(nameFilter || categoryFilter || supplierFilter || statusFilter !== 'all') && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="-mt-2 self-start text-xs font-semibold"
            style={{ color: C.textSecondary }}
          >
            נקה סינון
          </button>
        )}

        {deleteError && (
          <p className="rounded-xl px-3 py-2 text-sm" style={{ background: C.errorBg, color: C.error }}>
            {deleteError}
          </p>
        )}

        {groups.length === 0 && (
          <p className="text-center" style={{ color: C.textMuted }}>
            לא נמצאו פריטים.
          </p>
        )}

        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.key)
          const groupLow = group.items.filter((i) => i.active && i.is_low_stock).length
          const categoryIndex = categories.findIndex((c) => c.id === group.key)
          const iconColor =
            categoryIndex === -1 ? C.textMuted : CATEGORY_COLORS[categoryIndex % CATEGORY_COLORS.length]
          return (
            <div
              key={group.key}
              className="overflow-hidden rounded-3xl border"
              style={{ background: C.card, borderColor: C.border }}
            >
              <button
                type="button"
                onClick={() => toggleCategory(group.key)}
                className="flex w-full items-center gap-2.5 px-3 py-3 text-start"
              >
                <div
                  className="flex size-[34px] shrink-0 items-center justify-center rounded-xl"
                  style={{ background: iconColor }}
                >
                  <Package className="size-4 text-white" />
                </div>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{group.name}</span>
                {groupLow > 0 && (
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{ background: C.errorBg, color: C.error }}
                  >
                    {groupLow} נמוך
                  </span>
                )}
                <span className="shrink-0 text-xs tabular-nums" style={{ color: C.textMuted }}>
                  {group.items.length}
                </span>
                <ChevronDown
                  className="size-4 shrink-0 transition-transform"
                  style={{ color: C.textMuted, transform: isCollapsed ? 'rotate(90deg)' : undefined }}
                />
              </button>

              {!isCollapsed && (
                <div className="flex flex-col gap-2 border-t p-2.5" style={{ background: C.subtleBg, borderColor: C.border }}>
                  {group.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      supplierName={item.resolved_supplier_id ? supplierNames.get(item.resolved_supplier_id) : undefined}
                      menuOpen={openMenuId === item.id}
                      onToggleMenu={() => setOpenMenuId(openMenuId === item.id ? null : item.id)}
                      onToggleActive={() => {
                        setOpenMenuId(null)
                        handleToggleActive(item)
                      }}
                      onDelete={() => {
                        setOpenMenuId(null)
                        handleDelete(item)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold"
            style={{ borderColor: C.border, background: C.card, color: C.textSecondary }}
          >
            <Upload className="size-3.5" />
            ייבוא קובץ CSV
          </button>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold"
            style={{ borderColor: C.border, background: C.card, color: C.textSecondary }}
          >
            <Download className="size-3.5" />
            הורדת תבנית ייבוא
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
        </div>
        {importSummary && (
          <p className="text-sm" style={{ color: C.textMuted }}>
            {importSummary}
          </p>
        )}
      </div>

      {openMenuId && <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />}

      <Link
        to="/inventory/items/new"
        className="fixed bottom-20 left-4 z-10 flex h-12 items-center gap-1.5 rounded-full px-5 text-sm font-bold text-white shadow-lg"
        style={{ background: C.primary }}
      >
        <Plus className="size-4" />
        הוספת מוצר
      </Link>
    </div>
  )
}

function FilterBanner({ text }: { text: string }) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold"
      style={{ background: C.warningBg, color: C.warning }}
    >
      <span>{text}</span>
      <Link to="/inventory/items" className="shrink-0 text-xs font-medium" style={{ color: C.textSecondary }}>
        נקה
      </Link>
    </div>
  )
}

function ItemRow({
  item,
  supplierName,
  menuOpen,
  onToggleMenu,
  onToggleActive,
  onDelete,
}: {
  item: InventoryItemWithStock
  supplierName: string | undefined
  menuOpen: boolean
  onToggleMenu: () => void
  onToggleActive: () => void
  onDelete: () => void
}) {
  const isInherited = !item.supplier_id && !!item.resolved_supplier_id
  const supplierLabel = supplierName && (isInherited ? `${supplierName} (בירושה)` : supplierName)
  const isLow = item.active && item.is_low_stock
  const minimum = item.minimum_quantity
  // The bar spans 0 to twice the minimum, so the threshold tick sits in
  // the middle: an item at the line reads as half full, and how far the
  // fill is from that tick shows how far stock is above or below it.
  const fill = minimum && minimum > 0 ? Math.min(item.current_stock / (minimum * 2), 1) : null

  return (
    <div
      className="relative flex items-center gap-2.5 rounded-2xl border px-2.5 py-2.5"
      style={{ background: C.card, borderColor: C.border, opacity: item.active ? 1 : 0.65 }}
    >
      <Link to={`/inventory/items/${item.id}/edit`} className="flex min-w-0 flex-1 items-center gap-2.5">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} className="size-10 shrink-0 rounded-xl object-cover" />
        ) : (
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: C.subtleBg, color: C.textMuted }}
          >
            <Package className="size-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold" style={{ textDecoration: item.active ? undefined : 'line-through' }}>
            {item.name}
            {item.unit && (
              <span className="font-medium" style={{ color: C.textMuted }}>
                {' '}
                ({item.unit})
              </span>
            )}
          </p>
          <p className="truncate text-xs" style={{ color: C.textMuted }}>
            {[
              item.active ? null : 'מושבת',
              supplierLabel,
              item.unit_type === 'box' ? `קופסה (${item.units_per_box} יח')` : 'בודד',
              item.unit_price !== null ? `₪${item.unit_price}` : null,
              item.sku,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {fill !== null && (
            <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: C.subtleBg }}>
              <div
                className="absolute inset-y-0 right-0 rounded-full"
                style={{ width: `${fill * 100}%`, background: isLow ? C.error : C.success }}
              />
              <div className="absolute inset-y-0 right-1/2 w-0.5" style={{ background: C.textMuted }} />
            </div>
          )}
        </div>
        <div className="min-w-[46px] shrink-0 text-center">
          <p className="text-lg leading-tight font-bold tabular-nums" style={{ color: isLow ? C.error : C.text }}>
            {item.current_stock}
          </p>
          {minimum !== null && (
            <p className="text-[11px]" style={{ color: C.textMuted }}>
              מינ' {minimum}
            </p>
          )}
        </div>
      </Link>

      <button
        type="button"
        onClick={onToggleMenu}
        aria-label="פעולות"
        className="flex size-8 shrink-0 items-center justify-center rounded-full"
        style={{ color: C.textMuted }}
      >
        <MoreVertical className="size-4" />
      </button>

      {menuOpen && (
        <div
          className="absolute top-12 left-2 z-20 flex w-36 flex-col rounded-2xl border p-1.5 text-sm shadow-lg"
          style={{ background: C.card, borderColor: C.border }}
        >
          <Link to={`/inventory/items/${item.id}/edit`} className="rounded-xl px-3 py-2">
            עריכה
          </Link>
          <button type="button" onClick={onToggleActive} className="rounded-xl px-3 py-2 text-start">
            {item.active ? 'השבתה' : 'הפעלה'}
          </button>
          {!item.active && (
            <button type="button" onClick={onDelete} className="rounded-xl px-3 py-2 text-start" style={{ color: C.error }}>
              מחיקה
            </button>
          )}
        </div>
      )}
    </div>
  )
}
