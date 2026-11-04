// Admin-only API behind the WhatsApp page (/admin/whatsapp): connection
// status, template list, test sends and recent message history.
//
// Every call must carry the caller's Supabase session token; only an
// approved administrator gets through. Secrets never leave this function.

import {
  canSend,
  dateLabel,
  explainError,
  fetchTemplateStatuses,
  firstName,
  hoursLabel,
  isTestNumber,
  json,
  maskPhone,
  normalizePhone,
  phoneNumberInfo,
  sendTemplate,
  serviceClient,
  whatsappConfig,
} from '../lib/whatsapp'

const TEST_SENDS_PER_HOUR = 20

const HELLO_WORLD = { key: 'hello_world', meta_name: 'hello_world', language: 'en_US', param_count: 0 }

interface TemplateRow {
  key: 'registration' | 'reminder' | 'update'
  meta_name: string
  language: string
  param_count: number
  body: string
  status: string
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let db
  try {
    db = serviceClient()
  } catch {
    return json({ error: 'השרת לא מוגדר: חסר המשתנה SUPABASE_SERVICE_ROLE_KEY ב־Netlify (המפתח הסודי מ־Supabase, לא ה־anon key).' }, 500)
  }

  // --- who's calling ---------------------------------------------------
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Missing authorization' }, 401)
  const { data: userData, error: userError } = await db.auth.getUser(token)
  if (userError || !userData?.user) return json({ error: 'Invalid session' }, 401)
  const { data: caller } = await db
    .from('app_users')
    .select('id, role, status, employee_id')
    .eq('id', userData.user.id)
    .single()
  if (!caller || caller.status !== 'approved' || caller.role !== 'administrator') {
    return json({ error: 'לאדמינים בלבד' }, 403)
  }

  let body: Record<string, any>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const config = whatsappConfig()

  // --- status ----------------------------------------------------------
  if (body.action === 'status') {
    let phone: Record<string, unknown> | null = null
    let phoneError: string | null = null
    if (canSend(config)) {
      const res = await phoneNumberInfo(config)
      if (res.ok) {
        phone = {
          display: maskPhone(res.body.display_phone_number),
          verifiedName: res.body.verified_name ?? null,
          qualityRating: res.body.quality_rating ?? null,
          isTestNumber: isTestNumber(res.body.display_phone_number),
        }
      } else {
        phoneError = explainError(res.body?.error?.code != null ? String(res.body.error.code) : null)
      }
    }

    // Keep the local template statuses in step with Meta when the
    // WhatsApp Business Account id is configured.
    let templatesSynced = false
    if (canSend(config) && config.wabaId) {
      const res = await fetchTemplateStatuses(config)
      if (res.ok && Array.isArray(res.body.data)) {
        const { data: local } = await db.from('whatsapp_templates').select('key, meta_name, language')
        for (const row of (local as Pick<TemplateRow, 'key' | 'meta_name' | 'language'>[]) ?? []) {
          const remote = res.body.data.find((t: any) => t.name === row.meta_name && t.language === row.language)
          const status = remote
            ? ({ APPROVED: 'approved', PENDING: 'pending', REJECTED: 'rejected', PAUSED: 'paused', DISABLED: 'paused' } as Record<string, string>)[
                remote.status
              ] ?? 'pending'
            : 'draft'
          await db.from('whatsapp_templates').update({ status }).eq('key', row.key)
        }
        templatesSynced = true
      }
    }

    const [{ data: settings }, { data: templates }] = await Promise.all([
      db.from('app_settings').select('shift_whatsapp_enabled, whatsapp_webhook_last_at').eq('id', true).single(),
      db.from('whatsapp_templates').select('key, meta_name, language, param_count, body, status').order('key'),
    ])

    return json({
      configured: {
        accessToken: !!config.accessToken,
        phoneNumberId: !!config.phoneNumberId,
        verifyToken: !!config.verifyToken,
        apiVersion: !!config.apiVersion,
        appSecret: !!config.appSecret,
        wabaId: !!config.wabaId,
        supabase: true,
      },
      apiVersion: config.apiVersion ?? null,
      phone,
      phoneError,
      // The test number is detected from Meta; anything else is treated
      // as production (real people), which needs explicit confirmation.
      mode: phone ? (phone.isTestNumber ? 'test' : 'live') : null,
      webhookLastAt: settings?.whatsapp_webhook_last_at ?? null,
      automationEnabled: !!settings?.shift_whatsapp_enabled,
      templates: templates ?? [],
      templatesSynced,
    })
  }

  // --- template name / status (when not synced from Meta) ------------
  if (body.action === 'update_template') {
    const key = String(body.key ?? '')
    const patch: Record<string, string> = {}
    if (typeof body.metaName === 'string' && /^[a-z0-9_]{1,512}$/.test(body.metaName)) patch.meta_name = body.metaName
    if (['draft', 'pending', 'approved', 'rejected', 'paused'].includes(body.status)) patch.status = body.status
    if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400)
    const { error } = await db.from('whatsapp_templates').update(patch).eq('key', key)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  // --- values to try a template with ----------------------------------
  if (body.action === 'sample_params') {
    const [{ data: me }, { data: next }] = await Promise.all([
      caller.employee_id
        ? db.from('employees').select('full_name').eq('id', caller.employee_id).single()
        : Promise.resolve({ data: null }),
      db
        .from('shifts')
        .select('start_time, end_time, shift_type, week_start')
        .neq('status', 'cancelled')
        .gt('start_time', new Date().toISOString())
        .order('start_time')
        .limit(2),
    ])
    const rows = (next as { start_time: string; end_time: string; week_start: string }[]) ?? []
    const evening = rows.filter((r) => r.week_start === rows[0]?.week_start)
    const start = evening[0] ? new Date(evening[0].start_time) : new Date()
    const end = evening.length ? new Date(evening[evening.length - 1].end_time) : new Date()
    const name = firstName((me as { full_name: string } | null)?.full_name)
    return json({
      registration: [name, dateLabel(start), hoursLabel(start, end)],
      reminder: [name, hoursLabel(start, end)],
      update: [name, dateLabel(start), `שעות חדשות: ${hoursLabel(start, end)}`],
    })
  }

