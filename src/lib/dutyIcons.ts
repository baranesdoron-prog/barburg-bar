import { Beer, Martini, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import { C } from '@/lib/designTokens'
import type { ShiftAssignmentRole } from '@/lib/types'

// Same duty icons/colors as the redesigned /shifts page's duty cards.
export const DUTY_ICON: Record<ShiftAssignmentRole, LucideIcon> = {
  bar_manager: Martini,
  bartender: Beer,
  area_manager: Users,
  area_supervisor: ShieldCheck,
}
export const DUTY_ICON_BG: Record<ShiftAssignmentRole, string> = {
  bar_manager: C.primary,
  bartender: C.accent,
  area_manager: '#3F8F6B',
  area_supervisor: C.info,
}
