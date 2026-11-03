import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, CalendarX2, Check, Clock, MessageCircle, Mail, type LucideIcon } from 'lucide-react'
import { C } from '@/lib/designTokens'
import { useAppUserContext } from '@/lib/outletContext'
import { E164, hasActiveChannel, useNotificationPrefs } from '@/hooks/useNotificationPrefs'
import { NotificationChoice, type NotificationChoiceValue } from '@/components/NotificationChoice'
import { isChoiceValid, maskPhone } from '@/lib/notifications'
import { DUTY_ICON, DUTY_ICON_BG } from '@/lib/dutyIcons'
import { shiftAssignmentRoleLabels } from '@/lib/shiftLabels'
import type { ConfirmAssignState } from '@/hooks/useConfirmAssign'

function DetailRow({
  icon: Icon,
  label,
  value,
  last,
  iconBg,
}: {
  icon: LucideIcon
  label: string
  value: string
  last?: boolean
  // Filled tile in the duty's own color (white icon), like the /shifts
  // duty cards -- otherwise a plain white tile.
  iconBg?: string
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3" style={last ? undefined : { borderBottom: `1px solid ${C.border}` }}>
      <div className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px]" style={{ background: iconBg ?? C.card }}>
        <Icon className="size-[18px]" style={{ color: iconBg ? '#fff' : C.primary }} />
      </div>
      <div className="flex flex-col">
        <span className="text-xs" style={{ color: C.textMuted }}>
          {label}
        </span>
        <span className="text-[15px] font-bold" style={{ color: C.text }}>
          {value}
        </span>
      </div>
    </div>
  )
}

export function ConfirmAssignDialog({
  state,
  onApprove,
  onDecline,
}: {
  state: ConfirmAssignState | null
  onApprove: () => void
  onDecline: () => void
}) {
  if (!state) return null
  return <ConfirmAssignDialogBody state={state} onApprove={onApprove} onDecline={onDecline} />
}

