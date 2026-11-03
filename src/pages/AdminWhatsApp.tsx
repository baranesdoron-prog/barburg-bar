import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, MessageCircle, RefreshCw } from 'lucide-react'

import { useAppUserContext } from '@/lib/outletContext'
import { C } from '@/lib/designTokens'

// Admin-only WhatsApp page: connection status, templates, test sends and
// recent message history. Everything goes through the whatsapp-admin
// Netlify function, which re-checks that the caller is an administrator --
// the browser never sees a WhatsApp credential.

type TemplateKey = 'registration' | 'reminder' | 'update'

interface Template {
  key: TemplateKey
  meta_name: string
  language: string
  param_count: number
  body: string
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'paused'
}

interface Status {
  configured: Record<string, boolean>
  apiVersion: string | null
  phone: { display: string; verifiedName: string | null; qualityRating: string | null; isTestNumber: boolean } | null
  phoneError: string | null
  mode: 'test' | 'live' | null
  webhookLastAt: string | null
  automationEnabled: boolean
  templates: Template[]
  templatesSynced: boolean
}

interface HistoryItem {
  id: string
  kind: string
  templateKey: TemplateKey | null
  to: string
  name: string | null
  isTest: boolean
  status: string
  error: { code: string; explanation: string; details: string | null } | null
  createdAt: string
}

interface SendResult {
  ok: boolean
  mode: 'test' | 'live'
  to: string
  messageId: string | null
  error: { code: string | null; explanation: string; details: string | null } | null
}

const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  registration: 'אישור הרשמה למשמרת',
  reminder: 'תזכורת למשמרת',
  update: 'שינוי או ביטול במשמרת',
}

const PARAM_HINTS: Record<TemplateKey, string[]> = {
  registration: ['שם', 'תאריך', 'שעות'],
  reminder: ['שם', 'שעות'],
  update: ['שם', 'תאריך', 'פרטים מעודכנים'],
}

const KIND_LABELS: Record<string, string> = {
  registration: 'אישור הרשמה',
  removal: 'הסרה ממשמרת',
  reminder: 'תזכורת',
  time_change: 'שינוי שעות',
  cancellation: 'ביטול משמרת',
  test: 'בדיקה',
  optout_confirm: 'אישור הסרה מ־WhatsApp',
}

const TEMPLATE_STATUS: Record<Template['status'], { label: string; bg: string; fg: string }> = {
  approved: { label: 'מאושרת', bg: C.successBg, fg: C.success },
  pending: { label: 'ממתינה לאישור Meta', bg: C.warningBg, fg: C.warning },
  draft: { label: 'טיוטה', bg: C.subtleBg, fg: C.textSecondary },
  rejected: { label: 'נדחתה', bg: C.errorBg, fg: C.error },
  paused: { label: 'מושהית', bg: C.errorBg, fg: C.error },
}

const MESSAGE_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  queued: { label: 'בתור', bg: C.subtleBg, fg: C.textSecondary },
  sending: { label: 'נשלח…', bg: C.subtleBg, fg: C.textSecondary },
  sent: { label: 'נשלח', bg: C.subtleBg, fg: C.textSecondary },
  delivered: { label: 'נמסר', bg: C.successBg, fg: C.success },
  read: { label: 'נקרא', bg: C.infoBg, fg: C.info },
  failed: { label: 'נכשל', bg: C.errorBg, fg: C.error },
  skipped: { label: 'דולג', bg: C.subtleBg, fg: C.textMuted },
  unknown: { label: 'לא ידוע', bg: C.warningBg, fg: C.warning },
}

const timeFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })

// Same rules as the server's normalizePhone -- only for the live preview.
function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('972')) {
    const national = digits.slice(3).replace(/^0/, '')
    return national.length === 9 ? `+972${national}` : null
  }
  if (digits.startsWith('0') && digits.length === 10) return `+972${digits.slice(1)}`
  if (input.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0')) return `+${digits}`
  return null
}

