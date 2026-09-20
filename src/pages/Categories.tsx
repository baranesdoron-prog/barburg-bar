import { useEffect, useState, type FormEvent } from 'react'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { ProductCategory, Supplier } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

function friendlyCategoryError(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'כבר קיימת קטגוריה בשם זה'
  return error.message
}

export function Categories() {
  const [categories, setCategories] = useState<ProductCategory[] | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [newName, setNewName] = useState('')
  const [newSupplierId, setNewSupplierId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const [categoriesRes, suppliersRes] = await Promise.all([
      supabase.from('product_categories').select('*').order('sort_order'),
      supabase.from('suppliers').select('*').eq('active', true).order('name'),
    ])
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
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">קטגוריות מוצרים</h1>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          {categories.length === 0 && <p className="text-muted-foreground text-sm">אין קטגוריות עדיין.</p>}
          {categories.map((category) => (
            <CategoryRow key={category.id} category={category} suppliers={suppliers} onChanged={load} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">הוספת קטגוריה</CardTitle>
        </CardHeader>
        <form onSubmit={handleAdd}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-category-name">שם הקטגוריה</Label>
              <Input id="new-category-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-category-supplier">ספק ברירת מחדל (לא חובה)</Label>
              <select
                id="new-category-supplier"
                className={selectClass}
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
            {error && <p className="text-destructive text-sm">{error}</p>}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={submitting} className="w-full">
              הוספה
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}

function CategoryRow({
  category,
  suppliers,
  onChanged,
}: {
  category: ProductCategory
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
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <select className={selectClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">— ללא ספק ברירת מחדל —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <Label htmlFor={`sort-order-${category.id}`} className="text-muted-foreground text-xs shrink-0">
            סדר תצוגה
          </Label>
          <Input
            id={`sort-order-${category.id}`}
            type="number"
            className="w-20"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex gap-2">
          <Button className="flex-1" disabled={submitting} onClick={handleSave}>
            שמירה
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setEditing(false)}>
            ביטול
          </Button>
        </div>
      </div>
    )
  }

  const supplierName = suppliers.find((s) => s.id === category.default_supplier_id)?.name

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
      <div>
        <p className="font-medium">{category.name}</p>
        <p className="text-muted-foreground text-xs">ספק ברירת מחדל: {supplierName ?? '— ללא —'}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
        עריכה
      </Button>
    </div>
  )
}
