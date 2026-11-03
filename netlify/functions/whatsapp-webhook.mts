// Meta WhatsApp webhook: delivery statuses for messages we sent, and the
// "הסר" (remove me) reply. Configure in Meta as
//   https://<site>/.netlify/functions/whatsapp-webhook
// with WHATSAPP_VERIFY_TOKEN, subscribed to the "messages" field.
//
// Every POST must be signed by Meta (X-Hub-Signature-256, HMAC-SHA256 of
// the raw body with the app secret); anything else is rejected.

import { createHmac, timingSafeEqual } from 'node:crypto'

import { canSend, json, normalizePhone, sendText, serviceClient, whatsappConfig } from '../lib/whatsapp'

const OPT_OUT_WORDS = new Set(['הסר', 'הסרה', 'הסירו', 'stop', 'unsubscribe'])

const OPT_OUT_REPLY =
  'הוסרת מעדכוני WhatsApp של ברבורג ולא תקבל/י מאיתנו עוד הודעות כאן. אפשר לחזור בכל רגע מהפרופיל באפליקציה.'

// Statuses only ever move forward (a late "delivered" can't undo "read").
const STATUS_RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3 }

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export default async (req: Request) => {
  const config = whatsappConfig()

  // Meta's one-time subscription check.
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token') ?? ''
    const challenge = url.searchParams.get('hub.challenge') ?? ''
    if (mode === 'subscribe' && config.verifyToken && safeEqual(token, config.verifyToken)) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    return new Response('Forbidden', { status: 403 })
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const raw = await req.text()
  if (!config.appSecret) {
    console.error('whatsapp-webhook: WHATSAPP_APP_SECRET is not set; rejecting unsigned-verifiable request')
    return new Response('Webhook not configured', { status: 503 })
  }
  const signature = req.headers.get('x-hub-signature-256') ?? ''
  const expected = `sha256=${createHmac('sha256', config.appSecret).update(raw, 'utf8').digest('hex')}`
  if (!safeEqual(signature, expected)) {
    return new Response('Invalid signature', { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const db = serviceClient()
  const now = new Date().toISOString()

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {}

      for (const status of value.statuses ?? []) {
        const { data: row } = await db
          .from('whatsapp_messages')
          .select('id, status')
          .eq('wa_message_id', status.id)
          .maybeSingle()
        if (!row) continue
        const at = status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : now
        if (status.status === 'failed') {
          if (row.status === 'read') continue
          const error = status.errors?.[0] ?? {}
          await db
            .from('whatsapp_messages')
            .update({
              status: 'failed',
              failed_at: at,
              error_code: error.code != null ? String(error.code) : null,
              error: [error.title, error.error_data?.details].filter(Boolean).join(' — ') || 'Delivery failed',
            })
            .eq('id', row.id)
        } else if (status.status in STATUS_RANK && (STATUS_RANK[status.status] ?? 0) > (STATUS_RANK[row.status] ?? -1)) {
          await db
            .from('whatsapp_messages')
            .update({
              status: status.status,
              ...(status.status === 'delivered' ? { delivered_at: at } : {}),
              ...(status.status === 'read' ? { read_at: at } : {}),
            })
            .eq('id', row.id)
        }
      }

      // Replies: only the opt-out word is acted on; everything else is
      // ignored for now.
      for (const message of value.messages ?? []) {
        const text = message?.type === 'text' ? String(message.text?.body ?? '').trim().toLowerCase() : ''
        if (!OPT_OUT_WORDS.has(text)) continue
        const phone = normalizePhone(`+${message.from ?? ''}`)
        if (!phone) continue

        const { data: people } = await db.from('employees').select('id').eq('phone', phone)
        const ids = ((people as { id: string }[]) ?? []).map((p) => p.id)
        if (ids.length > 0) {
          await db.from('employees').update({ notify_whatsapp: false, whatsapp_opted_out_at: now }).in('id', ids)
          // Drop anything still waiting to go to them.
          await db
            .from('whatsapp_messages')
            .update({ status: 'skipped', error: 'opted out by reply' })
            .in('employee_id', ids)
            .eq('status', 'queued')
        }

        if (canSend(config)) {
          const result = await sendText(config, phone, OPT_OUT_REPLY)
          await db.from('whatsapp_messages').insert({
            kind: 'optout_confirm',
            employee_id: ids[0] ?? null,
            to_phone: phone,
            status: result.ok ? 'sent' : 'failed',
            wa_message_id: result.messageId,
            sent_at: result.ok ? now : null,
            failed_at: result.ok ? null : now,
            error_code: result.errorCode,
            error: result.errorMessage,
            attempts: 1,
          })
        }
      }
    }
  }

  await db.from('app_settings').update({ whatsapp_webhook_last_at: now }).eq('id', true)
  return json({ ok: true })
}