  // --- test send -------------------------------------------------------
  if (body.action === 'send_test') {
    if (!canSend(config)) return json({ error: 'WhatsApp עדיין לא מוגדר ב־Netlify.' }, 400)

    const to = normalizePhone(String(body.to ?? ''))
    if (!to) return json({ error: 'מספר הטלפון לא תקין.' }, 400)

    // hello_world: Meta's own pre-approved sample template on every new
    // account -- for checking the connection before our templates exist.
    const template =
      body.templateKey === HELLO_WORLD.key
        ? HELLO_WORLD
        : (
            await db
              .from('whatsapp_templates')
              .select('key, meta_name, language, param_count')
              .eq('key', String(body.templateKey ?? ''))
              .single()
          ).data
    if (!template) return json({ error: 'תבנית לא קיימת.' }, 400)

    const params = Array.isArray(body.params) ? body.params.map((p: unknown) => String(p ?? '').trim()) : []
    if (params.length !== template.param_count || params.some((p: string) => !p)) {
      return json({ error: `יש למלא את כל ${template.param_count} הערכים.` }, 400)
    }
    if (params.some((p: string) => /[\n\t]|\s{5,}/.test(p))) {
      return json({ error: 'ערך לא יכול לכלול ירידת שורה, טאב או יותר מ־4 רווחים ברצף (כלל של Meta).' }, 400)
    }

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await db
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('is_test', true)
      .eq('requested_by', caller.id)
      .gte('created_at', since)
    if ((count ?? 0) >= TEST_SENDS_PER_HOUR) {
      return json({ error: `אפשר לשלוח עד ${TEST_SENDS_PER_HOUR} הודעות בדיקה בשעה.` }, 429)
    }

    // Production number: real people. Needs the explicit confirmation from
    // the page, and the recipient's own consent.
    const info = await phoneNumberInfo(config)
    const live = !(info.ok && isTestNumber(info.body.display_phone_number))
    let employeeId: string | null = null
    const { data: recipient } = await db
      .from('employees')
      .select('id, notify_whatsapp')
      .eq('phone', to)
      .limit(1)
      .maybeSingle()
    employeeId = (recipient as { id: string } | null)?.id ?? null
    if (live) {
      if (body.confirmLive !== true) return json({ error: 'confirm_required' }, 409)
      if (!(recipient as { notify_whatsapp: boolean } | null)?.notify_whatsapp) {
        return json({ error: 'במצב ייצור אפשר לשלוח רק למי שבחר/ה בעצמו/ה לקבל עדכונים ב־WhatsApp.' }, 403)
      }
    }

    const { data: logged, error: logError } = await db
      .from('whatsapp_messages')
      .insert({
        kind: 'test',
        is_test: true,
        employee_id: employeeId,
        to_phone: to,
        template_key: template.key,
        params,
        status: 'sending',
        attempts: 1,
        requested_by: caller.id,
      })
      .select('id')
      .single()
    if (logError || !logged) return json({ error: logError?.message ?? 'Could not log the message' }, 500)

    const result = await sendTemplate(config, to, { name: template.meta_name, language: template.language }, params)
    const now = new Date().toISOString()
    await db
      .from('whatsapp_messages')
      .update(
        result.ok
          ? { status: 'sent', wa_message_id: result.messageId, sent_at: now }
          : { status: 'failed', error_code: result.errorCode, error: result.errorMessage, failed_at: now },
      )
      .eq('id', logged.id)

    return json({
      ok: result.ok,
      mode: live ? 'live' : 'test',
      to: maskPhone(to),
      messageId: result.messageId,
      error: result.ok ? null : { code: result.errorCode, explanation: explainError(result.errorCode), details: result.errorMessage },
    })
  }

  // --- history ---------------------------------------------------------
  if (body.action === 'history') {
    const { data, error } = await db
      .from('whatsapp_messages')
      .select('id, kind, template_key, to_phone, is_test, status, error_code, error, created_at, sent_at, employees!whatsapp_messages_employee_id_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(40)
    if (error) return json({ error: error.message }, 500)
    return json({
      messages: ((data as any[]) ?? []).map((m) => ({
        id: m.id,
        kind: m.kind,
        templateKey: m.template_key,
        to: maskPhone(m.to_phone),
        name: m.employees?.full_name ?? null,
        isTest: m.is_test,
        status: m.status,
        error: m.error_code ? { code: m.error_code, explanation: explainError(m.error_code), details: m.error } : null,
        createdAt: m.created_at,
      })),
    })
  }

  return json({ error: 'Unknown action' }, 400)
}
