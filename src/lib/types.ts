export type AppRole =
  | 'administrator'
  | 'bar_manager'
  | 'shift_manager'
  | 'employee'
  | 'viewer'

export type AppUserStatus = 'pending_approval' | 'approved' | 'suspended'

export interface AppUser {
  id: string
  role: AppRole | null
  status: AppUserStatus
  employee_id: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export type ShiftStatus = 'draft' | 'published' | 'completed' | 'cancelled' | 'reopened'

export type EffectiveShiftStatus =
  | 'draft'
  | 'published'
  | 'active'
  | 'waiting_for_closure'
  | 'completed'
  | 'cancelled'
  | 'reopened'

export interface Shift {
  id: string
  start_time: string
  end_time: string
  shift_type: string
  shift_manager_id: string | null
  notes: string | null
  status: ShiftStatus
  created_by: string
  created_at: string
  updated_at: string
  effective_status: EffectiveShiftStatus
}
