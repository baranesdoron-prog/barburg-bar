import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { ProductForm } from '@/components/ProductForm'
import type { InventoryItem, Supplier } from '@/lib/types'

export function ProductFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState<InventoryItem | null | undefined>(id ? undefined : null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])

  useEffect(() => {
    async function load() {
      const [suppliersRes, itemsRes, itemRes] = await Promise.all([
        supabase.from('suppliers').select('*').eq('active', true).order('name'),
        supabase.from('inventory_items').select('category').not('category', 'is', null),
        id ? supabase.from('inventory_items').select('*').eq('id', id).single() : Promise.resolve({ data: null }),
      ])

      setSuppliers((suppliersRes.data as Supplier[]) ?? [])
      const categories = new Set(
        ((itemsRes.data as { category: string }[]) ?? []).map((r) => r.category).filter(Boolean),
      )
      setCategoryOptions([...categories].sort())
      if (id) setItem(itemRes.data as InventoryItem)
    }

    load()
  }, [id])

  if (item === undefined) return null

  return (
    <div className="mx-auto max-w-md">
      <ProductForm
        item={item}
        suppliers={suppliers}
        categoryOptions={categoryOptions}
        onSaved={() => navigate('/inventory/items')}
        onCancel={() => navigate('/inventory/items')}
      />
    </div>
  )
}
