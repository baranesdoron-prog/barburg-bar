import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { roleLabels } from '@/lib/roleLabels'
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
import type { AppRole } from '@/lib/types'

const SELF_SERVICE_ROLES: AppRole[] = ['bartender', 'area_manager']

export function SignUp() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<AppRole>('bartender')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { role, full_name: fullName, phone } },
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
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>תפקיד</Label>
              <div className="flex gap-4 text-sm">
                {SELF_SERVICE_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="role"
                      checked={role === r}
                      onChange={() => setRole(r)}
                    />
                    {roleLabels[r]}
                  </label>
                ))}
              </div>
            </div>
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
