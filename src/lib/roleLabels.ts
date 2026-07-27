import type { AppRole } from '@/lib/types'

export const roleLabels: Record<AppRole, string> = {
  administrator: 'מנהל/ת מערכת',
  bar_manager: 'מנהל/ת בר',
  shift_manager: 'אחראי/ת משמרת',
  employee: 'עובד/ת',
  viewer: 'צופה',
}

export const ROLES_REQUIRING_EMPLOYEE: AppRole[] = [
  'employee',
  'shift_manager',
  'bar_manager',
]

export const ROLES_VIEWING_SHIFTS: AppRole[] = ['shift_manager', 'bar_manager', 'administrator']

export const ROLES_MANAGING_SHIFTS: AppRole[] = ['bar_manager', 'administrator']
