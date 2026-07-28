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
  required_staff_count: number | null
  created_by: string
  created_at: string
  updated_at: string
  effective_status: EffectiveShiftStatus
  assigned_count: number
}

export interface ShiftAssignment {
  id: string
  shift_id: string
  employee_id: string
  created_at: string
}

export type ReplacementRequestStatus = 'pending' | 'approved' | 'rejected'

export interface ReplacementRequest {
  id: string
  shift_assignment_id: string
  requested_by: string
  reason: string | null
  substitute_employee_id: string | null
  status: ReplacementRequestStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
}
