import { useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'

import type { AppUser } from '@/lib/types'

export interface AppOutletContext {
  appUser: AppUser
  session: Session
}

export function useAppUserContext() {
  return useOutletContext<AppOutletContext>()
}
