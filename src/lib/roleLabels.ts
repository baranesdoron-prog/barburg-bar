import type { AppRole } from '@/lib/types'

export const roleLabels: Record<AppRole, string> = {
  administrator: 'מנהל/ת מערכת',
  shift_manager: 'מנהל/ת בר',
  bartender: 'ברמן/ית',
}

export const ROLES_REQUIRING_EMPLOYEE: AppRole[] = ['bartender', 'shift_manager']

export const ROLES_VIEWING_SHIFTS: AppRole[] = ['shift_manager', 'administrator']

export const ROLES_MANAGING_SHIFTS: AppRole[] = ['administrator', 'shift_manager']
