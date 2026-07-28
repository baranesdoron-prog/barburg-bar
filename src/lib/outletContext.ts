import { useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'

import type { AppRole, AppUser } from '@/lib/types'

export interface AppOutletContext {
  appUser: AppUser
  session: Session
  effectiveRole: AppRole
}

export function useAppUserContext() {
  return useOutletContext<AppOutletContext>()
}
