import { useCallback, useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'

// The signed-in user's own shift-notification choice (migration 103), and
// which channels the admin has switched on. With both channels off the
// app shows no notification choices anywhere.
export interface NotificationPrefs {
  email: boolean
  whatsapp: boolean
  consentAt: string | null
  whatsappOptedOutAt: string | null
  nudgeDismissedAt: string | null
  phone: string | null
}

export interface NotificationPrefsState {
  loaded: boolean
  emailEnabled: boolean
  whatsappEnabled: boolean
  prefs: NotificationPrefs | null
}

export const E164 = /^\+[1-9][0-9]{7,14}$/

// Whether the person will actually get notified on some channel that's on.
export function hasActiveChannel(state: NotificationPrefsState) {
  return !!state.prefs && ((state.emailEnabled && state.prefs.email) || (state.whatsappEnabled && state.prefs.whatsapp))
}

function friendlyError(message: string) {
  if (message.includes('consent')) return 'יש לסמן את ההסכמה לקבלת הודעות.'
  if (message.includes('phone')) return 'כדי לקבל עדכונים ב־WhatsApp צריך מספר טלפון תקין בפרופיל.'
  if (message.includes('not linked')) return 'החשבון שלך אינו משויך לעובד/ת.'
  return message
}

// `active` lets a component that's always mounted (the sign-up popup on
// every shifts-page week) skip the fetch until it's actually needed.
export function useNotificationPrefs(employeeId: string | null, active = true) {
  const [state, setState] = useState<NotificationPrefsState>({
    loaded: false,
    emailEnabled: false,
    whatsappEnabled: false,
    prefs: null,
  })

  const load = useCallback(async () => {
    const [{ data: channels }, { data: employee }] = await Promise.all([
      supabase.rpc('notification_channels'),
      employeeId
        ? supabase
            .from('employees')
            .select('notify_email, notify_whatsapp, notify_consent_at, whatsapp_opted_out_at, notify_nudge_dismissed_at, phone')
            .eq('id', employeeId)
            .single()
        : Promise.resolve({ data: null }),
    ])
    const row = (channels as { email: boolean; whatsapp: boolean }[] | null)?.[0]
    const e = employee as {
      notify_email: boolean
      notify_whatsapp: boolean
      notify_consent_at: string | null
      whatsapp_opted_out_at: string | null
      notify_nudge_dismissed_at: string | null
      phone: string | null
    } | null
    setState({
      loaded: true,
      emailEnabled: !!row?.email,
      whatsappEnabled: !!row?.whatsapp,
      prefs: e
        ? {
            email: e.notify_email,
            whatsapp: e.notify_whatsapp,
            consentAt: e.notify_consent_at,
            whatsappOptedOutAt: e.whatsapp_opted_out_at,
            nudgeDismissedAt: e.notify_nudge_dismissed_at,
            phone: e.phone,
          }
        : null,
    })
  }, [employeeId])

  useEffect(() => {
    if (active) load()
  }, [active, load])

  const save = useCallback(
    async (email: boolean, whatsapp: boolean, consent: boolean): Promise<string | null> => {
      const { error } = await supabase.rpc('set_my_notification_prefs', {
        p_email: email,
        p_whatsapp: whatsapp,
        p_consent: consent,
      })
      if (error) return friendlyError(error.message)
      await load()
      return null
    },
    [load],
  )

  const dismissNudge = useCallback(async () => {
    await supabase.rpc('dismiss_notification_nudge')
    await load()
  }, [load])

  return { ...state, reload: load, save, dismissNudge }
}
