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
