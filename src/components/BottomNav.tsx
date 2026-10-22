import { Link } from 'react-router-dom'
import { LayoutDashboard, CalendarClock, FileText, User, type LucideIcon } from 'lucide-react'

import { C } from '@/lib/designTokens'

const ITEMS: { label: string; icon: LucideIcon; to: string }[] = [
  { label: 'דשבורד', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'משמרות', icon: CalendarClock, to: '/shifts' },
  { label: 'דוחות', icon: FileText, to: '/reports' },
  { label: 'הפרופיל שלי', icon: User, to: '/profile' },
]

export function BottomNav({ active }: { active: string }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-around border-t py-2"
      style={{ background: C.card, borderColor: C.border, paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}
    >
      {ITEMS.map((item) => {
        const isActive = item.to === active
        return (
          <Link
            key={item.label}
            to={item.to}
            className="flex flex-col items-center gap-0.5 px-3 py-1 text-xs font-medium"
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
