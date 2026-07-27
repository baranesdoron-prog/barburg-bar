import { Navigate, Route, Routes } from 'react-router-dom'

import { useAppUser } from '@/hooks/useAppUser'
import { SignUp } from '@/pages/SignUp'
import { Login } from '@/pages/Login'
import { PendingApproval } from '@/pages/PendingApproval'
import { Approved } from '@/pages/Approved'

function Home() {
  const { loading, session, appUser } = useAppUser()

  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!appUser || appUser.status !== 'approved') return <PendingApproval />
  return <Approved appUser={appUser} />
}

export function App() {
  return (
    <Routes>
      <Route path="/signup" element={<SignUp />} />
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Home />} />
    </Routes>
  )
}
