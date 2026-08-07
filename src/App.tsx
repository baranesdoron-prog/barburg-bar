import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAppUser } from '@/hooks/useAppUser'
import { useAppUserContext, type AppOutletContext } from '@/lib/outletContext'
import { ImpersonationProvider, useImpersonation } from '@/lib/impersonation'
import type { AppRole } from '@/lib/types'
import { ROLES_MANAGING_SHIFTS, ROLES_VIEWING_SHIFTS } from '@/lib/roleLabels'
import { AppShell } from '@/components/AppShell'
import { SignUp } from '@/pages/SignUp'
import { Login } from '@/pages/Login'
import { ForgotPassword } from '@/pages/ForgotPassword'
import { ResetPassword } from '@/pages/ResetPassword'
import { PendingApproval } from '@/pages/PendingApproval'
import { Dashboard } from '@/pages/Dashboard'
import { MyShifts } from '@/pages/MyShifts'
import { Profile } from '@/pages/Profile'
import { AdminApprovals } from '@/pages/AdminApprovals'
import { Shifts } from '@/pages/Shifts'
import { ShiftForm } from '@/pages/ShiftForm'
import { ShiftDetail } from '@/pages/ShiftDetail'
import { AttendanceForm } from '@/pages/AttendanceForm'
import { ShiftClosing } from '@/pages/ShiftClosing'
import { ShiftReport } from '@/pages/ShiftReport'
import { InventoryItems } from '@/pages/InventoryItems'
import { ProductFormPage } from '@/pages/ProductFormPage'
import { Suppliers } from '@/pages/Suppliers'
import { PurchaseOrders } from '@/pages/PurchaseOrders'
import { Reorder } from '@/pages/Reorder'
import { PurchaseOrderDetail } from '@/pages/PurchaseOrderDetail'
import { Reports } from '@/pages/Reports'
import { Users } from '@/pages/Users'
import { WeeklyChecklist } from '@/pages/WeeklyChecklist'
import { Procedures } from '@/pages/Procedures'
import { ShiftManagerSchedule } from '@/pages/ShiftManagerSchedule'

function RequireApproved() {
  const { loading, session, appUser } = useAppUser()

  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!appUser || appUser.status !== 'approved') return <PendingApproval />
  return (
    <ImpersonationProvider realRole={appUser.role!}>
      <AppShell appUser={appUser} session={session} />
    </ImpersonationProvider>
  )
}

function RequireRole({ roles }: { roles: AppRole[] }) {
  const { appUser, session } = useAppUserContext()
  const { effectiveRole } = useImpersonation()

  if (!roles.includes(effectiveRole)) return <Navigate to="/" replace />
  return <Outlet context={{ appUser, session, effectiveRole } satisfies AppOutletContext} />
}

export function App() {
  const navigate = useNavigate()

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') navigate('/reset-password', { replace: true })
    })

    return () => subscription.unsubscribe()
  }, [navigate])

  return (
    <Routes>
      <Route path="/signup" element={<SignUp />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<RequireApproved />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/procedures" element={<Procedures />} />
        <Route element={<RequireRole roles={['bartender', 'shift_manager']} />}>
          <Route path="/my-shifts" element={<MyShifts />} />
        </Route>
        <Route element={<RequireRole roles={ROLES_VIEWING_SHIFTS} />}>
          <Route path="/shifts" element={<Shifts />} />
          <Route path="/shifts/:id" element={<ShiftDetail />} />
          <Route path="/shifts/:id/attendance" element={<AttendanceForm />} />
          <Route path="/shifts/:id/close" element={<ShiftClosing />} />
          <Route path="/shifts/:id/report" element={<ShiftReport />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/weekly-checklist" element={<WeeklyChecklist />} />
        </Route>
        <Route element={<RequireRole roles={ROLES_MANAGING_SHIFTS} />}>
          <Route path="/shifts/new" element={<ShiftForm />} />
          <Route path="/shifts/:id/edit" element={<ShiftForm />} />
          <Route path="/inventory/items" element={<InventoryItems />} />
          <Route path="/inventory/items/new" element={<ProductFormPage />} />
          <Route path="/inventory/items/:id/edit" element={<ProductFormPage />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/purchase-orders" element={<PurchaseOrders />} />
          <Route path="/purchase-orders/reorder" element={<Reorder />} />
          <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
        </Route>
        <Route element={<RequireRole roles={['administrator']} />}>
          <Route path="/admin/approvals" element={<AdminApprovals />} />
          <Route path="/admin/users" element={<Users />} />
          <Route path="/admin/shift-manager-schedule" element={<ShiftManagerSchedule />} />
        </Route>
      </Route>
    </Routes>
  )
}
