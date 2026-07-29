import { useEffect, useState, type FormEvent } from 'react'

import { supabase } from '@/lib/supabase'
import { roleLabels } from '@/lib/roleLabels'
import { useRoleEmployeeAssignment, type Employee } from '@/hooks/useRoleEmployeeAssignment'
import { RoleEmployeeFields } from '@/components/RoleEmployeeFields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatDateTime } from '@/lib/utils'
import type { AppRole, AppUserStatus, EmployeeInvite } from '@/lib/types'

interface AdminAppUserRow {
  id: string
  email: string
  role: AppRole | null
  status: AppUserStatus
  employee_id: string | null
  employee_name: string | null
  created_at: string
  approved_at: string | null
}

const statusLabels: Record<AppUserStatus, string> = {
  pending_approval: 'ממתין/ה לאישור',
  approved: 'פעיל/ה',
  suspended: 'מושהה/ית',
}

const statusBadgeClass: Record<AppUserStatus, string> = {
  pending_approval: 'bg-secondary text-secondary-foreground',
  approved: 'bg-primary text-primary-foreground',
  suspended: 'bg-destructive text-white',
}

const inviteStatusLabels = {
  pending: 'ממתינה',
  claimed: 'מומשה',
  cancelled: 'בוטלה',
}

export function Users() {
  const [users, setUsers] = useState<AdminAppUserRow[] | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [invites, setInvites] = useState<EmployeeInvite[]>([])
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  async function load() {
    const [usersRes, employeesRes, invitesRes] = await Promise.all([
      supabase.rpc('list_app_users_for_admin'),
      supabase.from('employees').select('id, full_name').eq('active', true).order('full_name'),
      supabase.from('employee_invites').select('*').order('created_at', { ascending: false }),
    ])

    if (usersRes.error) {
      setLoadError(usersRes.error.message)
      return
    }

    setUsers(usersRes.data as AdminAppUserRow[])
    setEmployees((employeesRes.data as Employee[]) ?? [])
    setInvites((invitesRes.data as EmployeeInvite[]) ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  function handleEmployeeCreated(employee: Employee) {
    setEmployees((prev) => [...prev, employee].sort((a, b) => a.full_name.localeCompare(b.full_name)))
  }

  async function handleCancelInvite(inviteId: string) {
    if (!confirm('לבטל את ההזמנה?')) return
    await supabase.from('employee_invites').update({ status: 'cancelled' }).eq('id', inviteId)
    load()
  }

  if (loadError) return <p className="text-destructive text-center text-sm">{loadError}</p>
  if (users === null) return null

  const activeUsers = users.filter((u) => u.status !== 'pending_approval')
  const employeeNames = new Map(employees.map((e) => [e.id, e.full_name]))
  const pendingInvites = invites.filter((i) => i.status === 'pending')
  const resolvedInvites = invites.filter((i) => i.status !== 'pending')

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">משתמשים</h1>
        {!showInviteForm && <Button onClick={() => setShowInviteForm(true)}>הזמנת עובד/ת</Button>}
      </div>

      {showInviteForm && (
        <InviteForm
          employees={employees}
          onEmployeeCreated={handleEmployeeCreated}
          onDone={() => {
            setShowInviteForm(false)
            load()
          }}
          onCancel={() => setShowInviteForm(false)}
        />
      )}

      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">הזמנות ממתינות</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
              >
                <div>
                  <p className="font-medium">{invite.email}</p>
                  <p className="text-muted-foreground">
                    {roleLabels[invite.role]}
                    {invite.employee_id && employeeNames.get(invite.employee_id) && (
                      <> · {employeeNames.get(invite.employee_id)}</>
                    )}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleCancelInvite(invite.id)}>
                  ביטול
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeUsers.length === 0 && (
        <p className="text-muted-foreground text-sm">אין משתמשים מאושרים עדיין.</p>
      )}

      {activeUsers.map((user) => (
        <UserRow
          key={user.id}
          user={user}
          employees={employees}
          onChanged={load}
          onEmployeeCreated={handleEmployeeCreated}
        />
      ))}

      {resolvedInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">היסטוריית הזמנות</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {resolvedInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div>
                  <p className="font-medium">{invite.email}</p>
                  <p className="text-muted-foreground">
                    {roleLabels[invite.role]}
                    {invite.claimed_at && <> · הצטרפ/ה ב-{formatDateTime(invite.claimed_at)}</>}
                  </p>
                </div>
                <span className="text-muted-foreground text-xs">{inviteStatusLabels[invite.status]}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function InviteForm({
  employees,
  onEmployeeCreated,
  onDone,
  onCancel,
}: {
  employees: Employee[]
  onEmployeeCreated: (employee: Employee) => void
  onDone: () => void
  onCancel: () => void
}) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const assignment = useRoleEmployeeAssignment({ employeeMode: 'create' })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!email.trim()) {
      setError('יש להזין כתובת אימייל')
      return
    }

    setSubmitting(true)
    const result = await assignment.resolve(onEmployeeCreated)

    if (result.error) {
      setSubmitting(false)
      setError(result.error)
      return
    }

    const { error: insertError } = await supabase.from('employee_invites').insert({
      email: email.trim().toLowerCase(),
      role: assignment.role,
      employee_id: result.employeeId,
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    onDone()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">הזמנת עובד/ת חדש/ה</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-email">אימייל</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <RoleEmployeeFields idPrefix="invite" employees={employees} assignment={assignment} />

          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button type="submit" disabled={submitting} className="flex-1">
            שליחת הזמנה
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            ביטול
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function UserRow({
  user,
  employees,
  onChanged,
  onEmployeeCreated,
}: {
  user: AdminAppUserRow
  employees: Employee[]
  onChanged: () => void
  onEmployeeCreated: (employee: Employee) => void
}) {
  const [editing, setEditing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const assignment = useRoleEmployeeAssignment({ role: user.role, employeeId: user.employee_id })

  async function handleSave() {
    setError(null)
    setSubmitting(true)

    const result = await assignment.resolve(onEmployeeCreated)

    if (result.error) {
      setSubmitting(false)
      setError(result.error)
      return
    }

    const { error: saveError } = await supabase.rpc('approve_user', {
      p_user_id: user.id,
      p_role: assignment.role,
      p_employee_id: result.employeeId,
    })

    setSubmitting(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    setEditing(false)
    onChanged()
  }

  async function handleSuspend() {
    if (!confirm('להשהות את המשתמש/ת?')) return

    const { error: suspendError } = await supabase.rpc('suspend_user', { p_user_id: user.id })

    if (suspendError) {
      setError(suspendError.message)
      return
    }

    onChanged()
  }

  async function handleReactivate() {
    const { error: reactivateError } = await supabase.rpc('approve_user', {
      p_user_id: user.id,
      p_role: user.role,
      p_employee_id: user.employee_id,
    })

    if (reactivateError) {
      setError(reactivateError.message)
      return
    }

    onChanged()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{user.email}</CardTitle>
          <span className={cn('rounded-full px-2 py-1 text-xs font-medium', statusBadgeClass[user.status])}>
            {statusLabels[user.status]}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!editing && (
          <>
            <p>
              <span className="text-muted-foreground">תפקיד: </span>
              {user.role ? roleLabels[user.role] : '—'}
            </p>
            {user.employee_name && (
              <p>
                <span className="text-muted-foreground">עובד/ת: </span>
                {user.employee_name}
              </p>
            )}
          </>
        )}

        {editing && <RoleEmployeeFields idPrefix={user.id} employees={employees} assignment={assignment} />}

        {error && <p className="text-destructive text-sm">{error}</p>}

        <div className="flex gap-2">
          {editing ? (
            <>
              <Button className="flex-1" disabled={submitting} onClick={handleSave}>
                שמירה
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => setEditing(false)}>
                ביטול
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="flex-1" onClick={() => setEditing(true)}>
                עריכת תפקיד
              </Button>
              {user.status === 'approved' && (
                <Button variant="destructive" className="flex-1" onClick={handleSuspend}>
                  השהיה
                </Button>
              )}
              {user.status === 'suspended' && (
                <Button className="flex-1" onClick={handleReactivate}>
                  הפעלה מחדש
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
