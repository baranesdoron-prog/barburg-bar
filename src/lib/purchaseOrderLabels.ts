import type { PurchaseOrderStatus } from '@/lib/types'
import { C } from '@/lib/designTokens'

export const purchaseOrderStatusLabels: Record<PurchaseOrderStatus, string> = {
  draft: 'טיוטה',
  ordered: 'הוזמן',
  received: 'התקבל',
  cancelled: 'בוטל',
}

export const purchaseOrderStatusBadgeClass: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-secondary text-secondary-foreground',
  ordered: 'bg-accent text-accent-foreground',
  received: 'bg-primary text-primary-foreground',
  cancelled: 'bg-secondary text-muted-foreground line-through',
}

// Inline-style tones for the redesigned pages, which use the shared hex
// tokens rather than Tailwind theme classes.
export const purchaseOrderStatusTone: Record<PurchaseOrderStatus, { bg: string; fg: string }> = {
  draft: { bg: C.subtleBg, fg: C.textSecondary },
  ordered: { bg: C.accentLight, fg: C.warning },
  received: { bg: C.successBg, fg: C.success },
  cancelled: { bg: C.subtleBg, fg: C.textMuted },
}

export function formatMoney(amount: number) {
  return `₪${amount.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`
}
