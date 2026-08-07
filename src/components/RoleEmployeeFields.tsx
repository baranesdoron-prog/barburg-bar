import { useState } from 'react'

import { supabase } from '@/lib/supabase'
import { roleLabels } from '@/lib/roleLabels'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AppRole } from '@/lib/types'
import type { Employee, RoleEmployeeAssignment } from '@/hooks/useRoleEmployeeAssignment'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

export function RoleEmployeeFields({
  idPrefix,
  employees,
  assignment,
}: {
  idPrefix: string
  employees: Employee[]
  assignment: RoleEmployeeAssignment
}) {
  const {
    role,
    setRole,
    employeeMode,
    setEmployeeMode,
    employeeId,
    setEmployeeId,
    newName,
    setNewName,
    newPhone,
    setNewPhone,
    newPhotoUrl,
    setNewPhotoUrl,
    needsEmployee,
  } = assignment
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadError(null)

    const path = `${crypto.randomUUID()}-${file.name}`
    const { error: uploadErr } = await supabase.storage.from('employee-photos').upload(path, file)

    setUploading(false)

    if (uploadErr) {
      setUploadError(uploadErr.message)
      return
    }

    const { data } = supabase.storage.from('employee-photos').getPublicUrl(path)
    setNewPhotoUrl(data.publicUrl)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`role-${idPrefix}`}>תפקיד</Label>
        <select
          id={`role-${idPrefix}`}
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
              <div className="flex items-center gap-3">
                {newPhotoUrl && (
                  <img src={newPhotoUrl} alt="" className="size-12 shrink-0 rounded-full object-cover" />
                )}
                <Input type="file" accept="image/*" disabled={uploading} onChange={handlePhotoChange} />
              </div>
              {uploadError && <p className="text-destructive text-sm">{uploadError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
