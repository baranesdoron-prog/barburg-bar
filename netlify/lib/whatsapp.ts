// Shared by the WhatsApp Netlify functions (netlify/functions/whatsapp-*):
// configuration, the Meta Cloud API calls, phone numbers, Hebrew labels.
// Server-side only -- secrets come from Netlify environment variables and
// are never returned to the browser or logged.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface WhatsAppConfig {
  accessToken: string | undefined
  phoneNumberId: string | undefined
  verifyToken: string | undefined
  apiVersion: string | undefined
  appSecret: string | undefined
  wabaId: string | undefined
}

export function whatsappConfig(): WhatsAppConfig {
  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    apiVersion: process.env.WHATSAPP_API_VERSION,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    wabaId: process.env.WHATSAPP_WABA_ID,
  }
}

export function canSend(config: WhatsAppConfig) {
  return !!(config.accessToken && config.phoneNumberId && config.apiVersion)
}

export function serviceClient(): SupabaseClient {
  // The project address is the same one the app already uses (VITE_SUPABASE_URL).
  // The key is NOT the app's public anon key: it's the secret service-role key,
  // which must never be a VITE_ variable (those are built into the browser app).
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

// ---------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------

// E.164, with Israeli local forms (050-1234567, 972501234567) converted --
// same rules as the database's normalize_il_phone(). Null when it can't
// be a valid number.
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('972')) {
    const national = digits.slice(3).replace(/^0/, '')
    return national.length === 9 ? `+972${national}` : null
  }
  if (digits.startsWith('0') && digits.length === 10) return `+972${digits.slice(1)}`
  if (trimmed.startsWith('+') && digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0')) return `+${digits}`
  return null
}

// "+972 50•••4567" -- enough to recognise, not enough to copy.
export function maskPhone(phone: string | null | undefined) {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 8) return '•••'
  if (digits.startsWith('972')) return `+972 ${digits.slice(3, 5)}•••${digits.slice(-4)}`
  return `+${digits.slice(0, digits.length - 7)}•••${digits.slice(-4)}`
}

// ---------------------------------------------------------------------
// Meta Cloud API
// ---------------------------------------------------------------------

export interface SendResult {
  ok: boolean
  messageId: string | null
  errorCode: string | null
  errorMessage: string | null
}

async function graph(config: WhatsAppConfig, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://graph.facebook.com/${config.apiVersion}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, body: body as Record<string, any> }
}

function toResult(res: { ok: boolean; body: Record<string, any> }): SendResult {
  if (res.ok) {
    return { ok: true, messageId: res.body?.messages?.[0]?.id ?? null, errorCode: null, errorMessage: null }
  }
  const error = res.body?.error ?? {}
  const detail = error.error_data?.details
  return {
    ok: false,
    messageId: null,
    errorCode: error.code != null ? String(error.code) : 'http',
    errorMessage: [error.message, detail].filter(Boolean).join(' — ') || 'Unknown error from Meta',
  }
}

export async function sendTemplate(
  config: WhatsAppConfig,
  to: string,
  template: { name: string; language: string },
  params: string[],
): Promise<SendResult> {
  try {
    return toResult(
      await graph(config, `${config.phoneNumberId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.replace(/\D/g, ''),
          type: 'template',
          template: {
            name: template.name,
            language: { code: template.language },
            components: params.length
              ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
              : [],
          },
        }),
      }),
    )
  } catch (err) {
    return { ok: false, messageId: null, errorCode: 'network', errorMessage: err instanceof Error ? err.message : String(err) }
  }
}

// Free-form text -- only allowed within 24 hours of the person writing to
// us, so it's used just to confirm a "הסר" reply.
export async function sendText(config: WhatsAppConfig, to: string, text: string): Promise<SendResult> {
  try {
    return toResult(
      await graph(config, `${config.phoneNumberId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'text', text: { body: text } }),
      }),
    )
  } catch (err) {
    return { ok: false, messageId: null, errorCode: 'network', errorMessage: err instanceof Error ? err.message : String(err) }
  }
}

export async function phoneNumberInfo(config: WhatsAppConfig) {
  return graph(config, `${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`)
}

export async function fetchTemplateStatuses(config: WhatsAppConfig) {
  return graph(config, `${config.wabaId}/message_templates?fields=name,status,language&limit=100`)
}

// Meta's test numbers are US +1 555 numbers.
export function isTestNumber(displayPhoneNumber: string | undefined) {
  return !!displayPhoneNumber && displayPhoneNumber.replace(/\D/g, '').startsWith('1555')
}

