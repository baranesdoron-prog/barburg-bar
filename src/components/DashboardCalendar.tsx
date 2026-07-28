import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn, toLocalDateKey } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Shift } from '@/lib/types'

const WEEKDAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

const monthLabelFormatter = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' })

function dateKeyFromYMD(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildCalendarGrid(year: number, month: number) {
  const firstOfMonth = new Date(year, month, 1)
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay())

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + i)
    return { date, inMonth: date.getMonth() === month }
  })
}

export function DashboardCalendar({ shifts }: { shifts: Shift[] }) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const todayKey = dateKeyFromYMD(today)

  const markersByDate = useMemo(() => {
    const map = new Map<string, { hasUpcoming: boolean; needsClosure: boolean }>()
    for (const shift of shifts) {
      if (shift.effective_status === 'cancelled' || shift.effective_status === 'draft') continue

      const key = toLocalDateKey(shift.start_time)
      const entry = map.get(key) ?? { hasUpcoming: false, needsClosure: false }

      if (shift.effective_status === 'published' || shift.effective_status === 'active') {
        entry.hasUpcoming = true
      }
      if (shift.effective_status === 'waiting_for_closure' || shift.effective_status === 'reopened') {
        entry.needsClosure = true
      }

      map.set(key, entry)
    }
    return map
  }, [shifts])

  const grid = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth])

  function goToPrevMonth() {
    const d = new Date(viewYear, viewMonth - 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  function goToNextMonth() {
    const d = new Date(viewYear, viewMonth + 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  return (
    <Card className="w-fit">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <Button variant="ghost" size="icon" onClick={goToPrevMonth} aria-label="חודש קודם">
          <ChevronRight className="size-4" />
        </Button>
        <CardTitle className="text-sm">{monthLabelFormatter.format(new Date(viewYear, viewMonth, 1))}</CardTitle>
        <Button variant="ghost" size="icon" onClick={goToNextMonth} aria-label="חודש הבא">
          <ChevronLeft className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.map(({ date, inMonth }) => {
            const key = dateKeyFromYMD(date)
            const markers = markersByDate.get(key)
            const isToday = key === todayKey

            return (
              <div
                key={key}
                className={cn(
                  'flex h-9 w-9 flex-col items-center justify-center rounded-md text-xs',
                  !inMonth && 'text-muted-foreground/40',
                  isToday && 'ring-1 ring-primary',
                )}
              >
                {markers?.needsClosure ? (
                  <span className="text-destructive font-semibold">[{date.getDate()}]</span>
                ) : markers?.hasUpcoming ? (
                  <span className="font-semibold text-green-600">[{date.getDate()}]</span>
                ) : (
                  <span>{date.getDate()}</span>
                )}
              </div>
            )
          })}
        </div>
        <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-green-600">[ ]</span> משמרות קרובות
          </span>
          <span>
            <span className="text-destructive font-semibold">[ ]</span> משמרות שצריך לסגור
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
