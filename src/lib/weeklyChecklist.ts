export function toDateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDateStr(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function sundayOf(date: Date) {
  const sunday = new Date(date)
  sunday.setHours(0, 0, 0, 0)
  sunday.setDate(sunday.getDate() - sunday.getDay())
  return sunday
}

// The week that matters right now: this week's Sunday while the cycle is
// still running (Sun-Thu), or next week's Sunday once it's over (Fri/Sat).
export function activeWeekStart() {
  const now = new Date()
  const sunday = sundayOf(now)
  return now.getDay() >= 5 ? addDays(sunday, 7) : sunday
}

export function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

// The bar didn't operate before this week, so there's nothing to schedule
// earlier than it regardless of which year is selected.
export const EARLIEST_WEEK_START = '2026-07-19'

// Weeks before the current calendar month's first week move to the
// archive (and drop out of the dashboard's closing-shifts widget) -- a
// week that straddles the month boundary (e.g. contains the 1st) still
// counts as "this month" and stays live.
export function archiveCutoff() {
  const now = new Date()
  return toDateStr(sundayOf(new Date(now.getFullYear(), now.getMonth(), 1)))
}

// Same "a week counts as the month it contains the 1st of" rule as
// archiveCutoff(), but bounding the current month on both ends instead
// of just its start.
export function currentMonthWeekRange() {
  const now = new Date()
  const start = toDateStr(sundayOf(new Date(now.getFullYear(), now.getMonth(), 1)))
  const end = toDateStr(sundayOf(new Date(now.getFullYear(), now.getMonth() + 1, 1)))
  return { start, end }
}

export const weekLabelFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' })

const currentYear = new Date().getFullYear()
export const YEAR_OPTIONS = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2]

export function sundaysInYear(year: number): Date[] {
  const result: Date[] = []
  const d = new Date(year, 0, 1)
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1)
  while (d.getFullYear() === year) {
    result.push(new Date(d))
    d.setDate(d.getDate() + 7)
  }
  return result
}
