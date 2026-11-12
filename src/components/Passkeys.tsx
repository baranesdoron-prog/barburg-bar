import { useCallback, useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { useImpersonation } from '@/lib/impersonation'
import {
  devicePasskeyId,
  dismissOffer,
  friendlyPasskeyError,
  guessDeviceName,
  offerDismissed,
  passkeysSupported,
  rememberDevicePasskey,
} from '@/lib/passkeys'
import { FaceIdIcon } from '@/components/FaceIdIcon'
import { Button } from '@/components/ui/button'

type Audience = 'administrators' | 'staff' | 'everyone'

const AUDIENCE_LABELS: Record<Audience, string> = {
  administrators: 'מנהלי מערכת בלבד',
  staff: 'כל הצוות',
  everyone: 'כולם, כולל לקוחות',
}

// Whether the signed-in user may turn Face ID login on (the staged
// rollout set by an administrator).
export function usePasskeyAllowed() {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    supabase.rpc('passkey_allowed').then(({ data }) => setAllowed(data === true))
  }, [])
  return allowed
}

// Lets the profile list refresh when the offer pop-up adds a device.
const CHANGED_EVENT = 'barburg-passkeys-changed'

async function registerThisDevice(): Promise<string | null> {
  const { data, error } = await supabase.auth.registerPasskey()
  if (error || !data) return friendlyPasskeyError(error?.message)
  rememberDevicePasskey(data.id)
  await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: guessDeviceName() })
  window.dispatchEvent(new Event(CHANGED_EVENT))
  return null
}

const dateFormatter = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' })

interface PasskeyRow {
  id: string
  friendly_name?: string
  created_at: string
  last_used_at?: string
}

// Profile page: the devices where Face ID login is on, add this device,
// remove one (a lost phone). Administrators also choose the rollout.
export function PasskeysSection() {
  const { realRole } = useImpersonation()
  const allowed = usePasskeyAllowed()
  const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audience, setAudience] = useState<Audience | null>(null)
  const isAdmin = realRole === 'administrator'

  const load = useCallback(async () => {
    const { data, error: listError } = await supabase.auth.passkey.list()
    if (listError) {
      setPasskeys([])
      return
    }
    const rows = (data as PasskeyRow[]) ?? []
    // The passkey this device remembers was removed elsewhere.
    const mine = devicePasskeyId()
    if (mine && !rows.some((r) => r.id === mine)) rememberDevicePasskey(null)
    setPasskeys(rows)
  }, [])

  useEffect(() => {
    window.addEventListener(CHANGED_EVENT, load)
    return () => window.removeEventListener(CHANGED_EVENT, load)
  }, [load])

  useEffect(() => {
    load()
    if (isAdmin) {
      supabase
        .from('app_settings')
        .select('passkey_audience')
        .eq('id', true)
        .single()
        .then(({ data }) => setAudience(((data as { passkey_audience: Audience } | null)?.passkey_audience) ?? 'administrators'))
    }
  }, [load, isAdmin])

  if (passkeys === null) return null
  if (!allowed && passkeys.length === 0 && !isAdmin) return null

  const thisDevice = devicePasskeyId()
  const canAdd = allowed && passkeysSupported() && !passkeys.some((p) => p.id === thisDevice)

  async function add() {
    setBusy(true)
    setError(null)
    const result = await registerThisDevice()
    setBusy(false)
    if (result) setError(result)
    load()
  }

  async function remove(row: PasskeyRow) {
    if (!window.confirm(`להסיר את "${row.friendly_name ?? 'המכשיר'}"? הוא לא יוכל יותר להיכנס עם Face ID.`)) return
    setBusy(true)
    const { error: deleteError } = await supabase.auth.passkey.delete({ passkeyId: row.id })
    setBusy(false)
    if (deleteError) {
      setError(friendlyPasskeyError(deleteError.message))
      return
    }
    if (row.id === thisDevice) rememberDevicePasskey(null)
    load()
  }

  async function changeAudience(next: Audience) {
    setAudience(next)
    const { error: updateError } = await supabase.from('app_settings').update({ passkey_audience: next }).eq('id', true)
    if (updateError) setError(updateError.message)
  }

  return (
    <div className="flex flex-col gap-3 border-t p-6 text-start">
      <div className="flex items-center gap-2.5">
        <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
          <FaceIdIcon className="size-6" />
        </div>
        <div className="flex flex-col">
          <span className="font-bold">כניסה עם Face ID / טביעת אצבע</span>
          <span className="text-muted-foreground text-xs">בלי סיסמה, בכל מכשיר שהפעלת</span>
        </div>
      </div>

      {passkeys.length === 0 && (
        <p className="text-muted-foreground text-sm">עוד לא הופעל באף מכשיר.</p>
      )}
      {passkeys.map((row) => (
        <div key={row.id} className="flex items-center gap-2 rounded-xl border px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              {row.friendly_name ?? 'מכשיר'}
              {row.id === thisDevice && (
                <span className="bg-primary/10 text-primary rounded-full px-1.5 text-[11px]">המכשיר הזה</span>
              )}
            </span>
            <span className="text-muted-foreground text-xs">
              הופעל {dateFormatter.format(new Date(row.created_at))}
              {row.last_used_at && ` · כניסה אחרונה ${dateFormatter.format(new Date(row.last_used_at))}`}
            </span>
          </div>
          <Button type="button" variant="outline" size="sm" className="text-destructive" disabled={busy} onClick={() => remove(row)}>
            הסרה
          </Button>
        </div>
      ))}

      {canAdd && (
        <Button type="button" disabled={busy} onClick={add}>
          הוספת המכשיר הזה
        </Button>
      )}
      {allowed && !passkeysSupported() && (
        <p className="text-muted-foreground text-xs">הדפדפן הזה לא תומך בכניסה עם Face ID.</p>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}

      {isAdmin && audience && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-dashed p-3">
          <label htmlFor="passkey-audience" className="text-sm font-bold">
            מי יכול להפעיל (אדמין)
          </label>
          <select
            id="passkey-audience"
            value={audience}
            onChange={(e) => changeAudience(e.target.value as Audience)}
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
          >
            {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground text-xs">מי שכבר הפעיל ממשיך להיכנס כך גם אם מצמצמים.</span>
        </div>
      )}
    </div>
  )
}

