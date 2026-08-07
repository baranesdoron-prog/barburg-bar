import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WeeklyChecklistItem } from '@/lib/types'

const PROTOCOL_URL = 'https://drive.google.com/file/d/1T2uBgG66MbfVCceC4J-sEJYZaccDGkkY/view?usp=sharing'
const OPENING_PROTOCOL_SORT_ORDER = 9

function toDateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getSunday(offsetWeeks: number) {
  const now = new Date()
  const sunday = new Date(now)
  sunday.setHours(0, 0, 0, 0)
  sunday.setDate(sunday.getDate() - sunday.getDay() + offsetWeeks * 7)
  return sunday
}

const weekLabelFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })

export function WeeklyChecklist() {
  const { appUser } = useAppUserContext()
  const [weekOffset, setWeekOffset] = useState(0)
  const [items, setItems] = useState<WeeklyChecklistItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const weekStart = getSunday(weekOffset)

  useEffect(() => {
    let cancelled = false
    setItems(null)

    supabase.rpc('ensure_weekly_checklist', { p_week_start: toDateStr(weekStart) }).then(({ data, error: rpcError }) => {
      if (cancelled) return
      if (rpcError) {
        setError(rpcError.message)
        return
      }
      setItems((data as WeeklyChecklistItem[]) ?? [])
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset])

  async function handleToggle(item: WeeklyChecklistItem) {
    const nowCompleted = !item.completed

    const { error: updateError } = await supabase
      .from('weekly_checklist_items')
      .update({
        completed: nowCompleted,
        completed_by: nowCompleted ? appUser.id : null,
        completed_at: nowCompleted ? new Date().toISOString() : null,
      })
      .eq('id', item.id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, completed: nowCompleted } : i)) ?? null)
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setWeekOffset((w) => w - 1)}>
          שבוע קודם
        </Button>
        <h1 className="text-center text-lg font-semibold">שבוע {weekLabelFormatter.format(weekStart)}</h1>
        <Button variant="ghost" size="sm" onClick={() => setWeekOffset((w) => w + 1)}>
          שבוע הבא
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">רשימת משימות שבועית — אחראי/ת משמרת</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {items === null && <p className="text-muted-foreground text-sm">טוען...</p>}
          {items?.map((item) => (
            <div key={item.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={item.completed}
                onChange={() => handleToggle(item)}
              />
              <span className={item.completed ? 'text-muted-foreground line-through' : ''}>
                {item.title}
                {item.sort_order === OPENING_PROTOCOL_SORT_ORDER && (
                  <>
                    {' '}
                    <a href={PROTOCOL_URL} target="_blank" rel="noreferrer" className="text-primary underline">
                      (פרוטוקול פתיחה)
                    </a>
                  </>
                )}
              </span>
            </div>
          ))}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
