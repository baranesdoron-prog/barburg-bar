import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ChevronDown, MessageCircle, Plus, Search, Truck } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { C, CATEGORY_COLORS } from '@/lib/designTokens'
import { BottomNav } from '@/components/BottomNav'
import type { Supplier } from '@/lib/types'

const fieldClass = 'h-10 w-full min-w-0 rounded-xl border px-3 text-sm outline-none'
const fieldStyle = { borderColor: C.border, background: C.card, color: C.text }

interface SupplierFormFields {
  name: string
  barContactName: string
  barContactPhone: string
  supplierContactName: string
  supplierContactPhone: string
  email: string
  averageDeliveryDays: string
}

// Supplier phones are free text (unlike employee phones, which are
// normalized to +972...), so a local 05X number has its leading 0 swapped
// for the country code before going to wa.me, which wants digits only.
function whatsappHref(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return `https://wa.me/${digits.startsWith('0') ? `972${digits.slice(1)}` : digits}`
}

function deliveryLabel(days: number) {
  if (days === 0) return 'אספקה באותו יום'
  if (days === 1) return 'אספקה תוך יום'
  return `אספקה תוך ${days} ימים`
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
}: {
  id: string
  label: string
  type?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold" style={{ color: C.textSecondary }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        min={type === 'number' ? 0 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass}
        style={fieldStyle}
      />
    </div>
  )
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
      <Field
        id={`${idPrefix}-name`}
        label="שם הספק"
        value={fields.name}
        onChange={(name) => onChange({ ...fields, name })}
      />
      <Field
        id={`${idPrefix}-bar-contact`}
        label="איש קשר בברבורג (לא חובה)"
        value={fields.barContactName}
        onChange={(barContactName) => onChange({ ...fields, barContactName })}
      />
      <Field
        id={`${idPrefix}-bar-contact-phone`}
        label="טלפון איש הקשר בברבורג (לא חובה)"
        value={fields.barContactPhone}
        onChange={(barContactPhone) => onChange({ ...fields, barContactPhone })}
      />
      <Field
        id={`${idPrefix}-supplier-contact`}
        label="איש קשר אצל הספק (לא חובה)"
        value={fields.supplierContactName}
        onChange={(supplierContactName) => onChange({ ...fields, supplierContactName })}
      />
      <Field
        id={`${idPrefix}-supplier-contact-phone`}
        label="טלפון איש הקשר אצל הספק (לא חובה)"
        value={fields.supplierContactPhone}
        onChange={(supplierContactPhone) => onChange({ ...fields, supplierContactPhone })}
      />
      <Field
        id={`${idPrefix}-email`}
        label="אימייל (לא חובה)"
        type="email"
        value={fields.email}
        onChange={(email) => onChange({ ...fields, email })}
      />
      <Field
        id={`${idPrefix}-delivery`}
        label="זמן אספקה ממוצע (ימים, לא חובה)"
        type="number"
        value={fields.averageDeliveryDays}
        onChange={(averageDeliveryDays) => onChange({ ...fields, averageDeliveryDays })}
      />
    </>
  )
}

const emptyFields: SupplierFormFields = {
  name: '',
  barContactName: '',
  barContactPhone: '',
  supplierContactName: '',
  supplierContactPhone: '',
  email: '',
  averageDeliveryDays: '',
}

function toPayload(fields: SupplierFormFields) {
  return {
    name: fields.name.trim(),
    bar_contact_name: fields.barContactName.trim() || null,
    bar_contact_phone: fields.barContactPhone.trim() || null,
    supplier_contact_name: fields.supplierContactName.trim() || null,
    supplier_contact_phone: fields.supplierContactPhone.trim() || null,
    email: fields.email.trim() || null,
    average_delivery_days: fields.averageDeliveryDays ? Number(fields.averageDeliveryDays) : null,
  }
}

function PrimaryButton({
  children,
  disabled,
  onClick,
  type = 'button',
}: {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
      style={{ background: C.primary }}
    >
      {children}
    </button>
  )
}

function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-10 flex-1 rounded-xl border text-sm font-semibold"
      style={{ borderColor: C.border, background: C.card, color: C.textSecondary }}
    >
      {children}
    </button>
  )
}

