// Sends the queued WhatsApp shift notifications (whatsapp_messages, queued
// by the database triggers of migration 103). Runs every minute.
//
// Each message is re-checked against the shifts as they are now before
// sending -- a sign-up undone a minute later, a bar manager re-set to the
// same person, a cancelled evening -- and sent with the matching approved
// template. Failures are retried with increasing delays; errors that
// won't go away (bad number, unknown template) fail right away.

import {
  canSend,
  dateLabel,
  dutyTimes,
  firstName,
  hoursLabel,
  isPermanentError,
  sendTemplate,
  serviceClient,
  whatsappConfig,
  type Duty,
  type ShiftRow,
} from '../lib/whatsapp'

export const config = { schedule: '* * * * *' }

const BATCH_SIZE = 25
const MAX_ATTEMPTS = 5
const RETRY_DELAYS_MIN = [1, 5, 30, 120, 360]
// A message stuck in 'sending' this long (the function died mid-send) is
// marked 'unknown' rather than retried: Meta may already have delivered it.
const STUCK_AFTER_MS = 15 * 60 * 1000

type Kind = 'registration' | 'removal' | 'reminder' | 'time_change' | 'cancellation'

interface MessageRow {
  id: string
  kind: Kind
  employee_id: string | null
  week_start: string | null
  assignment_role: Duty | null
  actor_employee_id: string | null
  attempts: number
}

interface Outcome {
  status: 'sent' | 'skipped' | 'failed' | 'retry'
  reason?: string
  errorCode?: string | null
  messageId?: string | null
  toPhone?: string
  templateKey?: string
  params?: string[]
}

type Db = ReturnType<typeof serviceClient>

async function handle(db: Db, row: MessageRow, templates: Map<string, { meta_name: string; language: string }>): Promise<Outcome> {
  if (!row.employee_id || !row.week_start || !row.assignment_role) return { status: 'skipped', reason: 'incomplete row' }

  const { data: person } = await db
    .from('employees')
    .select('full_name, phone, notify_whatsapp')
    .eq('id', row.employee_id)
    .single()
  if (!person?.notify_whatsapp) return { status: 'skipped', reason: 'no WhatsApp consent' }
  if (!/^\+[1-9][0-9]{7,14}$/.test(person.phone ?? '')) return { status: 'failed', reason: 'invalid phone number' }

  const { data: shiftRows } = await db
    .from('shifts')
    .select('id, shift_type, status, start_time, end_time')
    .eq('week_start', row.week_start)
  // Prefer the non-cancelled instance per type, as the app does.
  const byType: Partial<Record<'opening' | 'closing', ShiftRow>> = {}
  for (const s of (shiftRows as ShiftRow[]) ?? []) {
    const existing = byType[s.shift_type]
    if (!existing || existing.status === 'cancelled') byType[s.shift_type] = s
  }
  const opening = byType.opening
  const closing = byType.closing
  if (!opening && !closing) return { status: 'skipped', reason: 'no shifts that week' }
  const all = [opening, closing].filter((s): s is ShiftRow => !!s)
  const active = all.filter((s) => s.status !== 'cancelled')

  const { data: assignmentRows } = await db
    .from('shift_assignments')
    .select('shift_id, employee_id, assignment_role')
    .in('shift_id', (row.kind === 'cancellation' ? all : active).map((s) => s.id))
  const mine = ((assignmentRows as { shift_id: string; employee_id: string; assignment_role: Duty }[]) ?? []).filter(
    (a) => a.employee_id === row.employee_id && a.assignment_role === row.assignment_role,
  )
  const holds = mine.length > 0

  // What this person was last told about this evening+duty.
  const { data: historyRows } = await db
    .from('whatsapp_messages')
    .select('kind, status')
    .eq('employee_id', row.employee_id)
    .eq('week_start', row.week_start)
    .eq('assignment_role', row.assignment_role)
    .in('kind', ['registration', 'removal'])
    .in('status', ['sent', 'delivered', 'read', 'skipped'])
    .order('updated_at', { ascending: false })
    .limit(20)
  const history = (historyRows as { kind: Kind; status: string }[]) ?? []
  const lastSent = history.find((h) => h.status !== 'skipped')
  const lastProcessed = history[0]

  const eveningStart = new Date((opening ?? closing)!.start_time)
  switch (row.kind) {
    case 'registration':
      if (!holds) return { status: 'skipped', reason: 'no longer assigned' }
      if (lastSent?.kind === 'registration') return { status: 'skipped', reason: 'already told' }
      break
    case 'removal':
      if (holds) return { status: 'skipped', reason: 'still assigned' }
      if (lastSent?.kind === 'removal') return { status: 'skipped', reason: 'already told' }
      if (lastProcessed?.kind === 'registration' && lastProcessed.status === 'skipped') {
        return { status: 'skipped', reason: 'sign-up never announced' }
      }
      break
    case 'reminder':
    case 'time_change':
      if (!holds || active.length === 0) return { status: 'skipped', reason: 'not assigned or evening cancelled' }
      if (eveningStart.getTime() < Date.now()) return { status: 'skipped', reason: 'evening already started' }
      break
    case 'cancellation':
      if (active.length > 0) return { status: 'skipped', reason: 'evening not cancelled' }
      if (!holds) return { status: 'skipped', reason: 'was not assigned' }
      break
  }

  const { start, end } = dutyTimes(
    opening,
    closing,
    row.assignment_role,
    mine.map((a) => a.shift_id),
  )
  const name = firstName(person.full_name)
  const date = dateLabel(start)
  const hours = hoursLabel(start, end)

  let actorName: string | null = null
  if (row.actor_employee_id) {
    const { data: actor } = await db.from('employees').select('full_name').eq('id', row.actor_employee_id).single()
    actorName = actor?.full_name ?? null
  }

  let templateKey: 'registration' | 'reminder' | 'update'
  let params: string[]
  if (row.kind === 'registration') {
    templateKey = 'registration'
    params = [name, date, hours]
  } else if (row.kind === 'reminder') {
    templateKey = 'reminder'
    params = [name, hours]
  } else {
    templateKey = 'update'
    const details =
      row.kind === 'removal'
        ? actorName
          ? `${actorName} הסיר/ה אותך מהמשמרת`
          : 'הוסרת מהמשמרת'
        : row.kind === 'cancellation'
          ? 'המשמרת בוטלה'
          : `שעות חדשות: ${hours}`
    params = [name, date, details]
  }

  const template = templates.get(templateKey)
  if (!template) return { status: 'failed', reason: `template ${templateKey} missing` }

  const result = await sendTemplate(whatsappConfig(), person.phone!, { name: template.meta_name, language: template.language }, params)
  if (result.ok) {
    return { status: 'sent', messageId: result.messageId, toPhone: person.phone!, templateKey, params }
  }
  return {
    status: isPermanentError(result.errorCode) ? 'failed' : 'retry',
    reason: result.errorMessage ?? 'send failed',
    errorCode: result.errorCode,
    toPhone: person.phone!,
    templateKey,
    params,
  }
}

