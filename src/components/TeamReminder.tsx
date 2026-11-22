import { useState } from 'react'
import { Check, MessageSquare, X } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { C } from '@/lib/designTokens'
import { formatWhatsappNumber, whatsappDigits } from '@/lib/phone'
import { WHATSAPP_GREEN, WHATSAPP_TEXT, WhatsAppIcon } from '@/components/WhatsAppOrderSheet'

// The bartender protocol, which links on to the bar menu.
export const BARTENDER_PROCEDURES_URL =
  'https://docs.google.com/document/d/19cRzgAZq7P-wgCyD-7c4HrbOhGm0zeBvRJLypba3Qkc/edit?tab=t.0'

// The staff bar menu, with the cocktails' step-by-step drawings. Bartenders
// open it after logging in.
export const BAR_MENU_URL = 'https://barburg-bar.netlify.app/bar-menu'

export interface ReminderRecipient {
  employeeId: string
  name: string
  phone: string | undefined
}

function buildMessage({
  dayLabel,
  hoursLabel,
  teamNames,
  barManagerName,
}: {
  dayLabel: string
  hoursLabel: string
  teamNames: string[]
  barManagerName: string | null
}) {
  const team = [
    teamNames.length ? `הצוות שלך: ${teamNames.join(', ')}` : null,
    barManagerName ? `מנהל/ת בר: ${barManagerName}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return [
    'היי! מה קורה?',
    // Hours wrapped in left-to-right isolate marks, so "19:30–0:30" isn't
    // flipped inside the Hebrew line in WhatsApp/SMS.
    `מחכים לך ב${dayLabel} בברבורג${hoursLabel ? `, \u2066${hoursLabel}\u2069` : ''}.`,
    team,
    '',
    'כדי להגיע מוכנים:',
    'תפריט הבר, כולל שלבי הכנה לקוקטיילים:',
    BAR_MENU_URL,
    'נוהל ברמנים:',
    BARTENDER_PROCEDURES_URL,
    '',
    'נתראה בבר!',
  ]
    .filter((line, i, all) => line !== '' || (all[i - 1] !== '' && i > 0))
    .join('\n')
}

// SMS links can carry several numbers (WhatsApp links can't): iOS and
// Android spell it differently.
function smsHref(numbers: string[], body: string) {
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
  return isApple
    ? `sms://open?addresses=${numbers.join(',')}&body=${encodeURIComponent(body)}`
    : `sms:${numbers.join(';')}?body=${encodeURIComponent(body)}`
}

// "שליחת תזכורת לצוות": the message, the bartenders, and a WhatsApp round
// (one chat per tap: phones allow only one per tap) or one SMS to all.
export function TeamReminderSheet({
  shiftIds,
  recipients,
  dayLabel,
  hoursLabel,
  barManagerName,
  senderName,
  onClose,
  onSent,
}: {
  shiftIds: string[]
  recipients: ReminderRecipient[]
  dayLabel: string
  hoursLabel: string
  barManagerName: string | null
  senderName: string | null
  onClose: () => void
  onSent: () => void
}) {
  const reachable = recipients.filter((r) => whatsappDigits(r.phone))
  const [selected, setSelected] = useState<Set<string>>(() => new Set(reachable.map((r) => r.employeeId)))
  const [message, setMessage] = useState(() =>
    buildMessage({ dayLabel, hoursLabel, teamNames: recipients.map((r) => r.name), barManagerName }),
  )
  const [round, setRound] = useState<{ queue: ReminderRecipient[]; done: string[]; skipped: string[] } | null>(null)
  const [finished, setFinished] = useState<{ via: 'whatsapp' | 'sms'; reached: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chosen = reachable.filter((r) => selected.has(r.employeeId))
  const unreachable = recipients.filter((r) => !whatsappDigits(r.phone))

  async function markSent() {
    if (shiftIds.length === 0) return
    const { error: updateError } = await supabase
      .from('shifts')
      .update({ team_reminder_sent_at: new Date().toISOString(), team_reminder_sent_by_name: senderName })
      .in('id', shiftIds)
    if (updateError) setError(updateError.message)
    onSent()
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startRound() {
    if (chosen.length === 0) return
    setRound({ queue: chosen, done: [], skipped: [] })
  }

  function openNext() {
    if (!round) return
    const current = round.queue[round.done.length + round.skipped.length]
    if (!current) return
    const digits = whatsappDigits(current.phone)!
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, '_blank', 'noopener')
    const next = { ...round, done: [...round.done, current.employeeId] }
    setRound(next)
    if (next.done.length + next.skipped.length >= next.queue.length) finishRound(next)
  }

  function skipNext() {
    if (!round) return
    const current = round.queue[round.done.length + round.skipped.length]
    if (!current) return
    const next = { ...round, skipped: [...round.skipped, current.employeeId] }
    setRound(next)
    if (next.done.length + next.skipped.length >= next.queue.length) finishRound(next)
  }

  function finishRound(r: { queue: ReminderRecipient[]; done: string[] }) {
    const reached = r.queue.filter((q) => r.done.includes(q.employeeId)).map((q) => q.name)
    setFinished({ via: 'whatsapp', reached })
    if (reached.length > 0) markSent()
  }

  function sendSms() {
    if (chosen.length === 0) return
    window.location.href = smsHref(
      chosen.map((r) => `+${whatsappDigits(r.phone)}`),
      message,
    )
    setFinished({ via: 'sms', reached: chosen.map((r) => r.name) })
    markSent()
  }

  const current = round ? round.queue[round.done.length + round.skipped.length] : undefined
  const progress = round ? (round.done.length + round.skipped.length) / round.queue.length : 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(32,42,38,.55)' }} onClick={onClose}>
      <div
        dir="rtl"
        className="flex max-h-[92svh] w-full max-w-xl flex-col gap-3.5 overflow-y-auto rounded-t-3xl bg-white px-4 pt-4 pb-6"
        style={{ color: C.text }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-xl font-extrabold">{finished ? 'התזכורת נשלחה' : round ? 'שליחה בוואטסאפ' : 'תזכורת לצוות'}</h2>
            <span className="text-sm" style={{ color: C.textSecondary }}>
              {round && !finished
                ? `${round.done.length} מתוך ${round.queue.length} נשלחו`
                : `${dayLabel} · ברמנים/יות`}
            </span>
          </div>
          <button
            type="button"
            aria-label="סגירה"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full"
            style={{ background: C.subtleBg }}
          >
            <X className="size-5" />
          </button>
        </div>

        {finished ? (
          <>
            <div className="flex size-16 items-center justify-center self-center rounded-full" style={{ background: C.successBg, color: C.success }}>
              <Check className="size-9" />
            </div>
            <p className="text-center" style={{ color: C.textSecondary }}>
              {finished.reached.length
                ? `${finished.reached.join(', ')} ${finished.via === 'sms' ? 'ב־SMS' : 'בוואטסאפ'}.`
                : 'לא נשלח לאף אחד.'}
            </p>
            {unreachable.length > 0 && (
              <p className="rounded-xl p-3 text-sm" style={{ background: C.warningBg, color: '#7A4A0A' }}>
                {unreachable.map((r) => r.name).join(', ')}: אין טלפון בכרטיס העובד/ת, ולכן לא קיבל/ה. אפשר להוסיף טלפון בעמוד
                המשתמשים ולשלוח שוב.
              </p>
            )}
            {error && <p className="text-sm" style={{ color: C.error }}>{error}</p>}
            <button type="button" onClick={onClose} className="h-12 rounded-xl text-base font-bold text-white" style={{ background: C.primary }}>
              סיום
            </button>
          </>
        ) : round ? (
          <>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: C.border }}>
              <div className="h-full" style={{ width: `${progress * 100}%`, background: WHATSAPP_GREEN }} />
            </div>
            <div className="flex flex-col gap-2">
              {round.queue.map((r) => {
                const done = round.done.includes(r.employeeId)
                const skipped = round.skipped.includes(r.employeeId)
                const isNext = current?.employeeId === r.employeeId
                return (
                  <div
                    key={r.employeeId}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                    style={{
                      border: isNext ? `2px solid ${WHATSAPP_GREEN}` : `1px solid ${C.border}`,
                      background: done ? C.subtleBg : C.card,
                      opacity: skipped ? 0.55 : 1,
                    }}
                  >
                    <span className="flex-1 font-bold">{r.name}</span>
                    <span className="text-sm" style={{ color: done ? C.success : C.textSecondary }}>
                      {done ? 'נפתח בוואטסאפ' : skipped ? 'דולג' : isNext ? 'הבא בתור' : ''}
                    </span>
                  </div>
                )
              })}
            </div>
            {current && (
              <>
                <button
                  type="button"
                  onClick={openNext}
                  className="flex h-15 items-center justify-center gap-2.5 rounded-2xl text-lg font-extrabold"
                  style={{ background: WHATSAPP_GREEN, color: WHATSAPP_TEXT }}
                >
                  <WhatsAppIcon className="size-6" />
                  פתיחת וואטסאפ: {current.name}
                </button>
                <button type="button" onClick={skipNext} className="h-11 rounded-xl border text-sm font-semibold" style={{ borderColor: C.border }}>
                  דילוג על {current.name}
                </button>
              </>
            )}
            <p className="text-center text-sm" style={{ color: C.textSecondary }}>
              אחרי השליחה בוואטסאפ חוזרים לכאן, והבא בתור כבר מחכה. הטלפון מאפשר לפתוח צ׳אט אחד בכל לחיצה.
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-bold">למי</span>
              {recipients.length === 0 && (
                <p className="text-sm" style={{ color: C.textSecondary }}>
                  עוד אין ברמנים/יות משובצים לערב הזה.
                </p>
              )}
              {recipients.map((r) => {
                const digits = whatsappDigits(r.phone)
                return (
                  <label
                    key={r.employeeId}
                    className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5"
                    style={{ borderColor: C.border, opacity: digits ? 1 : 0.55 }}
                  >
                    <input
                      type="checkbox"
                      checked={!!digits && selected.has(r.employeeId)}
                      disabled={!digits}
                      onChange={() => toggle(r.employeeId)}
                      className="size-5"
                    />
                    <span className="flex-1 font-bold">{r.name}</span>
                    <span dir="ltr" className="text-sm" style={{ color: digits ? C.textSecondary : '#B03434' }}>
                      {digits ? formatWhatsappNumber(digits) : 'אין טלפון'}
                    </span>
                  </label>
                )
              })}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="team-reminder-message" className="text-sm font-bold">
                ההודעה (אפשר לערוך)
              </label>
              <textarea
                id="team-reminder-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={9}
                className="rounded-2xl rounded-bl-md p-3 text-base leading-relaxed outline-none"
                style={{ background: '#DCF8C6', color: '#111B21' }}
              />
            </div>

            <button
              type="button"
              disabled={chosen.length === 0 || !message.trim()}
              onClick={startRound}
              className="flex h-13 items-center justify-center gap-2 rounded-xl text-base font-extrabold disabled:opacity-50"
              style={{ background: WHATSAPP_GREEN, color: WHATSAPP_TEXT }}
            >
              <WhatsAppIcon className="size-5" />
              וואטסאפ, אחד אחרי השני ({chosen.length})
            </button>
            <button
              type="button"
              disabled={chosen.length === 0 || !message.trim()}
              onClick={sendSms}
              className="flex h-12 items-center justify-center gap-2 rounded-xl border text-base font-bold disabled:opacity-50"
              style={{ borderColor: '#CFC8BD' }}
            >
              <MessageSquare className="size-5" />
              SMS לכולם בבת אחת
            </button>
          </>
        )}
      </div>
    </div>
  )
}