export function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null)
  const [productCounts, setProductCounts] = useState<Map<string, number>>(new Map())
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [fields, setFields] = useState<SupplierFormFields>(emptyFields)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const [suppliersRes, itemsRes] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      // resolved_supplier_id includes products that inherit the supplier
      // from their category's default, so the count matches what
      // reordering from this supplier would actually cover.
      supabase.from('inventory_items_with_latest_count').select('resolved_supplier_id').eq('active', true),
    ])
    const counts = new Map<string, number>()
    for (const row of (itemsRes.data as { resolved_supplier_id: string | null }[]) ?? []) {
      if (row.resolved_supplier_id) counts.set(row.resolved_supplier_id, (counts.get(row.resolved_supplier_id) ?? 0) + 1)
    }
    setProductCounts(counts)
    setSuppliers((suppliersRes.data as Supplier[]) ?? [])
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
    setAdding(false)
    load()
  }

  async function handleToggleActive(supplier: Supplier) {
    await supabase.from('suppliers').update({ active: !supplier.active }).eq('id', supplier.id)
    setExpandedId(null)
    load()
  }

  if (suppliers === null) return null

  const activeCount = suppliers.filter((s) => s.active).length
  const inactiveCount = suppliers.length - activeCount
  const term = search.trim()
  const visible = suppliers.filter(
    (s) => s.active !== showInactive && (!term || s.name.includes(term) || s.supplier_contact_name?.includes(term)),
  )

  return (
    <div dir="rtl" className="min-h-svh pb-40" style={{ background: C.appBg, color: C.text }}>
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.primaryLight }}>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ background: C.primary }}>
            <Truck className="size-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: C.primary }}>
            ספקים
          </h1>
        </div>

        {adding && (
          <form
            onSubmit={handleAdd}
            className="flex flex-col gap-3 rounded-3xl border p-4"
            style={{ background: C.card, borderColor: C.primary }}
          >
            <h2 className="text-base font-bold">הוספת ספק</h2>
            <SupplierFields fields={fields} onChange={setFields} idPrefix="new-supplier" />
            {error && (
              <p className="text-sm" style={{ color: C.error }}>
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <PrimaryButton type="submit" disabled={submitting}>
                הוספה
              </PrimaryButton>
              <SecondaryButton
                onClick={() => {
                  setAdding(false)
                  setError(null)
                }}
              >
                ביטול
              </SecondaryButton>
            </div>
          </form>
        )}

        <div
          className="flex items-center gap-2 rounded-full border px-4"
          style={{ borderColor: C.border, background: C.card, height: 44 }}
        >
          <Search className="size-[18px] shrink-0" style={{ color: C.textMuted }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש ספק"
            className="h-full flex-1 bg-transparent text-sm outline-none"
            style={{ color: C.text }}
          />
        </div>

        <div className="flex gap-2">
          {[
            { inactive: false, label: `פעילים ${activeCount}` },
            { inactive: true, label: `מושבתים ${inactiveCount}` },
          ].map((chip) => {
            const on = showInactive === chip.inactive
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => setShowInactive(chip.inactive)}
                className="h-8 rounded-full border px-3 text-xs font-semibold"
                style={{
                  background: on ? C.primary : C.card,
                  borderColor: on ? C.primary : C.border,
                  color: on ? '#fff' : C.textSecondary,
                }}
              >
                {chip.label}
              </button>
            )
          })}
        </div>

        {visible.length === 0 ? (
          <p className="text-center" style={{ color: C.textMuted }}>
            {suppliers.length === 0 ? 'אין ספקים עדיין.' : 'אין ספקים תואמים.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-3xl border p-3.5" style={{ background: C.subtleBg, borderColor: C.border }}>
            {visible.map((supplier) => (
              <SupplierRow
                key={supplier.id}
                supplier={supplier}
                color={CATEGORY_COLORS[suppliers.indexOf(supplier) % CATEGORY_COLORS.length]}
                productCount={productCounts.get(supplier.id) ?? 0}
                expanded={expandedId === supplier.id}
                onToggle={() => setExpandedId(expandedId === supplier.id ? null : supplier.id)}
                onChanged={load}
                onToggleActive={handleToggleActive}
              />
            ))}
          </div>
        )}
      </div>

      {!adding && (
        <button
          type="button"
          onClick={() => {
            setAdding(true)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
          className="fixed bottom-20 left-4 z-10 flex h-12 items-center gap-1.5 rounded-full px-5 text-sm font-bold text-white shadow-lg"
          style={{ background: C.primary }}
        >
          <Plus className="size-4" />
          הוספת ספק
        </button>
      )}

      <BottomNav active="/suppliers" />
    </div>
  )
}

function ContactLine({ label, name, phone }: { label: string; name: string | null; phone: string | null }) {
  if (!name && !phone) return null
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <span style={{ color: C.textMuted }}>{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        {name && <span className="truncate font-semibold">{name}</span>}
        {phone && (
          <a
            href={whatsappHref(phone)}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="shrink-0 text-xs underline-offset-2 hover:underline"
            style={{ color: C.textSecondary }}
          >
            {phone}
          </a>
        )}
      </span>
    </div>
  )
}

function SupplierRow({
  supplier,
  color,
  productCount,
  expanded,
  onToggle,
  onChanged,
  onToggleActive,
}: {
  supplier: Supplier
  color: string
  productCount: number
  expanded: boolean
  onToggle: () => void
  onChanged: () => void
  onToggleActive: (supplier: Supplier) => void
}) {
  const [editing, setEditing] = useState(false)
  const [fields, setFields] = useState<SupplierFormFields>({
    name: supplier.name,
    barContactName: supplier.bar_contact_name ?? '',
    barContactPhone: supplier.bar_contact_phone ?? '',
    supplierContactName: supplier.supplier_contact_name ?? '',
    supplierContactPhone: supplier.supplier_contact_phone ?? '',
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
      <div className="flex flex-col gap-3 rounded-2xl border p-3" style={{ background: C.card, borderColor: C.primary }}>
        <SupplierFields fields={fields} onChange={setFields} idPrefix={`supplier-${supplier.id}`} />
        {error && (
          <p className="text-sm" style={{ color: C.error }}>
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <PrimaryButton disabled={submitting} onClick={handleSave}>
            שמירה
          </PrimaryButton>
          <SecondaryButton onClick={() => setEditing(false)}>ביטול</SecondaryButton>
        </div>
      </div>
    )
  }

  const sub = [
    supplier.active ? null : 'מושבת',
    supplier.average_delivery_days !== null ? deliveryLabel(supplier.average_delivery_days) : null,
    `${productCount} מוצרים`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ background: C.card, borderColor: C.border, opacity: supplier.active ? 1 : 0.7 }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2.5 text-start">
          <div
            className="flex size-[34px] shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
            style={{ background: supplier.active ? color : C.textMuted }}
          >
            {supplier.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{supplier.name}</p>
            <p className="truncate text-xs" style={{ color: C.textMuted }}>
              {sub}
            </p>
          </div>
        </button>
        {supplier.supplier_contact_phone && (
          <a
            href={whatsappHref(supplier.supplier_contact_phone)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`וואטסאפ ל${supplier.supplier_contact_name ?? supplier.name}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: C.successBg, color: C.success }}
          >
            <MessageCircle className="size-4" />
          </a>
        )}
        <button type="button" onClick={onToggle} aria-label={expanded ? 'הסתרה' : 'פירוט'} className="shrink-0">
          <ChevronDown
            className="size-4 transition-transform"
            style={{ color: C.textMuted, transform: expanded ? undefined : 'rotate(90deg)' }}
          />
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 border-t px-3 pt-1 pb-3" style={{ borderColor: C.border }}>
          <div className="flex flex-col divide-y" style={{ borderColor: C.border }}>
            <ContactLine
              label="איש קשר אצל הספק"
              name={supplier.supplier_contact_name}
              phone={supplier.supplier_contact_phone}
            />
            <ContactLine label="איש קשר בברבורג" name={supplier.bar_contact_name} phone={supplier.bar_contact_phone} />
            {supplier.email && (
              <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span style={{ color: C.textMuted }}>אימייל</span>
                <span className="truncate text-xs" dir="ltr">
                  {supplier.email}
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <SecondaryButton onClick={() => setEditing(true)}>עריכה</SecondaryButton>
            <SecondaryButton onClick={() => onToggleActive(supplier)}>
              {supplier.active ? 'השבתה' : 'הפעלה'}
            </SecondaryButton>
          </div>
        </div>
      )}
    </div>
  )
}
