import { useEffect, useState, type FormEvent } from 'react'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { InventoryItem } from '@/lib/types'

export function InventoryItems() {
  const [items, setItems] = useState<InventoryItem[] | null>(null)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const { data } = await supabase.from('inventory_items').select('*').order('name')
    setItems((data as InventoryItem[]) ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('יש להזין שם פריט')
      return
    }

    setSubmitting(true)
    const { error: insertError } = await supabase
      .from('inventory_items')
      .insert({ name: name.trim(), unit: unit.trim() || null })
    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setName('')
    setUnit('')
    load()
  }

  async function handleToggleActive(item: InventoryItem) {
    await supabase.from('inventory_items').update({ active: !item.active }).eq('id', item.id)
    load()
  }

  if (items === null) return null

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">פריטי מלאי</h1>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          {items.length === 0 && <p className="text-muted-foreground text-sm">אין פריטים עדיין.</p>}
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <span className={item.active ? '' : 'text-muted-foreground line-through'}>
                {item.name}
                {item.unit && <span className="text-muted-foreground"> ({item.unit})</span>}
              </span>
              <Button variant="ghost" size="sm" onClick={() => handleToggleActive(item)}>
                {item.active ? 'השבתה' : 'הפעלה'}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">הוספת פריט</CardTitle>
        </CardHeader>
        <form onSubmit={handleAdd}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-name">שם הפריט</Label>
              <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-unit">יחידת מידה (לא חובה)</Label>
              <Input id="item-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
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
