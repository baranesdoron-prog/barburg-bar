import type { EffectiveShiftStatus } from '@/lib/types'

export const effectiveStatusLabels: Record<EffectiveShiftStatus, string> = {
  draft: 'טיוטה',
  published: 'מפורסמת',
  active: 'פעילה כעת',
  waiting_for_closure: 'ממתינה לסגירה',
  completed: 'הושלמה',
  cancelled: 'בוטלה',
  reopened: 'נפתחה מחדש',
}

export const effectiveStatusBadgeClass: Record<EffectiveShiftStatus, string> = {
  draft: 'bg-secondary text-secondary-foreground',
  published: 'bg-accent text-accent-foreground',
  active: 'bg-primary text-primary-foreground',
  waiting_for_closure: 'bg-destructive text-white',
  completed: 'bg-secondary text-secondary-foreground',
  cancelled: 'bg-secondary text-muted-foreground line-through',
  reopened: 'bg-accent text-accent-foreground',
}
