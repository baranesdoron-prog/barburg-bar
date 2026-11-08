import { useState } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'

import { C } from '@/lib/designTokens'

export const WHATSAPP_GREEN = '#25D366'
// Dark text on WhatsApp green: white on it is too low-contrast to read.
export const WHATSAPP_TEXT = '#073B1E'

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.2a9.8 9.8 0 0 0-8.4 14.9L2.2 21.8l4.8-1.3A9.8 9.8 0 1 0 12 2.2zm0 1.8a8 8 0 1 1-4.2 14.8l-.3-.2-2.8.8.8-2.7-.2-.3A8 8 0 0 1 12 4z"
      />
      <path
        fill="currentColor"
        d="M8.9 7.3c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .6.4l.8 1.9c.1.2.1.4 0 .5l-.5.7c-.1.2-.2.4 0 .6.4.8 1.1 1.5 1.9 1.9.2.1.4.1.5-.1l.7-.8c.2-.2.3-.2.5-.1l1.8.8c.2.1.4.2.4.4 0 .5-.2 1.1-.6 1.5-.5.4-1.2.6-1.9.4a8.6 8.6 0 0 1-5.9-5.9c-.2-.7 0-1.3.3-1.8z"
      />
    </svg>
  )
}

// Supplier phones are free text: a local 05X number gets the country code
// instead of its leading 0, since wa.me wants digits only.
export function whatsappDigits(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('0') ? `972${digits.slice(1)}` : digits
}

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי']
const DEFAULT_DAY = 'רביעי'

function buildMessage(day: string, lines: { name: string; quantity: number }[]) {
  const list = lines.map((l, i) => `${i + 1}. ${l.quantity} ${l.name}`).join('\n')
  return `נשמח להזמין ליום ${day}:\n${list}\nתודה רבה!`
}

// Opens WhatsApp with the supplier's contact and the order written out:
// "נשמח להזמין ליום רביעי:", one numbered line per item, "תודה רבה!".
export function WhatsAppOrderSheet({
  supplierName,
  contactName,
  phone,
  lines,
  isDraft,
  onClose,
  onMarkOrdered,
}: {
  supplierName: string
  contactName: string | null
  phone: string | null
  lines: { name: string; quantity: number }[]
  isDraft: boolean
  onClose: () => void
  onMarkOrdered: () => void
}) {
  const [day, setDay] = useState(DEFAULT_DAY)
  const [message, setMessage] = useState(() => buildMessage(DEFAULT_DAY, lines))
  const [markOrdered, setMarkOrdered] = useState(true)

  function pickDay(next: string) {
    setDay(next)
    // Only the day in the first line changes, so edits elsewhere are kept.
    setMessage((prev) => prev.replace(/^נשמח להזמין ליום [^:\n]*:/, `נשמח להזמין ליום ${next}:`))
  }

  function send() {
    if (!phone) return
    window.open(`https://wa.me/${whatsappDigits(phone)}?text=${encodeURIComponent(message)}`, '_blank', 'noopener')
    if (isDraft && markOrdered) onMarkOrdered()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(32,42,38,.55)' }} onClick={onClose}>
      <div
        dir="rtl"
        className="flex max-h-[92svh] w-full max-w-xl flex-col gap-3.5 overflow-y-auto rounded-t-3xl bg-white px-4 pt-4 pb-6"
        style={{ color: C.text }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold">שליחה לספק בוואטסאפ</h2>
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

        {phone ? (
          <p className="text-sm" style={{ color: C.textSecondary }}>
            אל: {contactName ?? supplierName} · <span dir="ltr">{phone}</span>
          </p>
        ) : (
          <div className="flex flex-col gap-1 rounded-xl p-3 text-sm" style={{ background: C.warningBg, color: '#7A4A0A' }}>
            <span className="font-bold">אין טלפון של איש קשר אצל הספק.</span>
            <Link to="/suppliers" className="font-semibold underline underline-offset-2">
              הוספת טלפון בעמוד הספקים
            </Link>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold">ליום</span>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => pickDay(d)}
                className="h-9 rounded-full border px-3 text-sm font-bold"
                style={
                  d === day
                    ? { background: C.primary, borderColor: C.primary, color: '#fff' }
                    : { background: C.card, borderColor: C.border, color: C.text }
                }
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="whatsapp-message" className="text-sm font-bold">
            ההודעה (אפשר לערוך)
          </label>
          <textarea
            id="whatsapp-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={Math.min(14, lines.length + 3)}
            className="rounded-2xl rounded-bl-md p-3 text-base leading-relaxed outline-none"
            style={{ background: '#DCF8C6', color: '#111B21' }}
          />
        </div>

        {isDraft && (
          <label className="flex items-center gap-2.5 text-base">
            <input type="checkbox" checked={markOrdered} onChange={(e) => setMarkOrdered(e.target.checked)} className="size-5" />
            לסמן את ההזמנה כ"הוזמנה" אחרי השליחה
          </label>
        )}

        <button
          type="button"
          disabled={!phone || !message.trim()}
          onClick={send}
          className="flex h-13 items-center justify-center gap-2 rounded-xl text-lg font-extrabold disabled:opacity-50"
          style={{ background: WHATSAPP_GREEN, color: WHATSAPP_TEXT }}
        >
          <WhatsAppIcon className="size-6" />
          פתיחה בוואטסאפ
        </button>
      </div>
    </div>
  )
}
