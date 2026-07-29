import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { Menu, LogOut, X } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { getNavItems } from '@/lib/navigation'
import { roleLabels } from '@/lib/roleLabels'
import { useImpersonation } from '@/lib/impersonation'
import type { AppOutletContext } from '@/lib/outletContext'
import type { AppRole, AppUser } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const PREVIEWABLE_ROLES: AppRole[] = ['bartender', 'shift_manager', 'bar_manager', 'viewer']

function SidebarContent({ appUser, onNavigate }: { appUser: AppUser; onNavigate?: () => void }) {
  const { effectiveRole, isPreviewing, startPreview, stopPreview } = useImpersonation()
  const navItems = getNavItems(effectiveRole)

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-2">
        <img src="/logo.png" alt="ברבורג" className="size-10 shrink-0 rounded-full object-cover" />
        <div>
          <p className="text-lg font-semibold">ברבורג</p>
          <p className="text-muted-foreground text-sm">{roleLabels[appUser.role!]}</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )
            }
          >
            <item.icon className="size-5 shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {appUser.role === 'administrator' && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <label className="text-muted-foreground text-xs">תצוגה מקדימה כתפקיד</label>
          <select
            className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
            value={isPreviewing ? effectiveRole : ''}
            onChange={(e) => {
              if (e.target.value) startPreview(e.target.value as AppRole)
              else stopPreview()
            }}
          >
            <option value="">— תצוגה רגילה (מנהל/ת מערכת) —</option>
            {PREVIEWABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {roleLabels[role]}
              </option>
            ))}
          </select>
        </div>
      )}

      <Button
        variant="outline"
        className="justify-start gap-3"
        onClick={() => supabase.auth.signOut()}
      >
        <LogOut className="size-5" />
        התנתקות
      </Button>
    </div>
  )
}

function ImpersonationBanner() {
  const { isPreviewing, effectiveRole, stopPreview } = useImpersonation()

  if (!isPreviewing) return null

  return (
    <button
      onClick={stopPreview}
      className="print:hidden mb-4 w-full rounded-md bg-amber-500/20 px-4 py-2 text-start text-sm font-medium text-amber-900 dark:text-amber-200"
    >
      צופה כעת כ־{roleLabels[effectiveRole]} (תצוגה מקדימה, לחיצה ליציאה)
    </button>
  )
}

export function AppShell({ appUser, session }: { appUser: AppUser; session: Session }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { effectiveRole } = useImpersonation()

  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-64 shrink-0 border-e p-4 md:flex print:hidden">
        <SidebarContent appUser={appUser} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative ms-auto flex h-full w-72 flex-col bg-background p-4 shadow-xl">
            <Button
              variant="ghost"
              size="icon"
              className="self-start"
              onClick={() => setDrawerOpen(false)}
            >
              <X className="size-5" />
            </Button>
            <SidebarContent appUser={appUser} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b p-4 md:hidden print:hidden">
          <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <img src="/logo.png" alt="ברבורג" className="size-8 shrink-0 rounded-full object-cover" />
          <span className="font-semibold">ברבורג</span>
        </header>

        <main className="flex-1 p-4">
          <ImpersonationBanner />
          <Outlet context={{ appUser, session, effectiveRole } satisfies AppOutletContext} />
        </main>
      </div>
    </div>
  )
}

