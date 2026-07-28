import { Navigate, Outlet, Route, Routes } from 'react-router-dom'

import { useAppUser } from '@/hooks/useAppUser'
import { useAppUserContext, type AppOutletContext } from '@/lib/outletContext'
import type { AppRole } from '@/lib/types'
import { ROLES_MANAGING_SHIFTS, ROLES_VIEWING_SHIFTS } from '@/lib/roleLabels'
import { AppShell } from '@/components/AppShell'
import { SignUp } from '@/pages/SignUp'
import { Login } from '@/pages/Login'
import { PendingApproval } from '@/pages/PendingApproval'
import { Dashboard } from '@/pages/Dashboard'
import { MyShifts } from '@/pages/MyShifts'
import { Profile } from '@/pages/Profile'
import { AdminApprovals } from '@/pages/AdminApprovals'
import { Shifts } from '@/pages/Shifts'
import { ShiftForm } from '@/pages/ShiftForm'
import { ShiftDetail } from '@/pages/ShiftDetail'
import { AttendanceForm } from '@/pages/AttendanceForm'

function RequireApproved() {
  const { loading, session, appUser } = useAppUser()

  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!appUser || appUser.status !== 'approved') return <PendingApproval />
  return <AppShell appUser={appUser} session={session} />
}

function RequireRole({ roles }: { roles: AppRole[] }) {
  const { appUser, session } = useAppUserContext()

  if (!roles.includes(appUser.role!)) return <Navigate to="/" replace />
  return <Outlet context={{ appUser, session } satisfies AppOutletContext} />
}

export function App() {
  return (
    <Routes>
      <Route path="/signup" element={<SignUp />} />
      <Route path="/login" element={<Login />} />
      <Route element={<RequireApproved />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/profile" element={<Profile />} />
        <Route element={<RequireRole roles={['employee', 'shift_manager', 'bar_manager']} />}>
          <Route path="/my-shifts" element={<MyShifts />} />
        </Route>
        <Route element={<RequireRole roles={ROLES_VIEWING_SHIFTS} />}>
          <Route path="/shifts" element={<Shifts />} />
          <Route path="/shifts/:id" element={<ShiftDetail />} />
          <Route path="/shifts/:id/attendance" element={<AttendanceForm />} />
        </Route>
        <Route element={<RequireRole roles={ROLES_MANAGING_SHIFTS} />}>
          <Route path="/shifts/new" element={<ShiftForm />} />
          <Route path="/shifts/:id/edit" element={<ShiftForm />} />
        </Route>
        <Route element={<RequireRole roles={['administrator']} />}>
          <Route path="/admin/approvals" element={<AdminApprovals />} />
        </Route>
      </Route>
    </Routes>
  )
}
