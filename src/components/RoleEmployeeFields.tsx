import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { roleLabels } from '@/lib/roleLabels'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AppRole } from '@/lib/types'
import type { Employee, RoleEmployeeAssignment } from '@/hooks/useRoleEmployeeAssignment'

const selectClass =
  'border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

// "מנהל/ת מתחם" isn't a real AppRole -- it's a bartender account with
// employees.can_supervise_area set, the eligibility flag for the area-
// supervisor duty in the onboarding wizard. Folding it into this one
// dropdown (instead of a separate bartender-only checkbox) is a
// deliberate UI convenience: picking it sets role='bartender' and the
// flag together; picking plain "ברמן/ית" clears the flag. Administrator
// and shift_manager are already auto-eligible for that duty regardless
// of the flag, so switching to/from those leaves it untouched.
type RoleFieldValue = AppRole | 'area_supervisor'

const roleFieldLabels: Record<RoleFieldValue, string> = {
  administrator: roleLabels.administrator,
  shift_manager: roleLabels.shift_manager,
  bartender: roleLabels.bartender,
  area_supervisor: 'מנהל/ת מתחם',
}

const roleFieldOrder: RoleFieldValue[] = ['administrator', 'shift_manager', 'bartender', 'area_supervisor']

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
    canSuperviseArea,
    setCanSuperviseArea,
    needsEmployee,
  } = assignment
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => {
    if (employeeMode !== 'link' || !employeeId) return
    const emp = employees.find((e) => e.id === employeeId)
    if (emp) {
      setNewName(emp.full_name)
      setNewPhone(emp.phone ?? '')
      setNewPhotoUrl(emp.photo_url)
      setCanSuperviseArea(!!emp.can_supervise_area)
    }
  }, [employeeMode, employeeId, employees, setNewName, setNewPhone, setNewPhotoUrl, setCanSuperviseArea])

  const roleFieldValue: RoleFieldValue | '' = role === '' ? '' : role === 'bartender' && canSuperviseArea ? 'area_supervisor' : role

  function handleRoleFieldChange(value: RoleFieldValue) {
    if (value === 'area_supervisor') {
      setRole('bartender')
      setCanSuperviseArea(true)
      return
    }
    setRole(value)
    if (value === 'bartender') {
      setCanSuperviseArea(false)
    }
  }

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
          value={roleFieldValue}
          onChange={(e) => handleRoleFieldChange(e.target.value as RoleFieldValue)}
        >
          <option value="" disabled>
            בחר תפקיד
          </option>
          {roleFieldOrder.map((r) => (
            <option key={r} value={r}>
              {roleFieldLabels[r]}
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

          {employeeMode === 'link' && (
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
          )}

          {(employeeMode === 'create' || (employeeMode === 'link' && employeeId)) && (
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