// After a password login, once per device: offer to turn Face ID on.
export function PasskeyOffer({ userId }: { userId: string }) {
  const allowed = usePasskeyAllowed()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (allowed && passkeysSupported() && !devicePasskeyId() && !offerDismissed()) setOpen(true)
  }, [allowed, userId])

  if (!open) return null

  function later() {
    dismissOffer()
    setOpen(false)
  }

  async function enable() {
    setBusy(true)
    setError(null)
    const result = await registerThisDevice()
    setBusy(false)
    if (result) {
      setError(result)
      return
    }
    dismissOffer()
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" style={{ background: 'rgba(32,42,38,.55)' }}>
      <div dir="rtl" className="bg-background flex w-full max-w-sm flex-col gap-3.5 rounded-3xl p-6 text-center">
        <div className="bg-primary/10 text-primary flex size-16 items-center justify-center self-center rounded-2xl">
          <FaceIdIcon className="size-9" />
        </div>
        <h2 className="text-xl font-extrabold">להיכנס בפעם הבאה בלי סיסמה?</h2>
        <p className="text-muted-foreground">
          אפשר להפעיל כניסה עם Face ID או טביעת אצבע במכשיר הזה. מבט אחד או נגיעה אחת, וזהו.
        </p>
        <p className="bg-muted text-muted-foreground rounded-xl p-3 text-sm">
          הפנים וטביעת האצבע לא יוצאות מהמכשיר ולא נשמרות אצלנו. הסיסמה ממשיכה לעבוד כרגיל.
        </p>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button className="h-12 text-base" disabled={busy} onClick={enable}>
          הפעלה במכשיר הזה
        </Button>
        <Button variant="outline" className="h-11" disabled={busy} onClick={later}>
          לא עכשיו
        </Button>
        <span className="text-muted-foreground text-xs">אפשר להפעיל גם אחר כך, בעמוד "הפרופיל שלי".</span>
      </div>
    </div>
  )
}
