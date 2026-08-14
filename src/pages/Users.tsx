import { useEffect, useState, type FormEvent } from 'react'

import { supabase } from '@/lib/supabase'
import { roleLabels } from '@/lib/roleLabels'
import { useRoleEmployeeAssignment, type Employee } from '@/hooks/useRoleEmployeeAssignment'
import { RoleEmployeeFields } from '@/components/RoleEmployeeFields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { toDateStr } from '@/lib/weeklyChecklist'
import type { AppRole, AppUserStatus, EmployeeInvite, RoleDelegation } from '@/lib/types'

const todayStr = toDateStr(new Date())

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

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
  const [delegations, setDelegations] = useState<RoleDelegation[]>([])
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  async function load() {
    const [usersRes, employeesRes, invitesRes, delegationsRes] = await Promise.all([
      supabase.rpc('list_app_users_for_admin'),
      supabase.from('employees').select('id, full_name, photo_url').eq('active', true).order('full_name'),
      supabase.from('employee_invites').select('*').order('created_at', { ascending: false }),
      supabase.from('role_delegations').select('*').order('starts_on', { ascending: false }),
    ])

    if (usersRes.error) {
      setLoadError(usersRes.error.message)
      return
    }

    setUsers(usersRes.data as AdminAppUserRow[])
    setEmployees((employeesRes.data as Employee[]) ?? [])
    setInvites((invitesRes.data as EmployeeInvite[]) ?? [])
    setDelegations((delegationsRes.data as RoleDelegation[]) ?? [])
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
          delegations={delegations.filter((d) => d.app_user_id === user.id)}
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
  onEmployeeCreated,
  onDone,
  onCancel,
}: {
  onEmployeeCreated: (employee: Employee) => void
  onDone: () => void
  onCancel: () => void
}) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const assignment = useRoleEmployeeAssignment({ employeeMode: 'create' })

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    const path = `${crypto.randomUUID()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('employee-photos').upload(path, file)

    setUploading(false)

    if (uploadError) {
      setError(uploadError.message)
      return
    }

    const { data } = supabase.storage.from('employee-photos').getPublicUrl(path)
    assignment.setNewPhotoUrl(data.publicUrl)
  }

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

          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-role">תפקיד</Label>
            <select
              id="invite-role"
              className={selectClass}
              value={assignment.role}
              onChange={(e) => assignment.setRole(e.target.value as AppRole)}
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-name">שם מלא</Label>
            <Input
              id="invite-name"
              value={assignment.newName}
              onChange={(e) => assignment.setNewName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-phone">טלפון (לא חובה)</Label>
            <Input
              id="invite-phone"
              value={assignment.newPhone}
              onChange={(e) => assignment.setNewPhone(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-photo">תמונה (לא חובה)</Label>
            <div className="flex items-center gap-3">
              {assignment.newPhotoUrl && (
                <img
                  src={assignment.newPhotoUrl}
                  alt=""
                  className="size-12 shrink-0 rounded-full object-cover"
                />
              )}
              <Input id="invite-photo" type="file" accept="image/*" disabled={uploading} onChange={handlePhotoChange} />
            </div>
          </div>

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
  delegations,
  onChanged,
  onEmployeeCreated,
}: {
  user: AdminAppUserRow
  employees: Employee[]
  delegations: RoleDelegation[]
  onChanged: () => void
  onEmployeeCreated: (employee: Employee) => void
}) {
  const [editing, setEditing] = useState(false)
  const [showDelegation, setShowDelegation] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const assignment = useRoleEmployeeAssignment({ role: user.role, employeeId: user.employee_id })
  const employeePhotoUrl = employees.find((e) => e.id === user.employee_id)?.photo_url
  const activeDelegation = delegations.find((d) => d.starts_on <= todayStr && todayStr <= d.ends_on)

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

  async function handleAddDelegation(role: AppRole, startsOn: string, endsOn: string) {
    setError(null)
    const { error: insertError } = await supabase
      .from('role_delegations')
      .insert({ app_user_id: user.id, delegated_role: role, starts_on: startsOn, ends_on: endsOn })

    if (insertError) {
      setError(insertError.message)
      return
    }

    onChanged()
  }

  async function handleDeleteDelegation(delegationId: string) {
    const { error: deleteError } = await supabase.from('role_delegations').delete().eq('id', delegationId)

    if (deleteError) {
      setError(deleteError.message)
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
            {activeDelegation && (
              <p className="text-amber-600 dark:text-amber-400">
                פועל/ת כרגע כ־{roleLabels[activeDelegation.delegated_role]} עד {formatDate(activeDelegation.ends_on)}
              </p>
            )}
            {user.employee_name && (
              <div className="flex items-center gap-2">
                {employeePhotoUrl && (
                  <img src={employeePhotoUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
                )}
                <p>
                  <span className="text-muted-foreground">עובד/ת: </span>
                  {user.employee_name}
                </p>
              </div>
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
                <Button variant="outline" className="flex-1" onClick={() => setShowDelegation((v) => !v)}>
                  הרשאה זמנית
                </Button>
              )}
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

        {showDelegation && (
          <DelegationPanel
            idPrefix={user.id}
            delegations={delegations}
            onAdd={handleAddDelegation}
            onDelete={handleDeleteDelegation}
          />
        )}
      </CardContent>
    </Card>
  )
}

function DelegationPanel({
  idPrefix,
  delegations,
  onAdd,
  onDelete,
}: {
  idPrefix: string
  delegations: RoleDelegation[]
  onAdd: (role: AppRole, startsOn: string, endsOn: string) => void
  onDelete: (delegationId: string) => void
}) {
  const [role, setRole] = useState<AppRole | ''>('')
  const [startsOn, setStartsOn] = useState(todayStr)
  const [endsOn, setEndsOn] = useState('')

  function handleSubmit() {
    if (!role || !startsOn || !endsOn) return
    onAdd(role, startsOn, endsOn)
    setRole('')
    setEndsOn('')
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      {delegations.length > 0 && (
        <div className="flex flex-col gap-2">
          {delegations.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {roleLabels[d.delegated_role]} · {formatDate(d.starts_on)} – {formatDate(d.ends_on)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => onDelete(d.id)}>
                ביטול
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor={`delegation-role-${idPrefix}`}>שיוך תפקיד זמני</Label>
        <select
          id={`delegation-role-${idPrefix}`}
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
        <div className="flex gap-2">
          <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
        <Button size="sm" disabled={!role || !startsOn || !endsOn} onClick={handleSubmit}>
          הוספה
        </Button>
      </div>
    </div>
  )
}
