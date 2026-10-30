// Sends the shift emails queued in shift_email_outbox (see migrations
// 101/102) through Resend.
//
// Two ways in:
// - the pg_cron job, every minute while something is pending, with the
//   shared x-cron-secret header: works through the queue;
// - an administrator from the users page ({ test: true }): sends one
//   sample of each email to their own address, to check the setup.
//
// Secrets (Supabase dashboard > Edge Functions > Secrets):
//   RESEND_API_KEY, EMAIL_FROM ("ברבורג <shifts@your-domain>"),
//   CRON_SECRET (same value as the shift_emails_cron_secret vault secret),
//   APP_URL (optional, defaults to the Netlify site).

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderShiftEmail, DUTY_LABELS, type Duty, type EmailKind, type ShiftEmail, type TeamMember } from './render.ts'
import { buildIcs, googleCalendarUrl, outlookCalendarUrl, toBase64, type CalendarEvent } from './ics.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const TZ = 'Asia/Jerusalem'
const weekdayFormatter = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long' })
const dayMonthFormatter = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'numeric' })
const timeFormatter = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

const MAX_ATTEMPTS = 5
const BATCH_SIZE = 40
// Area manager/supervisor hours start 15 minutes after the bar opens --
// matches AREA_SUPERVISOR_HOURS (19:45–00:30) in the app.
const AREA_START_OFFSET_MS = 15 * 60 * 1000

interface Shift {
  id: string
  shift_type: 'opening' | 'closing'
  status: string
  start_time: string
  end_time: string
}

interface Assignment {
  shift_id: string
  employee_id: string
  assignment_role: Duty
}

interface OutboxRow {
  id: string
  kind: EmailKind
  employee_id: string
  week_start: string
  assignment_role: Duty
  actor_employee_id: string | null
  attempts: number
  created_at: string
}

interface Outcome {
  status: 'sent' | 'skipped'
  reason?: string
}

function dateLabel(date: Date) {
  return `${weekdayFormatter.format(date)}, ${dayMonthFormatter.format(date)}`
}

function hoursLabel(start: Date, end: Date) {
  return `${timeFormatter.format(start)}–${timeFormatter.format(end)}`
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? fullName
}

function appUrl() {
  return (Deno.env.get('APP_URL') ?? 'https://barburg-bar.netlify.app').replace(/\/$/, '')
}

