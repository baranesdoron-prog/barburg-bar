import { useEffect, useState, type FormEvent } from 'react'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { ProductCategory, Supplier } from '@/lib/types'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

interface SupplierFormFields {
  name: string
  contactName: string
  phone: string
  email: string
  averageDeliveryDays: string
}

function SupplierFields({
  fields,
  onChange,
  idPrefix,
}: {
  fields: SupplierFormFields
  onChange: (fields: SupplierFormFields) => void
  idPrefix: string
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-name`}>שם הספק</Label>
        <Input
          id={`${idPrefix}-name`}
          value={fields.name}
          onChange={(e) => onChange({ ...fields, name: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-contact`}>איש קשר (לא חובה)</Label>
        <Input
          id={`${idPrefix}-contact`}
          value={fields.contactName}
          onChange={(e) => onChange({ ...fields, contactName: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-phone`}>טלפון (לא חובה)</Label>
        <Input
          id={`${idPrefix}-phone`}
          value={fields.phone}
          onChange={(e) => onChange({ ...fields, phone: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-email`}>אימייל (לא חובה)</Label>
        <Input
          id={`${idPrefix}-email`}
          type="email"
          value={fields.email}
          onChange={(e) => onChange({ ...fields, email: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-delivery`}>זמן אספקה ממוצע (ימים, לא חובה)</Label>
        <Input
          id={`${idPrefix}-delivery`}
          type="number"
          min={0}
          value={fields.averageDeliveryDays}
          onChange={(e) => onChange({ ...fields, averageDeliveryDays: e.target.value })}
        />
      </div>
    </>
  )
}

const emptyFields: SupplierFormFields = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  averageDeliveryDays: '',
}

function toPayload(fields: SupplierFormFields) {
  return {
    name: fields.name.trim(),
    contact_name: fields.contactName.trim() || null,
    phone: fields.phone.trim() || null,
    email: fields.email.trim() || null,
    average_delivery_days: fields.averageDeliveryDays ? Number(fields.averageDeliveryDays) : null,
  }
}

export function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null)
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [fields, setFields] = useState<SupplierFormFields>(emptyFields)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const [suppliersRes, categoriesRes] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('product_categories').select('*').order('sort_order'),
    ])
    setSuppliers((suppliersRes.data as Supplier[]) ?? [])
    setCategories((categoriesRes.data as ProductCategory[]) ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!fields.name.trim()) {
      setError('יש להזין שם ספק')
      return
    }

    setSubmitting(true)
    const { error: insertError } = await supabase.from('suppliers').insert(toPayload(fields))
    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setFields(emptyFields)
    load()
  }

  async function handleToggleActive(supplier: Supplier) {
    await supabase.from('suppliers').update({ active: !supplier.active }).eq('id', supplier.id)
    load()
  }

  async function handleCategoryDefaultChange(categoryId: string, supplierId: string) {
    await supabase
      .from('product_categories')
      .update({ default_supplier_id: supplierId || null })
      .eq('id', categoryId)
    load()
  }

  if (suppliers === null) return null

  const activeSuppliers = suppliers.filter((s) => s.active)

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">ספקים</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">קטגוריות מוצרים</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {categories.map((category) => (
            <div key={category.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex-1">{category.name}</span>
              <select
                className={selectClass + ' w-40'}
                value={category.default_supplier_id ?? ''}
                onChange={(e) => handleCategoryDefaultChange(category.id, e.target.value)}
              >
                <option value="">— ללא ספק ברירת מחדל —</option>
                {activeSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          {suppliers.length === 0 && <p className="text-muted-foreground text-sm">אין ספקים עדיין.</p>}
          {suppliers.map((supplier) => (
            <SupplierRow key={supplier.id} supplier={supplier} onChanged={load} onToggleActive={handleToggleActive} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">הוספת ספק</CardTitle>
        </CardHeader>
        <form onSubmit={handleAdd}>
          <CardContent className="flex flex-col gap-4">
            <SupplierFields fields={fields} onChange={setFields} idPrefix="new-supplier" />
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

function SupplierRow({
  supplier,
  onChanged,
  onToggleActive,
}: {
  supplier: Supplier
  onChanged: () => void
  onToggleActive: (supplier: Supplier) => void
}) {
  const [editing, setEditing] = useState(false)
  const [fields, setFields] = useState<SupplierFormFields>({
    name: supplier.name,
    contactName: supplier.contact_name ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    averageDeliveryDays: supplier.average_delivery_days?.toString() ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSave() {
    setError(null)

    if (!fields.name.trim()) {
      setError('יש להזין שם ספק')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.from('suppliers').update(toPayload(fields)).eq('id', supplier.id)
    setSubmitting(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setEditing(false)
    onChanged()
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-4 rounded-md border p-3">
        <SupplierFields fields={fields} onChange={setFields} idPrefix={`supplier-${supplier.id}`} />
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

  return (
    <div className="flex items-center justify-between rounded-md border p-2 text-sm">
      <div className={supplier.active ? '' : 'text-muted-foreground line-through'}>
        <p className="font-medium">{supplier.name}</p>
        {(supplier.contact_name || supplier.phone) && (
          <p className="text-muted-foreground">
            {supplier.contact_name} {supplier.phone && `· ${supplier.phone}`}
          </p>
        )}
        {supplier.average_delivery_days !== null && (
          <p className="text-muted-foreground">זמן אספקה ממוצע: {supplier.average_delivery_days} ימים</p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          עריכה
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onToggleActive(supplier)}>
          {supplier.active ? 'השבתה' : 'הפעלה'}
        </Button>
      </div>
    </div>
  )
}
