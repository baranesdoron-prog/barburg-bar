import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { Menu, LogOut, X } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { getNavItems } from '@/lib/navigation'
import { roleLabels } from '@/lib/roleLabels'
import type { AppUser } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function SidebarContent({ appUser, onNavigate }: { appUser: AppUser; onNavigate?: () => void }) {
  const navItems = getNavItems(appUser.role!)

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

export function AppShell({ appUser, session }: { appUser: AppUser; session: Session }) {
  const [drawerOpen, setDrawerOpen] = useState(false)

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
          <Outlet context={{ appUser, session } satisfies { appUser: AppUser; session: Session }} />
        </main>
      </div>
    </div>
  )
}

