import { useState } from 'react'

import { supabase } from '@/lib/supabase'
import { ROLES_REQUIRING_EMPLOYEE } from '@/lib/roleLabels'
import type { AppRole } from '@/lib/types'

export interface Employee {
  id: string
  full_name: string
}

type ResolveResult = { employeeId: string | null; error?: undefined } | { employeeId?: undefined; error: string }

export function useRoleEmployeeAssignment(initial?: { role?: AppRole | null; employeeId?: string | null }) {
  const [role, setRole] = useState<AppRole | ''>(initial?.role ?? '')
  const [employeeMode, setEmployeeMode] = useState<'link' | 'create'>('link')
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? '')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')

  const needsEmployee = role !== '' && ROLES_REQUIRING_EMPLOYEE.includes(role)

  async function resolve(onEmployeeCreated?: (employee: Employee) => void): Promise<ResolveResult> {
    if (!role) {
      return { error: 'יש לבחור תפקיד' }
    }

    if (!needsEmployee) {
      return { employeeId: null }
    }

    if (employeeMode === 'link') {
      if (!employeeId) {
        return { error: 'יש לבחור עובד/ת קיים/ת' }
      }
      return { employeeId }
    }

    if (!newName.trim()) {
      return { error: 'יש להזין שם מלא' }
    }

    const { data: employee, error } = await supabase
      .from('employees')
      .insert({ full_name: newName.trim(), phone: newPhone.trim() || null })
      .select('id, full_name')
      .single()

    if (error) {
      return { error: error.message }
    }

    onEmployeeCreated?.(employee)
    return { employeeId: employee.id }
  }

  return {
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
    needsEmployee,
    resolve,
  }
}

export type RoleEmployeeAssignment = ReturnType<typeof useRoleEmployeeAssignment>
