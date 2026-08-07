import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { ProductForm } from '@/components/ProductForm'
import type { InventoryItem, ProductCategory, Supplier } from '@/lib/types'

export function ProductFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState<InventoryItem | null | undefined>(id ? undefined : null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])

  useEffect(() => {
    async function load() {
      const [suppliersRes, categoriesRes, itemRes] = await Promise.all([
        supabase.from('suppliers').select('*').eq('active', true).order('name'),
        supabase.from('product_categories').select('*').order('sort_order'),
        id ? supabase.from('inventory_items').select('*').eq('id', id).single() : Promise.resolve({ data: null }),
      ])

      setSuppliers((suppliersRes.data as Supplier[]) ?? [])
      setCategories((categoriesRes.data as ProductCategory[]) ?? [])
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
        categories={categories}
        onSaved={() => navigate('/inventory/items')}
        onCancel={() => navigate('/inventory/items')}
      />
    </div>
  )
}
