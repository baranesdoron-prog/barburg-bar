import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase'
import type { AppRole, AppUser } from '@/lib/types'

interface AppUserState {
  loading: boolean
  session: Session | null
  appUser: AppUser | null
  activeRole: AppRole | null
}

/**
 * The one place the frontend reads "who am I / what's my role" from.
 * `appUser` comes straight from the RLS-scoped `app_users` row, so a user
 * can never see or influence anyone else's role/status from here.
 */
export function useAppUser(): AppUserState {
  const [state, setState] = useState<AppUserState>({
    loading: true,
    session: null,
    appUser: null,
    activeRole: null,
  })

  useEffect(() => {
    let isMounted = true

    async function loadAppUser(session: Session | null) {
      if (!session) {
        if (isMounted) setState({ loading: false, session: null, appUser: null, activeRole: null })
        return
      }

      const [{ data, error }, { data: activeRole }] = await Promise.all([
        supabase.from('app_users').select('*').eq('id', session.user.id).single(),
        supabase.rpc('current_app_role'),
      ])

      if (!isMounted) return

      if (error) {
        setState({ loading: false, session, appUser: null, activeRole: null })
        return
      }

      setState({ loading: false, session, appUser: data, activeRole: (activeRole as AppRole | null) ?? null })
    }

    supabase.auth.getSession().then(({ data }) => loadAppUser(data.session))

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((prev) => ({ ...prev, loading: true }))
      loadAppUser(session)
    })

    return () => {
      isMounted = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  return state
}
