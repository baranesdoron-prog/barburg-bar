import type { NotificationChoiceValue } from '@/components/NotificationChoice'

// "+972 50•••4567"
export function maskPhone(phone: string | null | undefined) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('972') && digits.length === 12) return `0${digits.slice(3, 5)}•••${digits.slice(-4)}`
  return `${phone.slice(0, 4)}•••${phone.slice(-4)}`
}

export function isChoiceValid(value: NotificationChoiceValue, emailEnabled: boolean, whatsappEnabled: boolean) {
  return value.consent && ((emailEnabled && value.email) || (whatsappEnabled && value.whatsapp))
}
