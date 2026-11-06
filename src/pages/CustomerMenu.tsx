import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { C } from '@/lib/designTokens'
import { SHEKELS_PER_TOKEN, tokensLabel, type CustomerMenuRow } from '@/lib/punchcards'

// What customers see: each drink, what's in it and its tokens. Never the
// staff-only serving/preparation notes (customer_menu() doesn't return them).
export function CustomerMenu() {
  const [rows, setRows] = useState<CustomerMenuRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('customer_menu').then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message)
      setRows((data as CustomerMenuRow[]) ?? [])
    })
  }, [])

  const sections = useMemo(() => {
    const map = new Map<string, { name: string; tokens: number | null; items: CustomerMenuRow[] }>()
    for (const row of rows ?? []) {
      if (!map.has(row.category_id)) map.set(row.category_id, { name: row.category_name, tokens: row.default_tokens, items: [] })
      map.get(row.category_id)!.items.push(row)
    }
    return [...map.values()]
  }, [rows])

  if (rows === null) return null

  return (
    <div dir="rtl" className="mx-auto flex max-w-md flex-col gap-3 pb-24" style={{ color: C.text }}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">תפריט הבר</h1>
        <Link
          to="/punchcards/order"
          className="flex h-10 items-center rounded-xl px-3.5 text-sm font-bold text-white"
          style={{ background: C.primary }}
        >
          להזמנה בכרטיסייה
        </Link>
      </div>
      <span className="text-sm" style={{ color: C.textSecondary }}>
        ניקוב = {SHEKELS_PER_TOKEN} ₪
      </span>
      {error && <p style={{ color: C.error }}>{error}</p>}

      {sections.map((section) => (
        <div key={section.name} className="mt-1 flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-extrabold">{section.name}</h2>
            {section.tokens !== null && (
              <span className="text-sm font-extrabold" style={{ color: '#7A5230' }}>
                {tokensLabel(section.tokens)}
              </span>
            )}
          </div>
          {section.items.map((item) => (
            <div key={item.item_id} className="flex flex-col gap-0.5 rounded-xl border px-3 py-2.5" style={{ borderColor: C.border, background: C.card }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold">{item.name}</span>
                {section.tokens !== item.tokens && (
                  <span className="text-sm font-bold whitespace-nowrap" style={{ color: '#7A5230' }}>
                    {tokensLabel(item.tokens)}
                  </span>
                )}
              </div>
              {item.description && (
                <span className="text-sm" style={{ color: C.textSecondary }}>
                  {item.description}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
