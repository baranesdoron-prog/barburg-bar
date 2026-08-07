import { useState, type FormEvent } from 'react'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { InventoryItem, InventoryUnitType, ProductCategory, Supplier } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

interface ProductFormProps {
  item: InventoryItem | null
  suppliers: Supplier[]
  categories: ProductCategory[]
  onSaved: () => void
  onCancel: () => void
}

export function ProductForm({ item, suppliers, categories, onSaved, onCancel }: ProductFormProps) {
  const [name, setName] = useState(item?.name ?? '')
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '')
  const [vendor, setVendor] = useState(item?.vendor ?? '')
  const [sku, setSku] = useState(item?.sku ?? '')
  const [supplierId, setSupplierId] = useState(item?.supplier_id ?? '')
  const [unitType, setUnitType] = useState<InventoryUnitType>(item?.unit_type ?? 'single')
  const [unitsPerBox, setUnitsPerBox] = useState(item?.units_per_box?.toString() ?? '')
  const [unitPrice, setUnitPrice] = useState(item?.unit_price?.toString() ?? '')
  const [minimumQuantity, setMinimumQuantity] = useState(item?.minimum_quantity?.toString() ?? '')
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    const path = `${crypto.randomUUID()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('inventory-images').upload(path, file)

    setUploading(false)

    if (uploadError) {
      setError(uploadError.message)
      return
    }

    const { data } = supabase.storage.from('inventory-images').getPublicUrl(path)
    setImageUrl(data.publicUrl)
  }

  function handleCategoryChange(newCategoryId: string) {
    setCategoryId(newCategoryId)

    if (!supplierId) {
      const category = categories.find((c) => c.id === newCategoryId)
      if (category?.default_supplier_id) {
        setSupplierId(category.default_supplier_id)
      }
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('יש להזין שם מוצר')
      return
    }

    if (unitType === 'box' && !unitsPerBox) {
      setError('יש להזין כמות יחידות בקופסה')
      return
    }

    setSubmitting(true)

    const payload = {
      name: name.trim(),
      unit: unit.trim() || null,
      category_id: categoryId || null,
      vendor: vendor.trim() || null,
      sku: sku.trim() || null,
      supplier_id: supplierId || null,
      unit_type: unitType,
      units_per_box: unitType === 'box' ? Number(unitsPerBox) : null,
      unit_price: unitPrice ? Number(unitPrice) : null,
      minimum_quantity: minimumQuantity ? Number(minimumQuantity) : null,
      image_url: imageUrl,
    }

    const { error: saveError } = item
      ? await supabase.from('inventory_items').update(payload).eq('id', item.id)
      : await supabase.from('inventory_items').insert(payload)

    setSubmitting(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    onSaved()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{item ? 'עריכת מוצר' : 'הוספת מוצר'}</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4">
          {item && (
            <p className="text-muted-foreground text-sm">
              מלאי נוכחי: {item.current_stock}
              {item.unit && ` ${item.unit}`}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-name">שם המוצר</Label>
            <Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-category">קטגוריה</Label>
            <select
              id="product-category"
              className={selectClass}
              value={categoryId}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              <option value="">— ללא —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-vendor">יצרן/מותג</Label>
            <Input id="product-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-sku">מק"ט</Label>
            <Input id="product-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-supplier">ספק</Label>
            <select
              id="product-supplier"
              className={selectClass}
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">— ללא —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-unit">יחידת מידה (לא חובה)</Label>
            <Input id="product-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-unit-type">סוג יחידה</Label>
            <select
              id="product-unit-type"
              className={selectClass}
              value={unitType}
              onChange={(e) => setUnitType(e.target.value as InventoryUnitType)}
            >
              <option value="single">בודד</option>
              <option value="box">קופסה</option>
            </select>
          </div>

          {unitType === 'box' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="product-units-per-box">כמות יחידות בקופסה</Label>
              <Input
                id="product-units-per-box"
                type="number"
                min={1}
                value={unitsPerBox}
                onChange={(e) => setUnitsPerBox(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-price">מחיר ליחידה (לא חובה)</Label>
            <Input
              id="product-price"
              type="number"
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-minimum">כמות מינימום להתראה (לא חובה)</Label>
            <Input
              id="product-minimum"
              type="number"
              value={minimumQuantity}
              onChange={(e) => setMinimumQuantity(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="product-image">תמונה (לא חובה)</Label>
            {imageUrl && <img src={imageUrl} alt={name} className="h-24 w-24 rounded-md object-cover" />}
            <Input id="product-image" type="file" accept="image/*" onChange={handleImageChange} disabled={uploading} />
            {uploading && <p className="text-muted-foreground text-sm">מעלה תמונה...</p>}
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button type="submit" disabled={submitting || uploading} className="flex-1">
            שמירה
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            ביטול
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
