import type { AppRole } from '@/lib/types'

export const roleLabels: Record<AppRole, string> = {
  administrator: 'מנהל/ת מערכת',
  shift_manager: 'מנהל/ת בר',
  bartender: 'ברמן/ית',
  customer: 'לקוח/ה',
}

// Staff roles: everything except customers. Roles an administrator can
// give through the invite and role pickers (customers sign up themselves).
export const STAFF_ROLES: AppRole[] = ['administrator', 'shift_manager', 'bartender']

// Customer area (news, menu, punchcards): admins only for now, plus the
// customers themselves.
export const ROLES_USING_PUNCHCARDS: AppRole[] = ['administrator', 'customer']

export const ROLES_REQUIRING_EMPLOYEE: AppRole[] = ['bartender', 'shift_manager']

export const ROLES_VIEWING_SHIFTS: AppRole[] = ['shift_manager', 'administrator']

export const ROLES_MANAGING_SHIFTS: AppRole[] = ['administrator', 'shift_manager']

// Everyone who can open the unified allocations view (/shifts) -- managers
// with full edit rights, plus bartenders in self-service-only mode.
export const ROLES_VIEWING_ALLOCATIONS: AppRole[] = ['administrator', 'shift_manager', 'bartender']
