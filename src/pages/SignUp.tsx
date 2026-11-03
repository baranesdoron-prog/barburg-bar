import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { NotificationChoice, type NotificationChoiceValue } from '@/components/NotificationChoice'
import { isChoiceValid } from '@/lib/notifications'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function SignUp() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  // Which notification channels the admin has switched on; with none on,
  // the form is exactly as before.
  const [channels, setChannels] = useState({ email: false, whatsapp: false })
  const [notify, setNotify] = useState<NotificationChoiceValue>({ email: false, whatsapp: false, consent: false })
  const anyChannelOn = channels.email || channels.whatsapp

  useEffect(() => {
    supabase.rpc('notification_channels').then(({ data }) => {
      const row = (data as { email: boolean; whatsapp: boolean }[] | null)?.[0]
      if (row) setChannels({ email: row.email, whatsapp: row.whatsapp })
    })
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (anyChannelOn && !isChoiceValid(notify, channels.email, channels.whatsapp)) {
      setError('יש לבחור איך לקבל עדכונים על משמרות ולסמן את ההסכמה.')
      return
    }
    setSubmitting(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
          ...(anyChannelOn
            ? {
                notify_email: channels.email && notify.email,
                notify_whatsapp: channels.whatsapp && notify.whatsapp,
                notify_consent: notify.consent,
              }
            : {}),
        },
      },
    })

    setSubmitting(false)

    if (error) {
      setError('אירעה שגיאה בהרשמה. נסה/י שוב, ואם הבעיה נמשכת פנה/י למנהל המערכת.')
      return
    }

    setDone(true)
  }

  if (done) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle>איזה כיף שהצטרפת אלינו!</CardTitle>
            <CardDescription>אתה יכול עכשיו להתחבר למערכת ולשבץ את עצמך!</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button asChild>
              <Link to="/login">מעבר להתחברות</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img src="/logo.png" alt="ברבורג" className="mb-2 size-24 rounded-full object-cover" />
          <CardTitle>הרשמה לברבורג</CardTitle>
          <CardDescription>יצירת חשבון חדש</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">אימייל</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">סיסמה</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName">שם מלא</Label>
              <Input
                id="fullName"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">טלפון</Label>
              <Input
                id="phone"
                type="tel"
                required
                autoComplete="tel"
                placeholder="058-1234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            {anyChannelOn && (
              <NotificationChoice
                emailEnabled={channels.email}
                whatsappEnabled={channels.whatsapp}
                value={notify}
                onChange={setNotify}
                whatsappTarget={channels.whatsapp ? '(למספר שלמעלה)' : null}
              />
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'נרשם/ת...' : 'הרשמה'}
            </Button>
            <p className="text-muted-foreground text-sm">
              כבר יש לך חשבון? <Link to="/login" className="underline">התחברות</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