export default async () => {
  const config = whatsappConfig()
  if (!canSend(config)) return new Response('WhatsApp not configured')

  const db = serviceClient()
  const { data: settings } = await db.from('app_settings').select('shift_whatsapp_enabled').eq('id', true).single()

  if (!settings?.shift_whatsapp_enabled) {
    // Switched off by the admin: whatever was still waiting won't go out.
    await db
      .from('whatsapp_messages')
      .update({ status: 'skipped', error: 'WhatsApp notifications turned off' })
      .eq('status', 'queued')
      .eq('is_test', false)
    return new Response('WhatsApp notifications are off')
  }

  await db.rpc('enqueue_shift_reminders')

  await db
    .from('whatsapp_messages')
    .update({ status: 'unknown', error: 'Send was interrupted; Meta may or may not have received it' })
    .eq('status', 'sending')
    .eq('is_test', false)
    .lt('updated_at', new Date(Date.now() - STUCK_AFTER_MS).toISOString())

  const { data: templateRows } = await db.from('whatsapp_templates').select('key, meta_name, language')
  const templates = new Map(
    ((templateRows as { key: string; meta_name: string; language: string }[]) ?? []).map((t) => [t.key, t]),
  )

  const { data: claimed, error } = await db.rpc('claim_whatsapp_messages', { p_limit: BATCH_SIZE })
  if (error) {
    console.error('whatsapp-dispatch: claim failed', error.message)
    return new Response('claim failed', { status: 500 })
  }

  let sent = 0
  for (const row of (claimed as MessageRow[]) ?? []) {
    let outcome: Outcome
    try {
      outcome = await handle(db, row, templates)
    } catch (err) {
      outcome = { status: 'retry', reason: err instanceof Error ? err.message : String(err) }
    }

    const now = new Date()
    const common = {
      to_phone: outcome.toPhone ?? null,
      template_key: outcome.templateKey ?? null,
      params: outcome.params ?? null,
    }
    if (outcome.status === 'sent') {
      sent++
      await db
        .from('whatsapp_messages')
        .update({ ...common, status: 'sent', wa_message_id: outcome.messageId, sent_at: now.toISOString(), error: null, error_code: null })
        .eq('id', row.id)
    } else if (outcome.status === 'retry' && row.attempts < MAX_ATTEMPTS) {
      const delay = RETRY_DELAYS_MIN[Math.min(row.attempts - 1, RETRY_DELAYS_MIN.length - 1)]
      await db
        .from('whatsapp_messages')
        .update({
          ...common,
          status: 'queued',
          next_attempt_at: new Date(now.getTime() + delay * 60 * 1000).toISOString(),
          error: outcome.reason ?? null,
          error_code: outcome.errorCode ?? null,
        })
        .eq('id', row.id)
    } else {
      const failed = outcome.status === 'failed' || outcome.status === 'retry'
      await db
        .from('whatsapp_messages')
        .update({
          ...common,
          status: failed ? 'failed' : 'skipped',
          failed_at: failed ? now.toISOString() : null,
          error: outcome.reason ?? null,
          error_code: outcome.errorCode ?? null,
        })
        .eq('id', row.id)
    }
  }

  return new Response(JSON.stringify({ processed: (claimed as unknown[] | null)?.length ?? 0, sent }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
