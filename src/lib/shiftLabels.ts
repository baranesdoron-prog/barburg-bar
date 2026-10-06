import type { AttendanceStatus, EffectiveShiftStatus, ShiftAssignmentRole, ShiftType } from '@/lib/types'

export const shiftTypeLabels: Record<ShiftType, string> = {
  opening: 'פתיחה',
  closing: 'סגירה',
}

export const shiftAssignmentRoleLabels: Record<ShiftAssignmentRole, string> = {
  bartender: 'ברמן/ית',
  area_manager: 'אחראי/ת מתחם',
  area_supervisor: 'מנהל/ת מתחם',
}

// shift_reports.snapshot is a frozen historical dump and can still hold
// pre-migration free text, so this must tolerate unrecognized values.
export function shiftTypeLabel(value: string): string {
  return shiftTypeLabels[value as ShiftType] ?? value
}

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

export const attendanceStatusLabels: Record<AttendanceStatus, string> = {
  present: 'נוכח/ת',
  absent: 'נעדר/ת',
  late: 'איחור',
}
