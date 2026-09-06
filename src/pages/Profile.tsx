import { useEffect, useState, type FormEvent } from 'react'

import { supabase } from '@/lib/supabase'
import { roleLabels } from '@/lib/roleLabels'
import { useAppUserContext } from '@/lib/outletContext'
import { PasswordField } from '@/components/PasswordField'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

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
      <ChangePasswordSection />
    </Card>
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
