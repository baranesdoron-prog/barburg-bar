import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { useRoleEmployeeAssignment, type Employee } from '@/hooks/useRoleEmployeeAssignment'
import { RoleEmployeeFields } from '@/components/RoleEmployeeFields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

interface PendingUser {
  id: string
  email: string
  created_at: string
}

export function AdminApprovals() {
  const [pending, setPending] = useState<PendingUser[] | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const [pendingRes, employeesRes] = await Promise.all([
        supabase.rpc('list_pending_app_users'),
        supabase
          .from('employees')
          .select('id, full_name')
          .eq('active', true)
          .order('full_name'),
      ])

      if (pendingRes.error) {
        setLoadError(pendingRes.error.message)
        return
      }

      setPending(pendingRes.data as PendingUser[])
      setEmployees((employeesRes.data as Employee[]) ?? [])
    }

    load()
  }, [])

  function handleResolved(userId: string) {
    setPending((prev) => prev?.filter((u) => u.id !== userId) ?? null)
  }

  function handleEmployeeCreated(employee: Employee) {
    setEmployees((prev) => [...prev, employee].sort((a, b) => a.full_name.localeCompare(b.full_name)))
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">בקשות הצטרפות ממתינות</h1>

      {loadError && <p className="text-destructive text-sm">{loadError}</p>}

      {pending?.length === 0 && (
        <p className="text-muted-foreground text-sm">אין בקשות ממתינות כרגע.</p>
      )}

      {pending?.map((user) => (
        <PendingUserCard
          key={user.id}
          user={user}
          employees={employees}
          onResolved={() => handleResolved(user.id)}
          onEmployeeCreated={handleEmployeeCreated}
        />
      ))}
    </div>
  )
}

function PendingUserCard({
  user,
  employees,
  onResolved,
  onEmployeeCreated,
}: {
  user: PendingUser
  employees: Employee[]
  onResolved: () => void
  onEmployeeCreated: (employee: Employee) => void
}) {
  const assignment = useRoleEmployeeAssignment()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleApprove() {
    setError(null)
    setSubmitting(true)

    const result = await assignment.resolve(onEmployeeCreated)

    if (result.error) {
      setSubmitting(false)
      setError(result.error)
      return
    }

    const { error: approveError } = await supabase.rpc('approve_user', {
      p_user_id: user.id,
      p_role: assignment.role,
      p_employee_id: result.employeeId,
    })

    setSubmitting(false)

    if (approveError) {
      setError(approveError.message)
      return
    }

    onResolved()
  }

  async function handleReject() {
    setSubmitting(true)
    setError(null)

    const { error: rejectError } = await supabase.rpc('suspend_user', {
      p_user_id: user.id,
    })

    setSubmitting(false)

    if (rejectError) {
      setError(rejectError.message)
      return
    }

    onResolved()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{user.email}</CardTitle>
        <CardDescription>
          נרשם/ה ב-{new Date(user.created_at).toLocaleDateString('he-IL')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <RoleEmployeeFields idPrefix={user.id} employees={employees} assignment={assignment} />
        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button onClick={handleApprove} disabled={submitting} className="flex-1">
          אישור
        </Button>
        <Button
          onClick={handleReject}
          disabled={submitting}
          variant="outline"
          className="flex-1"
        >
          דחייה
        </Button>
      </CardFooter>
    </Card>
  )
}
