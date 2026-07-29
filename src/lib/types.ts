export type AppRole =
  | 'administrator'
  | 'shift_manager'
  | 'bartender'

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

export type EmployeeInviteStatus = 'pending' | 'claimed' | 'cancelled'

export interface EmployeeInvite {
  id: string
  email: string
  role: AppRole
  employee_id: string | null
  status: EmployeeInviteStatus
  invited_by: string
  claimed_by: string | null
  claimed_at: string | null
  created_at: string
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

export type AttendanceStatus = 'present' | 'absent' | 'late'

export interface AttendanceRecord {
  id: string
  shift_assignment_id: string
  status: AttendanceStatus
  note: string | null
  recorded_by: string
  created_at: string
  updated_at: string
}

export type JournalCategory =
  | 'equipment_issue'
  | 'broken_equipment'
  | 'items_missing'
  | 'special_event'
  | 'improvement_suggestion'
  | 'positive_feedback'
  | 'general_note'

export interface JournalEntry {
  id: string
  shift_id: string
  category: JournalCategory
  description: string
  quantity: number | null
  requires_follow_up: boolean
  photo_url: string | null
  author: string
  created_at: string
}

export type InventoryUnitType = 'single' | 'box'

export interface InventoryItem {
  id: string
  name: string
  unit: string | null
  category: string | null
  vendor: string | null
  sku: string | null
  supplier_id: string | null
  unit_type: InventoryUnitType
  units_per_box: number | null
  unit_price: number | null
  minimum_quantity: number | null
  image_url: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface InventoryItemWithStock extends InventoryItem {
  latest_counted_quantity: number | null
  latest_counted_at: string | null
}

export interface InventoryCount {
  id: string
  shift_id: string
  inventory_item_id: string
  quantity_counted: number
  recorded_by: string
  created_at: string
  updated_at: string
}

export interface ShiftReportRow {
  id: string
  shift_id: string
  generated_by: string
  generated_at: string
  snapshot: {
    shift: Shift
    attendance: {
      employee_id: string
      employee_name: string
      status: AttendanceStatus | null
      note: string | null
    }[]
    journal_entries: {
      category: JournalCategory
      description: string
      quantity: number | null
      requires_follow_up: boolean
      author_id: string
      created_at: string
    }[]
    inventory_counts: {
      item_name: string
      unit: string | null
      quantity_counted: number
    }[]
  }
}

export interface Supplier {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export type PurchaseOrderStatus = 'draft' | 'ordered' | 'received' | 'cancelled'

export interface PurchaseOrder {
  id: string
  order_number: string
  supplier_id: string
  status: PurchaseOrderStatus
  notes: string | null
  created_by: string
  ordered_at: string | null
  received_at: string | null
  created_at: string
  updated_at: string
}

export interface PurchaseOrderItem {
  id: string
  purchase_order_id: string
  inventory_item_id: string
  quantity: number
  unit_price: number | null
  created_at: string
}