async function sendViaResend(message: {
  to: string
  bcc: string[]
  subject: string
  html: string
  ics: { filename: string; content: string; method: 'PUBLISH' | 'CANCEL' } | null
}) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('EMAIL_FROM'),
      to: [message.to],
      bcc: message.bcc.length > 0 ? message.bcc : undefined,
      subject: message.subject,
      html: message.html,
      attachments: message.ics
        ? [
            {
              filename: message.ics.filename,
              content: toBase64(message.ics.content),
              content_type: `text/calendar; charset=utf-8; method=${message.ics.method}`,
            },
          ]
        : undefined,
    }),
  })
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`)
  }
}

async function recipientEmail(db: SupabaseClient, employeeId: string) {
  const { data: appUsers } = await db
    .from('app_users')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .limit(1)
  const appUserId = (appUsers as { id: string }[] | null)?.[0]?.id
  if (!appUserId) return null
  const { data } = await db.auth.admin.getUserById(appUserId)
  return data?.user?.email ?? null
}

// One queued email: re-checks it against the assignments as they are now
// (the queue can be a minute stale), builds it and sends it.
async function handleRow(db: SupabaseClient, row: OutboxRow, bcc: string[]): Promise<Outcome> {
  const { data: shiftRows } = await db.from('shifts').select('id, shift_type, status, start_time, end_time').eq('week_start', row.week_start)
  // Prefer the non-cancelled instance per type, same as the app does.
  const byType: Partial<Record<'opening' | 'closing', Shift>> = {}
  for (const s of (shiftRows as Shift[]) ?? []) {
    const existing = byType[s.shift_type]
    if (!existing || existing.status === 'cancelled') byType[s.shift_type] = s
  }
  const opening = byType.opening
  const closing = byType.closing
  if (!opening && !closing) return { status: 'skipped', reason: 'no shifts that week' }
  const active = [opening, closing].filter((s): s is Shift => !!s && s.status !== 'cancelled')
  if (row.kind !== 'removed' && active.length === 0) return { status: 'skipped', reason: 'evening cancelled' }

  const { data: assignmentRows } = await db
    .from('shift_assignments')
    .select('shift_id, employee_id, assignment_role')
    .in('shift_id', active.map((s) => s.id))
  const assignments = (assignmentRows as Assignment[]) ?? []
  const mine = assignments.filter((a) => a.employee_id === row.employee_id && a.assignment_role === row.assignment_role)
  const holds = mine.length > 0

  // What this person was last told about this evening+duty.
  const { data: historyRows } = await db
    .from('shift_email_outbox')
    .select('kind, status')
    .eq('employee_id', row.employee_id)
    .eq('week_start', row.week_start)
    .eq('assignment_role', row.assignment_role)
    .in('kind', ['assigned', 'removed'])
    .in('status', ['sent', 'skipped'])
    .order('processed_at', { ascending: false })
    .limit(20)
  const history = (historyRows as { kind: EmailKind; status: string }[]) ?? []
  const lastSent = history.find((h) => h.status === 'sent')
  const lastProcessed = history[0]

  if (row.kind === 'assigned') {
    if (!holds) return { status: 'skipped', reason: 'no longer assigned' }
    // e.g. a bar manager re-set to the same person, or a split bartender re-paired.
    if (lastSent?.kind === 'assigned') return { status: 'skipped', reason: 'already told' }
  } else if (row.kind === 'removed') {
    if (holds) return { status: 'skipped', reason: 'still assigned' }
    if (lastSent?.kind === 'removed') return { status: 'skipped', reason: 'already told' }
    // Signed up and off again before the sign-up email went out: say nothing.
    if (lastProcessed?.kind === 'assigned' && lastProcessed.status === 'skipped') {
      return { status: 'skipped', reason: 'sign-up never announced' }
    }
  } else if (!holds) {
    return { status: 'skipped', reason: 'no longer assigned' }
  }

  const to = await recipientEmail(db, row.employee_id)
  if (!to) return { status: 'skipped', reason: 'no email address' }

  const peopleIds = new Set<string>([row.employee_id, ...assignments.map((a) => a.employee_id)])
  if (row.actor_employee_id) peopleIds.add(row.actor_employee_id)
  const { data: employeeRows } = await db.from('employees').select('id, full_name, phone').in('id', [...peopleIds])
  const employees = new Map(((employeeRows as { id: string; full_name: string; phone: string | null }[]) ?? []).map((e) => [e.id, e]))
  const me = employees.get(row.employee_id)

  // Times: the bartender's own half when they hold only one; the area
  // duties' later start; otherwise the whole evening.
  const eveningStart = new Date((opening ?? closing)!.start_time)
  const eveningEnd = new Date((closing ?? opening)!.end_time)
  let start = eveningStart
  let end = eveningEnd
  let partLabel: string | null = null
  if (row.assignment_role === 'bartender' && mine.length === 1 && opening && closing) {
    const side = mine[0].shift_id === opening.id ? opening : closing
    start = new Date(side.start_time)
    end = new Date(side.end_time)
    partLabel = side === opening ? 'פתיחה' : 'סגירה'
  } else if (row.assignment_role === 'area_manager' || row.assignment_role === 'area_supervisor') {
    if (opening) start = new Date(eveningStart.getTime() + AREA_START_OFFSET_MS)
  }

  const seen = new Set<string>()
  const team: TeamMember[] = []
  for (const a of assignments) {
    if (a.employee_id === row.employee_id) continue
    const key = `${a.employee_id}:${a.assignment_role}`
    if (seen.has(key)) continue
    seen.add(key)
    const e = employees.get(a.employee_id)
    team.push({ name: e?.full_name ?? '—', role: a.assignment_role, phone: e?.phone ?? null })
  }

  let openTaskCount: number | null = null
  if (row.kind === 'reminder' && row.assignment_role === 'bar_manager') {
    const { count } = await db
      .from('weekly_checklist_items')
      .select('id', { count: 'exact', head: true })
      .eq('week_start', row.week_start)
      .eq('completed', false)
    openTaskCount = count ?? 0
  }

  const roleLabel = DUTY_LABELS[row.assignment_role]
  const event: CalendarEvent = {
    uid: `shift-${row.week_start}-${row.assignment_role}-${row.employee_id}@barburg`,
    title: `משמרת ברבורג · ${roleLabel}`,
    description: `${roleLabel}${partLabel ? ` (${partLabel})` : ''}\n${appUrl()}/my-shifts`,
    location: 'ברבורג',
    start,
    end,
  }
  const icsFilename = `barburg-${dayMonthFormatter.format(start).replace(/\D+/g, '-')}.ics`

  const email: ShiftEmail = {
    kind: row.kind,
    appUrl: appUrl(),
    firstName: firstName(me?.full_name ?? ''),
    role: row.assignment_role,
    partLabel,
    dateLabel: dateLabel(start),
    hoursLabel: hoursLabel(start, end),
    actorName: row.actor_employee_id ? (employees.get(row.actor_employee_id)?.full_name ?? null) : null,
    team,
    showAllPhones: row.kind === 'reminder',
    openTaskCount,
    weekStart: row.week_start,
    googleUrl: googleCalendarUrl(event),
    outlookUrl: outlookCalendarUrl(event),
    icsFilename: row.kind === 'assigned' ? icsFilename : null,
  }
  const { subject, html } = renderShiftEmail(email)

  await sendViaResend({
    to,
    bcc: bcc.filter((address) => address.toLowerCase() !== to.toLowerCase()),
    subject,
    html,
    ics:
      row.kind === 'reminder'
        ? null
        : { filename: icsFilename, content: buildIcs(event, row.kind === 'removed'), method: row.kind === 'removed' ? 'CANCEL' : 'PUBLISH' },
  })
  return { status: 'sent' }
}

async function processQueue(db: SupabaseClient) {
  const { data: settings } = await db.from('app_settings').select('shift_emails_enabled, shift_email_bcc').eq('id', true).single()
  const enabled = !!settings?.shift_emails_enabled
  const bcc = ((settings?.shift_email_bcc as string[] | null) ?? []).filter((a) => a.includes('@'))

  const { data } = await db
    .from('shift_email_outbox')
    .select('id, kind, employee_id, week_start, assignment_role, actor_employee_id, attempts, created_at')
    .eq('status', 'pending')
    .order('created_at')
    .limit(BATCH_SIZE)
  // A bar manager re-set is a delete + insert in one transaction (same
  // created_at): handle the removal first, so the sign-up check sees it.
  const rows = ((data as OutboxRow[]) ?? []).sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || (a.kind === 'removed' ? -1 : b.kind === 'removed' ? 1 : 0),
  )

  let sent = 0
  for (const row of rows) {
    let outcome: Outcome
    try {
      outcome = enabled ? await handleRow(db, row, bcc) : { status: 'skipped', reason: 'emails turned off' }
    } catch (err) {
      const attempts = row.attempts + 1
      await db
        .from('shift_email_outbox')
        .update({
          attempts,
          error: err instanceof Error ? err.message : String(err),
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          processed_at: attempts >= MAX_ATTEMPTS ? new Date().toISOString() : null,
        })
        .eq('id', row.id)
      continue
    }
    if (outcome.status === 'sent') sent++
    await db
      .from('shift_email_outbox')
      .update({ status: outcome.status, error: outcome.reason ?? null, processed_at: new Date().toISOString() })
      .eq('id', row.id)
  }
  return { processed: rows.length, sent }
}

// One sample of each email, with made-up names, to the admin's own address.
async function sendSamples(to: string) {
  // Next Thursday, 19:30 Israel time in winter (UTC+2) -- close enough for a sample.
  const start = new Date()
  start.setUTCDate(start.getUTCDate() + ((4 - start.getUTCDay() + 7) % 7 || 7))
  start.setUTCHours(17, 30, 0, 0)
  const end = new Date(start.getTime() + 5 * 60 * 60 * 1000)
  const team: TeamMember[] = [
    { name: 'דנה לוי', role: 'bar_manager', phone: '050-0000000' },
    { name: 'יוסי כהן', role: 'area_supervisor', phone: '050-0000001' },
    { name: 'נועה ברק', role: 'bartender', phone: '050-0000002' },
    { name: 'אורי שגיא', role: 'area_manager', phone: '050-0000003' },
  ]
  const event: CalendarEvent = { uid: `sample-${start.getTime()}@barburg`, title: 'משמרת ברבורג · ברמן/ית (בדיקה)', description: 'מייל בדיקה', location: 'ברבורג', start, end }
  const samples: { kind: EmailKind; role: Duty; actorName: string | null }[] = [
    { kind: 'assigned', role: 'bartender', actorName: null },
    { kind: 'assigned', role: 'area_manager', actorName: 'דנה לוי' },
    { kind: 'removed', role: 'bartender', actorName: null },
    { kind: 'reminder', role: 'bar_manager', actorName: null },
  ]
  for (const sample of samples) {
    const { subject, html } = renderShiftEmail({
      kind: sample.kind,
      appUrl: appUrl(),
      firstName: 'בדיקה',
      role: sample.role,
      partLabel: null,
      dateLabel: dateLabel(start),
      hoursLabel: hoursLabel(start, end),
      actorName: sample.actorName,
      team: team.filter((m) => m.role !== sample.role),
      showAllPhones: sample.kind === 'reminder',
      openTaskCount: sample.kind === 'reminder' ? 3 : null,
      weekStart: '',
      googleUrl: googleCalendarUrl(event),
      outlookUrl: outlookCalendarUrl(event),
      icsFilename: sample.kind === 'assigned' ? 'barburg-test.ics' : null,
    })
    await sendViaResend({
      to,
      bcc: [],
      subject: `[בדיקה] ${subject}`,
      html,
      ics:
        sample.kind === 'reminder'
          ? null
          : { filename: 'barburg-test.ics', content: buildIcs(event, sample.kind === 'removed'), method: sample.kind === 'removed' ? 'CANCEL' : 'PUBLISH' },
    })
  }
  return samples.length
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const configured = !!Deno.env.get('RESEND_API_KEY') && !!Deno.env.get('EMAIL_FROM')

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
    // Leave the queue untouched until sending is set up, rather than
    // burning every row's attempts on a missing key.
    if (!configured) return jsonResponse({ error: 'RESEND_API_KEY / EMAIL_FROM not set' }, 503)
    return jsonResponse(await processQueue(adminClient), 200)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing authorization' }, 401)
  }
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerError } = await callerClient.auth.getUser()
  if (callerError || !callerData?.user) {
    return jsonResponse({ error: 'Invalid session' }, 401)
  }
  const { data: callerAppUser } = await adminClient
    .from('app_users')
    .select('role, status')
    .eq('id', callerData.user.id)
    .single()
  if (!callerAppUser || callerAppUser.status !== 'approved' || callerAppUser.role !== 'administrator') {
    return jsonResponse({ error: 'Only administrators can send test emails' }, 403)
  }
  if (!configured) {
    return jsonResponse({ error: 'שליחת מיילים עדיין לא הוגדרה (חסרים RESEND_API_KEY / EMAIL_FROM)' }, 400)
  }
  if (!callerData.user.email) {
    return jsonResponse({ error: 'No email on your account' }, 400)
  }

  try {
    const count = await sendSamples(callerData.user.email)
    return jsonResponse({ sent: count, to: callerData.user.email }, 200)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})
