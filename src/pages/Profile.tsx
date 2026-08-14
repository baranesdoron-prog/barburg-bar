import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { roleLabels } from '@/lib/roleLabels'
import { useAppUserContext } from '@/lib/outletContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
    </Card>
  )
}