function ConfirmAssignDialogBody({
  state,
  onApprove,
  onDecline,
}: {
  state: ConfirmAssignState
  onApprove: () => void
  onDecline: () => void
}) {
  const isAssign = state.action === 'assign'
  const { appUser } = useAppUserContext()
  // Signing up is where we ask how to notify them -- loaded only now, so
  // the (always-mounted) popup costs nothing until it opens.
  const notifications = useNotificationPrefs(appUser.employee_id, isAssign)
  const [choice, setChoice] = useState<NotificationChoiceValue>({ email: false, whatsapp: false, consent: false })
  const [addOther, setAddOther] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { emailEnabled, whatsappEnabled, prefs } = notifications
  const anyChannelOn = emailEnabled || whatsappEnabled
  const phoneValid = E164.test(prefs?.phone ?? '')
  // No channel the admin has on is chosen yet: choosing is required.
  const mustChoose = isAssign && notifications.loaded && anyChannelOn && !!prefs && !hasActiveChannel(notifications)
  // They get one channel; suggest the other, unless they declined before or
  // removed themselves from WhatsApp by replying "הסר".
  const suggest: 'whatsapp' | 'email' | null =
    isAssign && notifications.loaded && prefs && !mustChoose && !prefs.nudgeDismissedAt
      ? emailEnabled && prefs.email && whatsappEnabled && !prefs.whatsapp && !prefs.whatsappOptedOutAt
        ? 'whatsapp'
        : whatsappEnabled && prefs.whatsapp && emailEnabled && !prefs.email
          ? 'email'
          : null
      : null
  const waitingForPrefs = isAssign && !notifications.loaded
  const approveDisabled = saving || waitingForPrefs || (mustChoose && !isChoiceValid(choice, emailEnabled, whatsappEnabled))

  async function handleApprove() {
    setError(null)
    if (mustChoose || (suggest && addOther)) {
      setSaving(true)
      const failure = mustChoose
        ? await notifications.save(choice.email, choice.whatsapp, choice.consent)
        : await notifications.save(prefs!.email || suggest === 'email', prefs!.whatsapp || suggest === 'whatsapp', true)
      setSaving(false)
      if (failure) {
        setError(failure)
        return
      }
    }
    onApprove()
  }

  const roleLabel = shiftAssignmentRoleLabels[state.role]
  const position = state.partLabel ? `${roleLabel} · ${state.partLabel}` : roleLabel

  return (
    <div dir="rtl" className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(32, 42, 38, 0.55)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-assign-title"
        className="flex max-h-[calc(100svh-2rem)] w-full max-w-sm flex-col items-center gap-4 overflow-y-auto rounded-[28px] px-5 pt-7 pb-5"
        style={{ background: C.card, boxShadow: '0 24px 48px rgba(23, 77, 59, 0.22)' }}
      >
        <div
          className="flex size-16 items-center justify-center rounded-full"
          style={{ background: isAssign ? C.successBg : C.errorBg }}
        >
          {isAssign ? (
            <Check className="size-[30px]" strokeWidth={2.6} style={{ color: C.success }} />
          ) : (
            <CalendarX2 className="size-[30px]" style={{ color: C.error }} />
          )}
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
          <h2 id="confirm-assign-title" className="text-[22px] font-extrabold" style={{ color: isAssign ? C.primary : C.text }}>
            {state.title}
          </h2>
          <p className="text-sm" style={{ color: C.textSecondary }}>
            {isAssign ? 'רק לוודא שזו המשמרת הנכונה' : 'המקום שלך יתפנה לעובד/ת אחר/ת'}
          </p>
        </div>

        <div className="flex w-full flex-col rounded-[18px] border" style={{ background: C.subtleBg, borderColor: C.border }}>
          <DetailRow icon={Calendar} label="תאריך" value={state.dateLabel} />
          <DetailRow icon={Clock} label="שעות" value={state.hoursLabel} />
          <DetailRow icon={DUTY_ICON[state.role]} iconBg={DUTY_ICON_BG[state.role]} label="תפקיד" value={position} last />
        </div>

        {mustChoose && (
          <div className="w-full">
            <NotificationChoice
              tone="warning"
              emailEnabled={emailEnabled}
              whatsappEnabled={whatsappEnabled}
              value={choice}
              onChange={setChoice}
              intro="עוד לא בחרת. יש לבחור לפחות אחד כדי להשתבץ."
              whatsappTarget={maskPhone(prefs?.phone)}
              whatsappUnavailableReason={phoneValid ? null : 'צריך מספר טלפון תקין בפרופיל'}
            />
          </div>
        )}

        {suggest && (
          <div className="flex w-full flex-col gap-2.5 rounded-2xl px-3.5 py-3" style={{ background: C.primaryLight }}>
            <div className="flex items-center gap-2.5">
              <div className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px]" style={{ background: C.success }}>
                {suggest === 'whatsapp' ? <MessageCircle className="size-[18px] text-white" /> : <Mail className="size-[18px] text-white" />}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-extrabold" style={{ color: C.primary }}>
                  {suggest === 'whatsapp' ? 'העדכונים שלך מגיעים באימייל' : 'העדכונים שלך מגיעים ב־WhatsApp'}
                </span>
                <span className="text-[13px]" style={{ color: C.primaryHover }}>
                  {suggest === 'whatsapp' ? 'רוצה לקבל אותם גם ב־WhatsApp?' : 'רוצה לקבל אותם גם באימייל?'}
                </span>
              </div>
            </div>
            {(suggest === 'email' || phoneValid) && (
              <label className="flex items-start gap-2.5 text-[13px] leading-snug" style={{ color: C.text }}>
                <input
                  type="checkbox"
                  className="mt-px size-[18px] shrink-0"
                  style={{ accentColor: C.primary }}
                  checked={addOther}
                  onChange={(e) => setAddOther(e.target.checked)}
                />
                <span>
                  {suggest === 'whatsapp' ? (
                    <>
                      כן, הוסיפו WhatsApp למספר <b dir="ltr">{maskPhone(prefs?.phone)}</b>.
                    </>
                  ) : (
                    'כן, שלחו לי גם באימייל.'
                  )}{' '}
                  אני מסכים/ה לקבל שם הודעות על המשמרות שלי.
                </span>
              </label>
            )}
            <div className="flex items-center justify-between text-[13px]">
              <Link to="/profile" className="font-bold underline" style={{ color: C.primary }}>
                לכל הגדרות העדכונים בפרופיל
              </Link>
              <button
                type="button"
                onClick={() => notifications.dismissNudge()}
                className="p-1 font-semibold"
                style={{ color: C.textMuted }}
              >
                לא תודה
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="w-full text-sm" style={{ color: C.error }}>
            {error}
          </p>
        )}

        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={handleApprove}
            disabled={approveDisabled}
            className="h-[50px] rounded-2xl text-base font-bold text-white disabled:opacity-45"
            style={{ background: isAssign ? C.primary : C.error }}
          >
            {isAssign ? 'שבצו אותי' : 'הסירו אותי מהמשמרת'}
          </button>
          <button
            type="button"
            onClick={onDecline}
            className="h-[46px] rounded-2xl border text-[15px]"
            style={{
              background: C.card,
              borderColor: C.border,
              color: isAssign ? C.textSecondary : C.primary,
              fontWeight: isAssign ? 600 : 700,
            }}
          >
            {isAssign ? 'ביטול' : 'אני נשאר/ת'}
          </button>
        </div>
      </div>
    </div>
  )
}