function fillTemplate(body: string, params: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`)
}

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: bg, color: fg }}>
      {label}
    </span>
  )
}

function StatusRow({ label, value, ok, last }: { label: string; value: string; ok: boolean | null; last?: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
      style={last ? undefined : { borderBottom: `1px solid ${C.border}` }}
    >
      <span>{label}</span>
      <span className="text-left font-bold" style={{ color: ok === null ? C.text : ok ? C.success : C.error }}>
        {value}
      </span>
    </div>
  )
}

export function AdminWhatsApp() {
  const { session } = useAppUserContext()
  const [status, setStatus] = useState<Status | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const [to, setTo] = useState('')
  const [templateKey, setTemplateKey] = useState<TemplateKey>('registration')
  const [params, setParams] = useState<string[]>(['', '', ''])
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [confirmLive, setConfirmLive] = useState(false)
  const [liveUnderstood, setLiveUnderstood] = useState(false)

  const call = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch('/.netlify/functions/whatsapp-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({ error: `שגיאת שרת (${res.status})` }))
      return { status: res.status, data }
    },
    [session.access_token],
  )

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true)
    setStatusError(null)
    try {
      const { status: code, data } = await call({ action: 'status' })
      if (code !== 200) setStatusError(data.error ?? 'לא הצלחנו לבדוק את החיבור.')
      else setStatus(data as Status)
    } catch {
      setStatusError('לא הצלחנו להגיע לשרת. (באתר המקומי אין פונקציות Netlify.)')
    }
    setLoadingStatus(false)
  }, [call])

  const loadHistory = useCallback(async () => {
    try {
      const { status: code, data } = await call({ action: 'history' })
      if (code === 200) setHistory(data.messages as HistoryItem[])
    } catch {
      // The status panel already reports a server that can't be reached.
    }
  }, [call])

  useEffect(() => {
    loadStatus()
    loadHistory()
  }, [loadStatus, loadHistory])

  const template = status?.templates.find((t) => t.key === templateKey) ?? null
  const paramCount = template?.param_count ?? PARAM_HINTS[templateKey].length
  const normalized = useMemo(() => normalizePhone(to), [to])
  const filledParams = params.slice(0, paramCount)
  const canSendNow =
    !!normalized && filledParams.length === paramCount && filledParams.every((p) => p.trim()) && !sending && !!status?.phone

  async function fillFromShift() {
    const { status: code, data } = await call({ action: 'sample_params' })
    if (code === 200) setParams([...(data[templateKey] as string[]), '', ''].slice(0, 3))
  }

  async function send(confirmed: boolean) {
    setSending(true)
    setSendError(null)
    setResult(null)
    const { status: code, data } = await call({
      action: 'send_test',
      to,
      templateKey,
      params: filledParams,
      confirmLive: confirmed,
    })
    setSending(false)
    setConfirmLive(false)
    setLiveUnderstood(false)
    if (code === 409 && data.error === 'confirm_required') {
      setConfirmLive(true)
      return
    }
    if (code !== 200) {
      setSendError(data.error ?? 'השליחה נכשלה.')
      return
    }
    setResult(data as SendResult)
    loadHistory()
  }

  async function updateTemplate(key: TemplateKey, patch: { metaName?: string; status?: string }) {
    await call({ action: 'update_template', key, ...patch })
    loadStatus()
  }

  const live = status?.mode === 'live'
  const configured = status?.configured ?? {}

  return (
    <div dir="rtl" className="mx-auto flex max-w-xl flex-col gap-4" style={{ color: C.text }}>
      <section className="flex flex-col gap-2.5 rounded-[20px] p-3.5" style={{ background: C.primaryLight }}>
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-[14px]" style={{ background: C.primary }}>
            <MessageCircle className="size-6 text-white" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-[22px] font-extrabold" style={{ color: C.primary }}>
              WhatsApp
            </h1>
            <span className="text-[13px]" style={{ color: C.primaryHover }}>
              בדיקות והיסטוריית הודעות · לאדמינים בלבד
            </span>
          </div>
        </div>
        {status?.mode && (
          <div
            className="flex items-center gap-2 rounded-[14px] border px-3 py-2.5"
            style={live ? { background: C.errorBg, borderColor: '#F3C9C9' } : { background: C.warningBg, borderColor: '#F3D9A8' }}
          >
            <span
              className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-extrabold text-white"
              style={{ background: live ? C.error : C.warning }}
            >
              {live ? 'מצב ייצור' : 'מצב בדיקה'}
            </span>
            <span className="text-[13px]" style={{ color: live ? '#8F2E2E' : '#8A5000' }}>
              {live ? 'מספר אמיתי · הודעות מגיעות לאנשים אמיתיים' : 'מספר הבדיקה של Meta · שליחה רק לנמענים מאושרים'}
            </span>
          </div>
        )}
        <p className="text-[13px]" style={{ color: C.primaryHover }}>
          הודעות אוטומטיות למתנדבים: <b>{status?.automationEnabled ? 'פעילות' : 'כבויות'}</b> ·{' '}
          <Link to="/admin/users" className="underline">
            להגדרות ההתראות
          </Link>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-[17px] font-bold">מצב החיבור</h2>
          <button
            type="button"
            onClick={loadStatus}
            disabled={loadingStatus}
            className="flex items-center gap-1 text-[13px] font-bold disabled:opacity-50"
            style={{ color: C.primary }}
          >
            <RefreshCw className="size-3.5" /> בדיקה מחדש
          </button>
        </div>
        {statusError && (
          <p className="rounded-xl px-3 py-2 text-sm" style={{ background: C.errorBg, color: '#8F2E2E' }}>
            {statusError}
          </p>
        )}
        {status && (
          <div className="flex flex-col rounded-[18px] border" style={{ background: C.card, borderColor: C.border }}>
            <StatusRow label="אסימון גישה (Access token)" value={configured.accessToken ? '✓ מוגדר' : '✗ חסר'} ok={!!configured.accessToken} />
            <StatusRow label="מזהה מספר (Phone number ID)" value={configured.phoneNumberId ? '✓ מוגדר' : '✗ חסר'} ok={!!configured.phoneNumberId} />
            <StatusRow label="גרסת API" value={status.apiVersion ?? '✗ חסר'} ok={status.apiVersion ? null : false} />
            <StatusRow
              label="מספר שולח"
              value={status.phone ? `${status.phone.display}${status.phone.verifiedName ? ` · ${status.phone.verifiedName}` : ''}` : status.phoneError ?? '—'}
              ok={status.phone ? null : false}
            />
            <StatusRow label="Verify token (Webhook)" value={configured.verifyToken ? '✓ מוגדר' : '✗ חסר'} ok={!!configured.verifyToken} />
            <StatusRow label="חתימת Webhook (App secret)" value={configured.appSecret ? '✓ מוגדר' : '✗ חסר'} ok={!!configured.appSecret} />
            <StatusRow
              label="אירוע Webhook אחרון"
              value={status.webhookLastAt ? timeFormatter.format(new Date(status.webhookLastAt)) : 'עוד לא התקבל'}
              ok={status.webhookLastAt ? true : null}
            />
            <StatusRow
              label="סנכרון תבניות מ־Meta (WABA ID)"
              value={configured.wabaId ? (status.templatesSynced ? '✓ מסונכרן' : '✗ נכשל') : 'לא מוגדר (אופציונלי)'}
              ok={configured.wabaId ? status.templatesSynced : null}
              last
            />
          </div>
        )}
        <p className="px-0.5 text-xs" style={{ color: C.textMuted }}>
          הערכים עצמם לעולם לא מוצגים. הבדיקה רצה בשרת.
        </p>
      </section>

      {status && (
        <section className="flex flex-col gap-2">
          <h2 className="px-0.5 text-[17px] font-bold">תבניות</h2>
          <div className="flex flex-col gap-2">
            {status.templates.map((t) => (
              <div key={t.key} className="flex flex-col gap-2 rounded-2xl border p-3" style={{ background: C.card, borderColor: C.border }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-bold">{TEMPLATE_LABELS[t.key]}</span>
                  <Chip {...TEMPLATE_STATUS[t.status]} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: C.textSecondary }}>
                  <span dir="ltr">{t.meta_name}</span>
                  <span>· שפה {t.language} · {t.param_count} ערכים</span>
                </div>
                {!status.templatesSynced && (
                  <label className="flex items-center gap-2 text-[13px]">
                    <span style={{ color: C.textMuted }}>סטטוס (ידני):</span>
                    <select
                      className="h-8 rounded-lg border px-2 text-[13px]"
                      style={{ borderColor: C.border }}
                      value={t.status}
                      onChange={(e) => updateTemplate(t.key, { status: e.target.value })}
                    >
                      {(Object.keys(TEMPLATE_STATUS) as Template['status'][]).map((s) => (
                        <option key={s} value={s}>
                          {TEMPLATE_STATUS[s].label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-[20px] border p-3.5" style={{ background: C.card, borderColor: C.border }}>
        <h2 className="text-[17px] font-bold">שליחת הודעת בדיקה</h2>

        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">טלפון הנמען</span>
          <input
            type="tel"
            dir="ltr"
            className="h-[46px] rounded-[14px] border px-3.5 text-right text-[15px]"
            style={{ borderColor: C.border, background: C.appBg }}
            placeholder="050-1234567"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          {to && (
            <span className="text-xs" style={{ color: normalized ? C.success : C.error }}>
              {normalized ? (
                <>
                  יישלח אל <b dir="ltr">{normalized}</b>
                  {!live && ' · חייב להיות ברשימת הנמענים המאושרים של מספר הבדיקה'}
                </>
              ) : (
                'מספר לא תקין'
              )}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">תבנית</span>
          <select
            className="h-[46px] rounded-[14px] border px-3 text-[15px]"
            style={{ borderColor: C.border, background: C.appBg }}
            value={templateKey}
            onChange={(e) => {
              setTemplateKey(e.target.value as TemplateKey)
              setParams(['', '', ''])
            }}
          >
            {(Object.keys(TEMPLATE_LABELS) as TemplateKey[]).map((key) => (
              <option key={key} value={key}>
                {TEMPLATE_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">ערכי התבנית</span>
          {Array.from({ length: paramCount }, (_, i) => (
            <label key={i} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-xs font-bold" style={{ color: C.textMuted }}>
                {i + 1} · {PARAM_HINTS[templateKey][i]}
              </span>
              <input
                type="text"
                className="h-[42px] min-w-0 flex-1 rounded-xl border px-3 text-[15px]"
                style={{ borderColor: C.border, background: C.appBg }}
                value={params[i] ?? ''}
                onChange={(e) => setParams((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={fillFromShift}
            className="h-8 self-start rounded-[10px] px-3 text-[13px] font-bold"
            style={{ background: C.subtleBg, color: C.primary }}
          >
            מילוי מהמשמרת הקרובה
          </button>
        </div>

        {template && (
          <div className="flex flex-col gap-1.5 rounded-2xl p-3.5" style={{ background: '#E9E1D6' }}>
            <span className="text-xs" style={{ color: C.textSecondary }}>
              תצוגה מקדימה
            </span>
            <div className="max-w-[270px] self-start rounded-xl rounded-bl-sm bg-white px-3 py-2.5 text-sm leading-relaxed whitespace-pre-line shadow-sm">
              {fillTemplate(template.body, filledParams)}
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={!canSendNow}
          onClick={() => (live ? setConfirmLive(true) : send(false))}
          className="h-[50px] rounded-2xl text-base font-bold text-white disabled:opacity-45"
          style={{ background: live ? C.error : C.primary }}
        >
          {sending ? 'שולח…' : live ? 'שליחת הודעה אמיתית' : 'שליחת הודעת בדיקה'}
        </button>
        {sendError && (
          <p className="text-sm" style={{ color: C.error }}>
            {sendError}
          </p>
        )}
      </section>

      {result && (
        <section className="flex flex-col gap-2">
          <h2 className="px-0.5 text-[17px] font-bold">תוצאת השליחה</h2>
          {result.ok ? (
            <div className="flex flex-col gap-1 rounded-2xl border px-3.5 py-3" style={{ background: C.successBg, borderColor: '#BEE6CF' }}>
              <span className="text-[15px] font-extrabold" style={{ color: C.success }}>
                ✓ התקבל ע״י Meta · נשלח אל <span dir="ltr">{result.to}</span>
              </span>
              <span className="text-[13px] break-all" style={{ color: C.primaryHover }}>
                מזהה הודעה: <span dir="ltr">{result.messageId}</span>
              </span>
              <span className="text-xs" style={{ color: C.primaryHover }}>
                המסירה בפועל תתעדכן למטה כשה־Webhook ידווח.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1 rounded-2xl border px-3.5 py-3" style={{ background: C.errorBg, borderColor: '#F3C9C9' }}>
              <span className="text-[15px] font-extrabold" style={{ color: C.error }}>
                ✗ השליחה נכשלה
              </span>
              <span className="text-[13px]" style={{ color: '#8F2E2E' }}>
                {result.error?.explanation}
              </span>
              <details className="text-xs" style={{ color: '#8F2E2E' }}>
                <summary className="cursor-pointer font-bold">פרטים טכניים</summary>
                <span dir="ltr">
                  code {result.error?.code} · {result.error?.details}
                </span>
              </details>
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2 pb-4">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-[17px] font-bold">הודעות אחרונות</h2>
          <button type="button" onClick={loadHistory} className="flex items-center gap-1 text-[13px] font-bold" style={{ color: C.primary }}>
            <RefreshCw className="size-3.5" /> רענון
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-sm" style={{ color: C.textMuted }}>
            עדיין אין הודעות.
          </p>
        ) : (
          <div className="flex flex-col rounded-[18px] border" style={{ background: C.card, borderColor: C.border }}>
            {history.map((m, i) => (
              <div
                key={m.id}
                className="flex flex-col gap-1 px-3.5 py-2.5"
                style={i === history.length - 1 ? undefined : { borderBottom: `1px solid ${C.border}` }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-bold">
                      {m.templateKey ? TEMPLATE_LABELS[m.templateKey] : KIND_LABELS[m.kind] ?? m.kind}
                      {m.isTest ? ' · בדיקה' : m.kind !== 'test' && m.templateKey ? ` · ${KIND_LABELS[m.kind] ?? ''}` : ''}
                    </span>
                    <span className="text-xs" style={{ color: C.textMuted }}>
                      {m.name ? `${m.name} · ` : ''}
                      <span dir="ltr">{m.to}</span> · {timeFormatter.format(new Date(m.createdAt))}
                    </span>
                  </div>
                  <Chip {...(MESSAGE_STATUS[m.status] ?? MESSAGE_STATUS.unknown)} />
                </div>
                {m.error && (
                  <span className="text-xs" style={{ color: C.error }}>
                    {m.error.explanation}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {confirmLive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(32, 42, 38, 0.55)' }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-confirm-title"
            className="flex w-full max-w-sm flex-col gap-3.5 rounded-[28px] bg-white px-5 pt-6 pb-5"
          >
            <div className="flex size-[60px] items-center justify-center self-center rounded-full" style={{ background: C.errorBg }}>
              <AlertTriangle className="size-7" style={{ color: C.error }} />
            </div>
            <div className="text-center">
              <h2 id="live-confirm-title" className="text-[21px] font-extrabold">
                לשלוח הודעה אמיתית?
              </h2>
              <p className="mt-1 text-sm" style={{ color: C.textSecondary }}>
                זו לא בדיקה. ההודעה תגיע לטלפון של הנמען, ונשלחת רק למי שבחר/ה בעצמו/ה ב־WhatsApp.
              </p>
            </div>
            <div className="flex flex-col rounded-2xl border" style={{ background: C.subtleBg, borderColor: C.border }}>
              <StatusRow label="נמען" value={normalized ?? ''} ok={null} />
              <StatusRow label="תבנית" value={TEMPLATE_LABELS[templateKey]} ok={null} last />
            </div>
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                className="size-5"
                style={{ accentColor: C.error }}
                checked={liveUnderstood}
                onChange={(e) => setLiveUnderstood(e.target.checked)}
              />
              הבנתי, זו הודעה אמיתית
            </label>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={!liveUnderstood || sending}
                onClick={() => send(true)}
                className="h-[50px] rounded-2xl text-base font-bold text-white disabled:opacity-45"
                style={{ background: C.error }}
              >
                שליחה
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmLive(false)
                  setLiveUnderstood(false)
                }}
                className="h-[46px] rounded-2xl border text-[15px] font-semibold"
                style={{ borderColor: C.border, color: C.textSecondary }}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
