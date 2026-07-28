import { LayoutDashboard, Calendar, CalendarClock, Package, User, UserCheck, type LucideIcon } from 'lucide-react'

import type { AppRole } from '@/lib/types'
import { ROLES_MANAGING_SHIFTS, ROLES_REQUIRING_EMPLOYEE, ROLES_VIEWING_SHIFTS } from '@/lib/roleLabels'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export function getNavItems(role: AppRole): NavItem[] {
  const items: NavItem[] = [{ to: '/', label: 'לוח בקרה', icon: LayoutDashboard }]

  if (ROLES_VIEWING_SHIFTS.includes(role)) {
    items.push({ to: '/shifts', label: 'משמרות', icon: CalendarClock })
  }

  if (ROLES_REQUIRING_EMPLOYEE.includes(role)) {
    items.push({ to: '/my-shifts', label: 'המשמרות שלי', icon: Calendar })
  }

  if (ROLES_MANAGING_SHIFTS.includes(role)) {
    items.push({ to: '/inventory/items', label: 'פריטי מלאי', icon: Package })
  }

  items.push({ to: '/profile', label: 'הפרופיל שלי', icon: User })

  if (role === 'administrator') {
    items.push({ to: '/admin/approvals', label: 'בקשות הצטרפות', icon: UserCheck })
  }

  return items
}
