import type { PurchaseOrderStatus } from '@/lib/types'

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
