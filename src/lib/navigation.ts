import {
  LayoutDashboard,
  Calendar,
  CalendarClock,
  CheckSquare,
  Package,
  Truck,
  ClipboardList,
  FileText,
  User,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'

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
    items.push({ to: '/reports', label: 'דוחות', icon: FileText })
    items.push({ to: '/weekly-checklist', label: 'רשימת משימות שבועית', icon: CheckSquare })
  }

  if (ROLES_REQUIRING_EMPLOYEE.includes(role)) {
    items.push({ to: '/my-shifts', label: 'המשמרות שלי', icon: Calendar })
  }

  if (ROLES_MANAGING_SHIFTS.includes(role)) {
    items.push({ to: '/inventory/items', label: 'פריטי מלאי', icon: Package })
    items.push({ to: '/suppliers', label: 'ספקים', icon: Truck })
    items.push({ to: '/purchase-orders', label: 'הזמנות רכש', icon: ClipboardList })
  }

  items.push({ to: '/profile', label: 'הפרופיל שלי', icon: User })

  if (role === 'administrator') {
    items.push({ to: '/admin/approvals', label: 'בקשות הצטרפות', icon: UserCheck })
    items.push({ to: '/admin/users', label: 'משתמשים', icon: Users })
  }

  return items
}
