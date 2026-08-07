import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { parseCsv, toCsv } from '@/lib/csv'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { InventoryItem, InventoryItemWithStock, InventoryUnitType, ProductCategory, Supplier } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

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
  const [items, setItems] = useState<InventoryItemWithStock[] | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])

  const [nameFilter, setNameFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')

  const [importSummary, setImportSummary] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    if (category) query = query.eq('category_id', category)
    if (supplier) query = query.eq('supplier_id', supplier)

    const { data } = await query.order('name')
    setItems((data as InventoryItemWithStock[]) ?? [])
  }

  useEffect(() => {
    loadFilters()
    search()
  }, [])

  function handleClearFilters() {
    setNameFilter('')
    setCategoryFilter('')
    setSupplierFilter('')
    search({ name: '', category: '', supplier: '' })
  }

  async function handleToggleActive(item: InventoryItem) {
    await supabase.from('inventory_items').update({ active: !item.active }).eq('id', item.id)
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

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">פריטי מלאי</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">חיפוש</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Input placeholder="שם מוצר" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} />
          <select
            className={selectClass}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">כל הקטגוריות</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className={selectClass} value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="">כל הספקים</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => search()}>
              חיפוש
            </Button>
            <Button variant="outline" className="flex-1" onClick={handleClearFilters}>
              נקה סינון
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          {items.length === 0 && <p className="text-muted-foreground text-sm">לא נמצאו פריטים.</p>}
          {items.map((item) => {
            const supplierName = suppliers.find((s) => s.id === item.supplier_id)?.name
            const categoryName = categories.find((c) => c.id === item.category_id)?.name
            const isLowStock = item.is_low_stock

            return (
              <div key={item.id} className="flex items-start gap-3 rounded-md border p-2 text-sm">
                {item.image_url && (
                  <img src={item.image_url} alt={item.name} className="size-12 shrink-0 rounded-md object-cover" />
                )}
                <div className="flex-1">
                  <p className={item.active ? 'font-medium' : 'text-muted-foreground font-medium line-through'}>
                    {item.name}
                    {item.unit && <span className="text-muted-foreground"> ({item.unit})</span>}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {[categoryName, item.vendor, supplierName, item.sku].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {item.unit_type === 'box' ? `קופסה (${item.units_per_box} יח')` : 'בודד'}
                    {item.unit_price !== null && ` · ₪${item.unit_price}`}
                  </p>
                  <p className={isLowStock ? 'text-destructive text-xs font-medium' : 'text-muted-foreground text-xs'}>
                    מלאי נוכחי: {item.current_stock}
                    {item.minimum_quantity !== null && ` (מינימום ${item.minimum_quantity})`}
                    {isLowStock && ' — מלאי נמוך'}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <Button asChild variant="ghost" size="sm">
                    <Link to={`/inventory/items/${item.id}/edit`}>עריכה</Link>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleToggleActive(item)}>
                    {item.active ? 'השבתה' : 'הפעלה'}
                  </Button>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <Button asChild>
          <Link to="/inventory/items/new">הוספת מוצר</Link>
        </Button>
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          ייבוא קובץ CSV
        </Button>
        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
        <Button variant="ghost" onClick={handleDownloadTemplate}>
          הורדת תבנית ייבוא
        </Button>
        {importSummary && <p className="text-muted-foreground text-sm">{importSummary}</p>}
      </div>
    </div>
  )
}
