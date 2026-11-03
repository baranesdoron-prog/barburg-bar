import { useEffect, useState, type FormEvent } from 'react'

import { supabase } from '@/lib/supabase'
import { roleLabels } from '@/lib/roleLabels'
import { useAppUserContext } from '@/lib/outletContext'
import { PasswordField } from '@/components/PasswordField'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { NotificationChoice, type NotificationChoiceValue } from '@/components/NotificationChoice'
import { maskPhone } from '@/lib/notifications'
import { E164, useNotificationPrefs } from '@/hooks/useNotificationPrefs'

interface Employee {
  full_name: string
  phone: string | null
  photo_url: string | null
}

export function Profile() {
  const { appUser, session, effectiveRole } = useAppUserContext()
  const [employee, setEmployee] = useState<Employee | null>(null)

  useEffect(() => {
    if (!appUser.employee_id) return

    supabase
      .from('employees')
      .select('full_name, phone, photo_url')
      .eq('id', appUser.employee_id)
      .single()
      .then(({ data }) => setEmployee(data))
  }, [appUser.employee_id])

  return (
    <Card className="mx-auto max-w-md text-center">
      <CardHeader>
        {employee?.photo_url && (
          <img
            src={employee.photo_url}
            alt=""
            className="mx-auto size-20 rounded-full object-cover"
          />
        )}
        <CardTitle>{employee ? employee.full_name : 'הפרופיל שלי'}</CardTitle>
        <CardDescription>{roleLabels[effectiveRole]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        <p>
          <span className="text-muted-foreground">אימייל: </span>
          {session.user.email}
        </p>
        {employee?.phone && (
          <p>
            <span className="text-muted-foreground">טלפון: </span>
            {employee.phone}
          </p>
        )}
      </CardContent>
      {appUser.employee_id && <NotificationsSection employeeId={appUser.employee_id} />}
      <ChangePasswordSection />
    </Card>
  )
}

const consentDateFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' })

// How this user gets shift notifications -- only while the admin has at
// least one channel switched on. Only the user themselves can change it.
function NotificationsSection({ employeeId }: { employeeId: string }) {
  const notifications = useNotificationPrefs(employeeId)
  const { prefs, emailEnabled, whatsappEnabled } = notifications
  const [choice, setChoice] = useState<NotificationChoiceValue | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!notifications.loaded || !prefs || !(emailEnabled || whatsappEnabled)) return null

  const value = choice ?? { email: prefs.email, whatsapp: prefs.whatsapp, consent: false }
  // Consent is asked for when turning a channel on, not to keep one.
  const turningOn = (emailEnabled && value.email && !prefs.email) || (whatsappEnabled && value.whatsapp && !prefs.whatsapp)
  const changed = value.email !== prefs.email || value.whatsapp !== prefs.whatsapp
  const noneChosen = !(emailEnabled && value.email) && !(whatsappEnabled && value.whatsapp)

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    const failure = await notifications.save(value.email, value.whatsapp, value.consent)
    setSaving(false)
    if (failure) {
      setError(failure)
      return
    }
    setChoice(null)
    setMessage('נשמר')
  }

  return (
    <form onSubmit={handleSave}>
      <CardContent className="flex flex-col gap-3 border-t pt-6 text-start">
        <p className="text-sm font-medium">עדכונים על משמרות</p>
        <NotificationChoice
          emailEnabled={emailEnabled}
          whatsappEnabled={whatsappEnabled}
          value={value}
          onChange={(next) => {
            setChoice(next)
            setMessage(null)
          }}
          intro="שיבוץ, הסרה, ביטול או שינוי במשמרת, ותזכורת לפני המשמרת."
          showConsent={turningOn}
          whatsappTarget={maskPhone(prefs.phone)}
          whatsappUnavailableReason={E164.test(prefs.phone ?? '') ? null : 'צריך מספר טלפון תקין. אפשר לבקש ממנהל/ת לעדכן אותו.'}
        />
        {prefs.whatsappOptedOutAt && !prefs.whatsapp && whatsappEnabled && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            הוסרת מ־WhatsApp כי השבת "הסר" ב־{consentDateFormatter.format(new Date(prefs.whatsappOptedOutAt))}. אפשר לסמן שוב כדי לחזור.
          </p>
        )}
        {noneChosen && changed && (
          <p className="text-muted-foreground text-xs">בלי ערוץ לא יישלחו אליך עדכונים, ותתבקש/י לבחור שוב בשיבוץ הבא.</p>
        )}
        {prefs.consentAt && (
          <p className="text-muted-foreground text-xs">הסכמת לקבלת הודעות ב־{consentDateFormatter.format(new Date(prefs.consentAt))}.</p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {message && <p className="text-sm text-green-600">{message}</p>}
      </CardContent>
      <CardFooter>
        <Button type="submit" className="w-full" disabled={saving || !changed || (turningOn && !value.consent)}>
          שמירת הגדרות העדכונים
        </Button>
      </CardFooter>
    </form>
  )
}

function ChangePasswordSection() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (password.length < 6) {
      setError('הסיסמה חייבת להכיל לפחות 6 תווים')
      return
    }

    if (password !== confirmPassword) {
      setError('הסיסמאות אינן תואמות')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setPassword('')
    setConfirmPassword('')
    setSuccess(true)
  }

  return (
    <form onSubmit={handleSubmit}>
      <CardContent className="flex flex-col gap-4 border-t pt-6 text-start">
        <p className="text-sm font-medium">שינוי סיסמה</p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="profile-new-password">סיסמה חדשה</Label>
          <PasswordField id="profile-new-password" value={password} onChange={setPassword} autoComplete="new-password" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="profile-confirm-password">אימות סיסמה</Label>
          <PasswordField
            id="profile-confirm-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        {success && <p className="text-sm text-green-600">הסיסמה עודכנה בהצלחה.</p>}
      </CardContent>
      <CardFooter>
        <Button type="submit" className="w-full" disabled={submitting}>
          עדכון סיסמה
        </Button>
      </CardFooter>
    </form>
  )
}
