import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Search, ChevronLeft } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import { weekLabelFormatter } from '@/lib/weeklyChecklist'
import { shiftTypeLabels } from '@/lib/shiftLabels'
import { C } from '@/lib/designTokens'
import { BottomNav } from '@/components/BottomNav'
import type { ShiftReportRow } from '@/lib/types'

const monthLabelFormatter = new Intl.DateTimeFormat('he-IL', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jerusalem',
})

export function Reports() {
  const [reports, setReports] = useState<ShiftReportRow[] | null>(null)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    supabase
      .from('shift_reports')
      .select('*')
      .order('generated_at', { ascending: false })
      .then(({ data }) => setReports((data as ShiftReportRow[]) ?? []))

    // shift_reports.generated_by is an app_users id -- RLS only lets a
    // non-admin read their own app_users row, so resolving everyone
    // else's name needs this RPC rather than a plain select.
    supabase
      .rpc('list_app_user_names')
      .then(({ data }) => {
        setUserNames(new Map(((data as { id: string; full_name: string }[]) ?? []).map((u) => [u.id, u.full_name])))
      })
  }, [])

  const filtered = (reports ?? []).filter((report) => {
    const shift = report.snapshot.shift
    const name = userNames.get(report.generated_by) ?? ''
    const term = search.trim()
    if (term && !shift.shift_type.includes(term) && !name.includes(term)) return false
    if (dateFrom && new Date(shift.start_time) < new Date(dateFrom)) return false
    if (dateTo && new Date(shift.start_time) > new Date(`${dateTo}T23:59:59`)) return false
    return true
  })

  // Grouped by the month of the shift's own date (not when the report
  // was generated) -- that's the date a manager actually thinks of when
  // looking for "the report from that night".
  const groups: { label: string; reports: ShiftReportRow[] }[] = []
  for (const report of filtered) {
    const label = monthLabelFormatter.format(new Date(report.snapshot.shift.start_time))
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.reports.push(report)
    else groups.push({ label, reports: [report] })
  }

  return (
    <div dir="rtl" className="min-h-svh pb-24" style={{ background: C.appBg, color: C.text }}>
      <header
        className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3"
        style={{ background: C.card, borderColor: C.border }}
      >
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="ברבורג" className="size-9 shrink-0 rounded-full object-cover" />
          <span className="text-lg font-bold">ברבורג</span>
        </div>
      </header>

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.primaryLight }}>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ background: C.primary }}>
            <FileText className="size-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: C.primary }}>
            דוחות סגירה
          </h1>
        </div>

        <div
          className="flex items-center gap-2 rounded-full border px-4"
          style={{ borderColor: C.border, background: C.card, height: 44 }}
        >
          <Search className="size-[18px] shrink-0" style={{ color: C.textMuted }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם או סוג משמרת"
            className="h-full flex-1 bg-transparent text-sm outline-none"
            style={{ color: C.text }}
          />
        </div>

        <div className="flex gap-2">
          <input
            type="date"
            lang="en-GB"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 flex-1 rounded-xl border px-3 text-sm"
            style={{ borderColor: C.border, background: C.card, color: dateFrom ? C.text : C.textMuted }}
          />
          <input
            type="date"
            lang="en-GB"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-10 flex-1 rounded-xl border px-3 text-sm"
            style={{ borderColor: C.border, background: C.card, color: dateTo ? C.text : C.textMuted }}
          />
        </div>

        {reports !== null && groups.length === 0 && (
          <p className="text-center" style={{ color: C.textMuted }}>
            אין דוחות תואמים.
          </p>
        )}

        {groups.length > 0 && (
          <div className="flex flex-col gap-3 rounded-3xl border p-3.5" style={{ background: C.subtleBg, borderColor: C.border }}>
            {groups.map((group, i) => (
              <div key={group.label} className={i === 0 ? 'flex flex-col gap-2' : 'flex flex-col gap-2 pt-2'}>
                <p className="px-0.5 text-xs font-bold" style={{ color: C.textMuted }}>
                  {group.label}
                </p>
                {group.reports.map((report) => {
                  // A handful of reports predate the shift_type enum and
                  // carry an old free-text value (e.g. "משמרת רגילה") --
                  // only show the type when it's a value we recognize,
                  // rather than surfacing that raw legacy text.
                  const typeLabel = shiftTypeLabels[report.snapshot.shift.shift_type]
                  return (
                    <Link
                      key={report.id}
                      to={`/shifts/${report.shift_id}/report`}
                      className="flex items-center gap-2.5 rounded-2xl border px-3 py-2.5"
                      style={{ background: C.card, borderColor: C.border }}
                    >
                      <div
                        className="flex size-[34px] shrink-0 items-center justify-center rounded-full"
                        style={{ background: C.accent }}
                      >
                        <FileText className="size-[15px] text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold" style={{ color: C.text }}>
                          {userNames.get(report.generated_by) ?? '—'} ·{' '}
                          {weekLabelFormatter.format(new Date(report.snapshot.shift.start_time))}
                        </p>
                        <p className="text-xs" style={{ color: C.textMuted }}>
                          נוצר {formatDateTime(report.generated_at)}
                          {typeLabel ? ` · ${typeLabel}` : ''}
                        </p>
                      </div>
                      <ChevronLeft className="size-4 shrink-0" style={{ color: C.textMuted }} />
                    </Link>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav active="/reports" />
    </div>
  )
}
