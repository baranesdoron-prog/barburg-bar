import { C } from '@/lib/designTokens'

export interface NotificationChoiceValue {
  email: boolean
  whatsapp: boolean
  consent: boolean
}

// "How do you want to get notified about shifts?" -- only the channels
// the admin has switched on, plus the consent tick the user must give
// themselves. Shared by the sign-up page, the shift sign-up popup and the
// profile page.
export function NotificationChoice({
  emailEnabled,
  whatsappEnabled,
  value,
  onChange,
  whatsappTarget,
  whatsappUnavailableReason,
  tone = 'primary',
  intro,
  showConsent = true,
}: {
  emailEnabled: boolean
  whatsappEnabled: boolean
  value: NotificationChoiceValue
  onChange: (value: NotificationChoiceValue) => void
  // Shown next to WhatsApp, e.g. the masked phone number.
  whatsappTarget?: string | null
  // Set when WhatsApp can't be chosen (no valid phone number yet).
  whatsappUnavailableReason?: string | null
  tone?: 'primary' | 'warning'
  intro?: string
  showConsent?: boolean
}) {
  const accent = tone === 'warning' ? { border: '#E9A23B', bg: '#FFF7EA', text: '#8A5000', item: '#F3D9A8' } : { border: C.primary, bg: C.primaryLight, text: C.primary, item: '#BEE6CF' }

  const optionClass = 'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[15px] font-bold'

  return (
    <fieldset className="m-0 flex flex-col gap-2.5 rounded-2xl border-2 p-3.5" style={{ borderColor: accent.border, background: accent.bg }}>
      <legend className="px-1.5 text-[15px] font-extrabold" style={{ color: accent.text }}>
        איך תרצה/י לקבל עדכונים על משמרות?
      </legend>
      <span className="text-[13px]" style={{ color: accent.text }}>
        {intro ?? 'שיבוץ, הסרה, ביטול או שינוי במשמרת, ותזכורת לפני המשמרת. יש לבחור לפחות אחד.'}
      </span>

      {emailEnabled && (
        <label className={optionClass} style={{ background: C.card, borderColor: accent.item, color: C.text }}>
          <input
            type="checkbox"
            className="size-5 shrink-0"
            style={{ accentColor: C.primary }}
            checked={value.email}
            onChange={(e) => onChange({ ...value, email: e.target.checked })}
          />
          באימייל
        </label>
      )}

      {whatsappEnabled && (
        <label
          className={optionClass}
          style={{ background: C.card, borderColor: accent.item, color: C.text, opacity: whatsappUnavailableReason ? 0.6 : 1 }}
        >
          <input
            type="checkbox"
            className="size-5 shrink-0"
            style={{ accentColor: C.primary }}
            checked={value.whatsapp}
            disabled={!!whatsappUnavailableReason}
            onChange={(e) => onChange({ ...value, whatsapp: e.target.checked })}
          />
          <span className="flex flex-col">
            <span>
              ב־WhatsApp{' '}
              {whatsappTarget && (
                <span dir={/^[+\d]/.test(whatsappTarget) ? 'ltr' : undefined} className="text-[13px] font-medium" style={{ color: C.textMuted }}>
                  {whatsappTarget}
                </span>
              )}
            </span>
            {whatsappUnavailableReason && (
              <span className="text-xs font-medium" style={{ color: C.textMuted }}>
                {whatsappUnavailableReason}
              </span>
            )}
          </span>
        </label>
      )}

      {showConsent && (
        <label className="flex items-start gap-2.5 text-[13px] leading-snug" style={{ color: C.text }}>
          <input
            type="checkbox"
            className="mt-px size-[18px] shrink-0"
            style={{ accentColor: C.primary }}
            checked={value.consent}
            onChange={(e) => onChange({ ...value, consent: e.target.checked })}
          />
          <span>
            אני מסכים/ה לקבל מברבורג הודעות על המשמרות שלי בערוצים שבחרתי.
            {whatsappEnabled && ' אפשר להפסיק בכל רגע בפרופיל, או להשיב "הסר" ב־WhatsApp.'}
          </span>
        </label>
      )}
    </fieldset>
  )
}
