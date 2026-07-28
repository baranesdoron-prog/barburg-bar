import { useEffect, useState, type FormEvent } from 'react'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { Supplier } from '@/lib/types'

export function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null)
  const [name, setName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const { data } = await supabase.from('suppliers').select('*').order('name')
    setSuppliers((data as Supplier[]) ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('יש להזין שם ספק')
      return
    }

    setSubmitting(true)
    const { error: insertError } = await supabase.from('suppliers').insert({
      name: name.trim(),
      contact_name: contactName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
    })
    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setName('')
    setContactName('')
    setPhone('')
    setEmail('')
    load()
  }

  async function handleToggleActive(supplier: Supplier) {
    await supabase.from('suppliers').update({ active: !supplier.active }).eq('id', supplier.id)
    load()
  }

  if (suppliers === null) return null

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">ספקים</h1>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          {suppliers.length === 0 && <p className="text-muted-foreground text-sm">אין ספקים עדיין.</p>}
          {suppliers.map((supplier) => (
            <div key={supplier.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <div className={supplier.active ? '' : 'text-muted-foreground line-through'}>
                <p className="font-medium">{supplier.name}</p>
                {(supplier.contact_name || supplier.phone) && (
                  <p className="text-muted-foreground">
                    {supplier.contact_name} {supplier.phone && `· ${supplier.phone}`}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleToggleActive(supplier)}>
                {supplier.active ? 'השבתה' : 'הפעלה'}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">הוספת ספק</CardTitle>
        </CardHeader>
        <form onSubmit={handleAdd}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="supplier-name">שם הספק</Label>
              <Input id="supplier-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="supplier-contact">איש קשר (לא חובה)</Label>
              <Input
                id="supplier-contact"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="supplier-phone">טלפון (לא חובה)</Label>
              <Input id="supplier-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="supplier-email">אימייל (לא חובה)</Label>
              <Input
                id="supplier-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
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
