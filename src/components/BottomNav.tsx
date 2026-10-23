import { Link } from 'react-router-dom'
import { LayoutDashboard, CalendarClock, FileText, Package, User, type LucideIcon } from 'lucide-react'

import { C } from '@/lib/designTokens'
import { useImpersonation } from '@/lib/impersonation'
import { ROLES_MANAGING_SHIFTS } from '@/lib/roleLabels'

const ITEMS: { label: string; icon: LucideIcon; to: string; managersOnly?: boolean }[] = [
  { label: 'דשבורד', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'משמרות', icon: CalendarClock, to: '/shifts' },
  { label: 'דוחות', icon: FileText, to: '/reports' },
  // Same roles as the /inventory/* route guard, so no one sees a tab that
  // would just bounce them back to the dashboard.
  { label: 'מלאי', icon: Package, to: '/inventory/items', managersOnly: true },
  { label: 'הפרופיל שלי', icon: User, to: '/profile' },
]

export function BottomNav({ active }: { active: string }) {
  const { effectiveRole } = useImpersonation()
  const isManager = ROLES_MANAGING_SHIFTS.includes(effectiveRole)
  const items = ITEMS.filter((item) => !item.managersOnly || isManager)

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-around border-t py-2"
      style={{ background: C.card, borderColor: C.border, paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}
    >
      {items.map((item) => {
        const isActive = item.to === active
        return (
          <Link
            key={item.label}
            to={item.to}
            className="flex flex-col items-center gap-0.5 px-2 py-1 text-xs font-medium"
            style={{ color: isActive ? C.primary : C.textMuted }}
          >
            <item.icon className="size-5" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
