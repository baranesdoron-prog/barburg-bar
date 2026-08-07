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
