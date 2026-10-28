import { Calendar, CalendarX2, Check, Clock, UserRound, type LucideIcon } from 'lucide-react'
import { C } from '@/lib/designTokens'
import type { ConfirmAssignState } from '@/hooks/useConfirmAssign'

function DetailRow({
  icon: Icon,
  label,
  value,
  last,
}: {
  icon: LucideIcon
  label: string
  value: string
  last?: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3" style={last ? undefined : { borderBottom: `1px solid ${C.border}` }}>
      <div className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px]" style={{ background: C.card }}>
        <Icon className="size-[18px]" style={{ color: C.primary }} />
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

  const isAssign = state.action === 'assign'
  const position = state.partLabel ? `${state.positionLabel} · ${state.partLabel}` : state.positionLabel

  return (
    <div dir="rtl" className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(32, 42, 38, 0.55)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-assign-title"
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-[28px] px-5 pt-7 pb-5"
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
          <DetailRow icon={UserRound} label="תפקיד" value={position} last />
        </div>

        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={onApprove}
            className="h-[50px] rounded-2xl text-base font-bold text-white"
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