// Errors that won't go away by trying again later.
const PERMANENT_ERRORS = new Set([
  '100', '131008', '131009', '131021', '131026', '131030', '131051',
  '132000', '132001', '132005', '132007', '132012', '132015', '132016', '133010',
])

export function isPermanentError(code: string | null) {
  return !!code && PERMANENT_ERRORS.has(code)
}

// Plain-Hebrew explanation for the admin page.
export function explainError(code: string | null): string {
  switch (code) {
    case '131030':
      return 'המספר אינו ברשימת הנמענים המאושרים של מספר הבדיקה. יש להוסיף אותו ב־Meta (WhatsApp › API Setup › To).'
    case '131026':
      return 'לא ניתן למסור את ההודעה למספר הזה (ייתכן שאין בו WhatsApp).'
    case '132001':
      return 'התבנית לא נמצאה ב־Meta בשם ובשפה האלה, או שעדיין לא אושרה.'
    case '132000':
      return 'מספר הערכים שנשלחו לא תואם את מספר הערכים בתבנית.'
    case '132005':
    case '132007':
      return 'הטקסט של אחד הערכים לא תקין או ארוך מדי.'
    case '132015':
    case '132016':
      return 'התבנית מושהית או מושבתת ב־Meta.'
    case '131047':
      return 'עברו יותר מ־24 שעות מההודעה האחרונה של הנמען, ולכן אפשר לשלוח רק תבנית מאושרת.'
    case '131056':
    case '130429':
      return 'נשלחו יותר מדי הודעות בזמן קצר. כדאי לנסות שוב בעוד כמה דקות.'
    case '190':
      return 'אסימון הגישה (Access token) לא תקין או פג תוקף.'
    case '100':
      return 'אחד הנתונים שנשלחו ל־Meta לא תקין (מספר, שם תבנית או שפה).'
    case 'network':
      return 'לא הצלחנו להתחבר ל־Meta. כדאי לנסות שוב.'
    default:
      return 'Meta דחתה את ההודעה. הפרטים הטכניים מופיעים למטה.'
  }
}

// ---------------------------------------------------------------------
// Hebrew labels (Israel time)
// ---------------------------------------------------------------------

const TZ = 'Asia/Jerusalem'
const weekdayFormatter = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long' })
const dayMonthFormatter = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'numeric' })
const timeFormatter = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function dateLabel(date: Date) {
  return `${weekdayFormatter.format(date)}, ${dayMonthFormatter.format(date)}`
}

export function hoursLabel(start: Date, end: Date) {
  return `${timeFormatter.format(start)}–${timeFormatter.format(end)}`
}

export function firstName(fullName: string | null | undefined) {
  return (fullName ?? '').trim().split(/\s+/)[0] || 'שם'
}

export type Duty = 'bartender' | 'area_manager' | 'area_supervisor' | 'bar_manager'

export const DUTY_LABELS: Record<Duty, string> = {
  bartender: 'ברמן/ית',
  area_manager: 'אחראי/ת מתחם',
  area_supervisor: 'מנהל/ת מתחם',
  bar_manager: 'מנהל/ת בר',
}

// Area manager/supervisor start 15 minutes after the bar opens -- matches
// AREA_SUPERVISOR_HOURS (19:45–00:30) in the app.
const AREA_START_OFFSET_MS = 15 * 60 * 1000

interface ShiftRow {
  id: string
  shift_type: 'opening' | 'closing'
  status: string
  start_time: string
  end_time: string
}

// The hours a person's duty covers that evening: their own half when a
// bartender holds only one side, the area duties' later start, otherwise
// the whole evening. Same rules as the shift emails.
export function dutyTimes(
  opening: ShiftRow | undefined,
  closing: ShiftRow | undefined,
  role: Duty,
  heldShiftIds: string[],
) {
  const eveningStart = new Date((opening ?? closing)!.start_time)
  const eveningEnd = new Date((closing ?? opening)!.end_time)
  if (role === 'bartender' && heldShiftIds.length === 1 && opening && closing) {
    const side = heldShiftIds[0] === opening.id ? opening : closing
    return { start: new Date(side.start_time), end: new Date(side.end_time) }
  }
  if ((role === 'area_manager' || role === 'area_supervisor') && opening) {
    return { start: new Date(eveningStart.getTime() + AREA_START_OFFSET_MS), end: eveningEnd }
  }
  return { start: eveningStart, end: eveningEnd }
}

export type { ShiftRow }
