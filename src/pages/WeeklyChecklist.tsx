import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUserContext } from '@/lib/outletContext'
import { addDays, sundayOf, toDateStr, parseDateStr, activeWeekStart } from '@/lib/weeklyChecklist'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ShiftManagerAssignment, WeeklyChecklistItem } from '@/lib/types'

const PROTOCOL_URL = 'https://drive.google.com/file/d/1T2uBgG66MbfVCceC4J-sEJYZaccDGkkY/view?usp=sharing'
const OPENING_PROTOCOL_SORT_ORDER = 9

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

const weekLabelFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
const dueDateFormatter = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

interface EmployeeNameRow {
  id: string
  full_name: string
}

export function WeeklyChecklist() {
  const { appUser, effectiveRole } = useAppUserContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const [weekOffset, setWeekOffset] = useState(0)
  const [items, setItems] = useState<WeeklyChecklistItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<ShiftManagerAssignment[]>([])
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map())

  const weekParam = searchParams.get('week')
  const weekStart = weekParam ? parseDateStr(weekParam) : addDays(sundayOf(new Date()), weekOffset * 7)
  const weekStartStr = toDateStr(weekStart)
  const isAdmin = effectiveRole === 'administrator'

  useEffect(() => {
    let cancelled = false
    setItems(null)

    supabase.rpc('ensure_weekly_checklist', { p_week_start: weekStartStr }).then(({ data, error: rpcError }) => {
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
  }, [weekStartStr])

  useEffect(() => {
    if (!isAdmin) return
    async function load() {
      const [assignmentsRes, employeesRes] = await Promise.all([
        supabase.from('shift_manager_assignments').select('*').order('week_start', { ascending: false }),
        supabase.from('employees').select('id, full_name'),
      ])
      setAssignments((assignmentsRes.data as ShiftManagerAssignment[]) ?? [])
      setEmployeeNames(new Map(((employeesRes.data as EmployeeNameRow[]) ?? []).map((e) => [e.id, e.full_name])))
    }
    load()
  }, [isAdmin])

  function goToWeek(date: Date) {
    setSearchParams({ week: toDateStr(date) })
  }

  function handlePrev() {
    if (weekParam) {
      goToWeek(addDays(weekStart, -7))
    } else {
      setWeekOffset((w) => w - 1)
    }
  }

  function handleNext() {
    if (weekParam) {
      goToWeek(addDays(weekStart, 7))
    } else {
      setWeekOffset((w) => w + 1)
    }
  }

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

  const todayStr = toDateStr(new Date())
  const historyOptions = assignments.filter((a) => a.week_start <= toDateStr(activeWeekStart()))

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      {isAdmin && historyOptions.length > 0 && (
        <select
          className={selectClass}
          value=""
          onChange={(e) => {
            if (e.target.value) goToWeek(parseDateStr(e.target.value))
          }}
        >
          <option value="">עיון בשבועות קודמים לפי אחראי משמרת...</option>
          {historyOptions.map((a) => (
            <option key={a.week_start} value={a.week_start}>
              שבוע {weekLabelFormatter.format(parseDateStr(a.week_start))} — {employeeNames.get(a.employee_id) ?? '—'}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={handlePrev}>
          שבוע קודם
        </Button>
        <h1 className="text-center text-lg font-semibold">שבוע {weekLabelFormatter.format(weekStart)}</h1>
        <Button variant="ghost" size="sm" onClick={handleNext}>
          שבוע הבא
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">רשימת משימות שבועית — אחראי/ת משמרת</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {items === null && <p className="text-muted-foreground text-sm">טוען...</p>}
          {items?.map((item) => {
            const isLate = !item.completed && item.due_date < todayStr
            return (
              <div key={item.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={item.completed}
                  onChange={() => handleToggle(item)}
                />
                <div className="flex flex-col">
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
                  <span className={isLate ? 'text-destructive text-xs font-medium' : 'text-muted-foreground text-xs'}>
                    {dueDateFormatter.format(parseDateStr(item.due_date))}
                    {isLate && ' — באיחור'}
                  </span>
                </div>
              </div>
            )
          })}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
