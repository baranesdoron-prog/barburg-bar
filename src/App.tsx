import { Navigate, Route, Routes } from 'react-router-dom'

import { useAppUser } from '@/hooks/useAppUser'
import { SignUp } from '@/pages/SignUp'
import { Login } from '@/pages/Login'
import { PendingApproval } from '@/pages/PendingApproval'
import { Approved } from '@/pages/Approved'
import { AdminApprovals } from '@/pages/AdminApprovals'

function Home() {
  const { loading, session, appUser } = useAppUser()

  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!appUser || appUser.status !== 'approved') return <PendingApproval />
  return <Approved appUser={appUser} />
}

function AdminApprovalsRoute() {
  const { loading, session, appUser } = useAppUser()

  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!appUser || appUser.role !== 'administrator') return <Navigate to="/" replace />
  return <AdminApprovals />
}

export function App() {
  return (
    <Routes>
      <Route path="/signup" element={<SignUp />} />
      <Route path="/login" element={<Login />} />
      <Route path="/admin/approvals" element={<AdminApprovalsRoute />} />
      <Route path="/" element={<Home />} />
    </Routes>
  )
}
