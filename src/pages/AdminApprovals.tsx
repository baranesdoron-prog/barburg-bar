import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { roleLabels, ROLES_REQUIRING_EMPLOYEE } from '@/lib/roleLabels'
import type { AppRole } from '@/lib/types'
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

interface PendingUser {
  id: string
  email: string
  created_at: string
}

interface Employee {
  id: string
  full_name: string
}

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

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
  const [role, setRole] = useState<AppRole | ''>('')
  const [employeeMode, setEmployeeMode] = useState<'link' | 'create'>('link')
  const [employeeId, setEmployeeId] = useState('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsEmployee = role !== '' && ROLES_REQUIRING_EMPLOYEE.includes(role)

  async function handleApprove() {
    setError(null)

    if (!role) {
      setError('יש לבחור תפקיד')
      return
    }

    if (needsEmployee) {
      if (employeeMode === 'link' && !employeeId) {
        setError('יש לבחור עובד/ת קיים/ת')
        return
      }
      if (employeeMode === 'create' && !newName.trim()) {
        setError('יש להזין שם מלא')
        return
      }
    }

    setSubmitting(true)

    let resolvedEmployeeId: string | null = needsEmployee && employeeMode === 'link' ? employeeId : null

    if (needsEmployee && employeeMode === 'create') {
      const { data: employee, error: employeeError } = await supabase
        .from('employees')
        .insert({ full_name: newName.trim(), phone: newPhone.trim() || null })
        .select('id, full_name')
        .single()

      if (employeeError) {
        setSubmitting(false)
        setError(employeeError.message)
        return
      }
      resolvedEmployeeId = employee.id
      onEmployeeCreated(employee)
    }

    const { error: approveError } = await supabase.rpc('approve_user', {
      p_user_id: user.id,
      p_role: role,
      p_employee_id: resolvedEmployeeId,
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
        <div className="flex flex-col gap-2">
          <Label htmlFor={`role-${user.id}`}>תפקיד</Label>
          <select
            id={`role-${user.id}`}
            className={selectClass}
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
          >
            <option value="" disabled>
              בחר תפקיד
            </option>
            {(Object.keys(roleLabels) as AppRole[]).map((r) => (
              <option key={r} value={r}>
                {roleLabels[r]}
              </option>
            ))}
          </select>
        </div>

        {needsEmployee && (
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={employeeMode === 'link'}
                  onChange={() => setEmployeeMode('link')}
                />
                שיוך לעובד/ת קיים/ת
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={employeeMode === 'create'}
                  onChange={() => setEmployeeMode('create')}
                />
                יצירת עובד/ת חדש/ה
              </label>
            </div>

            {employeeMode === 'link' ? (
              <select
                className={selectClass}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="" disabled>
                  בחר/י עובד/ת
                </option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex flex-col gap-2">
                <Input
                  placeholder="שם מלא"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Input
                  placeholder="טלפון (לא חובה)"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

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
