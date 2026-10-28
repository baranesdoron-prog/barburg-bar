import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  Clock,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Tag,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { roleLabels, ROLES_MANAGING_SHIFTS, ROLES_VIEWING_SHIFTS } from '@/lib/roleLabels'
import { formatMoney, purchaseOrderStatusLabels, purchaseOrderStatusTone } from '@/lib/purchaseOrderLabels'
import { useAppUserContext } from '@/lib/outletContext'
import { hasCheckedWizardLandingThisSession, markWizardLandingChecked } from '@/lib/onboardingWizard'
import { formatTime } from '@/lib/utils'
import { activeWeekStart, addDays, parseDateStr, shiftDateOfWeek, toDateStr } from '@/lib/weeklyChecklist'
import { C, CATEGORY_COLORS } from '@/lib/designTokens'
import { DUTY_ICON, DUTY_ICON_BG } from '@/lib/dutyIcons'
import type {
  AppRole,
  AppSettings,
  PurchaseOrder,
  PurchaseOrderItem,
  Shift,
  ShiftAssignmentRole,
  ShiftManagerAssignment,
  Supplier,
  WeeklyChecklistItem,
} from '@/lib/types'

const dayMonthFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric' })
const longDayMonthFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' })
const weekdayDateFormatter = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  day: 'numeric',
  month: 'numeric',
  timeZone: 'Asia/Jerusalem',
})

interface EmployeeNameRow {
  id: string
  full_name: string
}

// Section heading with an optional "see all" link on the far side.
function SectionHeader({ title, link }: { title: string; link?: { to: string; label: string } }) {
  return (
    <div className="flex items-baseline justify-between px-0.5">
      <h2 className="text-[17px] font-bold" style={{ color: C.text }}>
        {title}
      </h2>
      {link && (
        <Link to={link.to} className="text-[13px] font-semibold" style={{ color: C.textSecondary }}>
          {link.label}
        </Link>
      )}
    </div>
  )
}

function ClosingAlertCard({ shifts, employeeNames }: { shifts: Shift[]; employeeNames: Map<string, string> }) {
  // Only the current/upcoming week's shifts belong here -- anything from a
  // past week is stale and lives in the archive instead, same cutoff as
  // the allocations view.
  const cutoff = toDateStr(activeWeekStart())
  const needsClosing = shifts.filter(
    (s) =>
      s.shift_type === 'closing' &&
      (s.effective_status === 'waiting_for_closure' || s.effective_status === 'reopened') &&
      s.week_start >= cutoff,
  )

  if (needsClosing.length === 0) return null

  return (
    <section
      className="flex flex-col gap-2.5 rounded-[20px] border p-3.5"
      style={{ background: C.warningBg, borderColor: '#F3D9A8' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="size-5" style={{ color: C.warning }} />
          <h2 className="text-base font-bold" style={{ color: '#8A5000' }}>
            ממתינה לסגירה
          </h2>
        </div>
        <span
          className="flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[13px] font-bold text-white"
          style={{ background: C.warning }}
        >
          {needsClosing.length}
        </span>
      </div>
      {needsClosing.map((shift) => (
        <div key={shift.id} className="flex items-center justify-between gap-2.5 rounded-[14px] p-3" style={{ background: C.card }}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-bold" style={{ color: C.text }}>
              {weekdayDateFormatter.format(new Date(shift.start_time))}
            </span>
            <span className="text-[13px]" style={{ color: C.textSecondary }}>
              {shift.shift_manager_id ? (employeeNames.get(shift.shift_manager_id) ?? '—') : 'לא הוגדר מנהל בר'}
              {' · '}
              {formatTime(shift.start_time)}–{formatTime(shift.end_time)}
            </span>
          </div>
          <Link
            to={`/shifts/${shift.id}/close`}
            className="flex h-10 shrink-0 items-center rounded-xl px-3.5 text-sm font-bold text-white"
            style={{ background: C.primary }}
          >
            סיום משמרת
          </Link>
        </div>
      ))}
    </section>
  )
}

function StatTile({
  icon: Icon,
  value,
  label,
  tone,
  to,
}: {
  icon: LucideIcon
  value: number
  label: string
  tone: { bg: string; fg: string; number?: string }
  to: string
}) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-2.5 rounded-[18px] border p-3.5"
      style={{ background: C.card, borderColor: C.border, color: C.text }}
    >
      <div className="flex size-[38px] items-center justify-center rounded-xl" style={{ background: tone.bg }}>
        <Icon className="size-5" style={{ color: tone.fg }} />
      </div>
      <div className="flex flex-col">
        <span className="text-[26px] leading-tight font-extrabold" style={{ color: value > 0 ? (tone.number ?? C.text) : C.text }}>
          {value}
        </span>
        <span className="text-[13px]" style={{ color: C.textSecondary }}>
          {label}
        </span>
      </div>
    </Link>
  )
}

function OverviewCell({ icon: Icon, value, label, to, className }: { icon: LucideIcon; value: number; label: string; to: string; className?: string }) {
  return (
    <Link to={to} className={`flex items-center gap-2.5 p-3.5 ${className ?? ''}`} style={{ borderColor: C.border, color: C.text }}>
      <Icon className="size-5 shrink-0" style={{ color: C.primary }} />
      <div className="flex flex-col">
        <span className="text-lg font-extrabold">{value}</span>
        <span className="text-xs" style={{ color: C.textSecondary }}>
          {label}
        </span>
      </div>
    </Link>
  )
}

interface ManagerStats {
  openOrders: number
  activeProducts: number
  activeSuppliers: number
  shiftsThisWeek: number
  activeEmployees: number
  lowStockProducts: number
  unclassifiedProducts: number
  unassignedSupplierProducts: number
}

function ManagerSummary() {
  const [stats, setStats] = useState<ManagerStats | null>(null)
  const [recentOrders, setRecentOrders] = useState<PurchaseOrder[]>([])
  const [orderTotals, setOrderTotals] = useState<Record<string, number>>({})
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  useEffect(() => {
    async function load() {
      const now = new Date()
      const weekStart = new Date(now)
      weekStart.setHours(0, 0, 0, 0)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 7)

      const [
        openOrdersRes,
        activeProductsRes,
        activeSuppliersRes,
        shiftsThisWeekRes,
        activeEmployeesRes,
        lowStockRes,
        unclassifiedRes,
        unassignedSupplierRes,
        ordersRes,
        suppliersRes,
      ] = await Promise.all([
        supabase
          .from('purchase_orders')
          .select('id', { count: 'exact', head: true })
          .in('status', ['draft', 'ordered']),
        supabase.from('inventory_items').select('id', { count: 'exact', head: true }).eq('active', true),
        supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('active', true),
        supabase
          .from('shifts')
          .select('id', { count: 'exact', head: true })
          .neq('status', 'cancelled')
          .gte('start_time', weekStart.toISOString())
          .lt('start_time', weekEnd.toISOString()),
        supabase.from('employees').select('id', { count: 'exact', head: true }).eq('active', true),
        supabase
          .from('inventory_items_with_latest_count')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .eq('is_low_stock', true),
        supabase
          .from('inventory_items')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .is('category_id', null),
        supabase
          .from('inventory_items_with_latest_count')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .is('resolved_supplier_id', null),
        supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('suppliers').select('*'),
      ])

      setStats({
        openOrders: openOrdersRes.count ?? 0,
        activeProducts: activeProductsRes.count ?? 0,
        activeSuppliers: activeSuppliersRes.count ?? 0,
        shiftsThisWeek: shiftsThisWeekRes.count ?? 0,
        activeEmployees: activeEmployeesRes.count ?? 0,
        lowStockProducts: lowStockRes.count ?? 0,
        unclassifiedProducts: unclassifiedRes.count ?? 0,
        unassignedSupplierProducts: unassignedSupplierRes.count ?? 0,
      })

      const orders = (ordersRes.data as PurchaseOrder[]) ?? []
      setRecentOrders(orders)
      setSuppliers((suppliersRes.data as Supplier[]) ?? [])

      if (orders.length > 0) {
        const { data: items } = await supabase
          .from('purchase_order_items')
          .select('*')
          .in(
            'purchase_order_id',
            orders.map((o) => o.id),
          )

        const sums: Record<string, number> = {}
        for (const item of (items as PurchaseOrderItem[]) ?? []) {
          const lineTotal = item.quantity * (item.unit_price ?? 0)
          sums[item.purchase_order_id] = (sums[item.purchase_order_id] ?? 0) + lineTotal
        }
        setOrderTotals(sums)
      }
    }

    load()
  }, [])

  if (!stats) return null

  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]))

  return (
    <>
      <section className="flex flex-col gap-2.5">
        <SectionHeader title="דורש טיפול" />
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile
            icon={AlertTriangle}
            value={stats.lowStockProducts}
            label="מתחת למינימום"
            tone={{ bg: C.errorBg, fg: C.error, number: C.error }}
            to="/purchase-orders/reorder"
          />
          <StatTile
            icon={ShoppingCart}
            value={stats.openOrders}
            label="הזמנות פתוחות"
            tone={{ bg: C.accentLight, fg: C.warning }}
            to="/purchase-orders"
          />
          <StatTile
            icon={Tag}
            value={stats.unclassifiedProducts}
            label="מוצרים ללא סיווג"
            tone={{ bg: C.warningBg, fg: C.warning }}
            to="/inventory/items?unclassified=1"
          />
          <StatTile
            icon={Truck}
            value={stats.unassignedSupplierProducts}
            label="מוצרים ללא ספק"
            tone={{ bg: C.warningBg, fg: C.warning }}
            to="/inventory/items?unassigned_supplier=1"
          />
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionHeader title="סקירה כללית" />
        <div className="grid grid-cols-2 overflow-hidden rounded-[20px] border" style={{ background: C.card, borderColor: C.border }}>
          <OverviewCell icon={Package} value={stats.activeProducts} label="מוצרים פעילים" to="/inventory/items" className="border-e border-b" />
          <OverviewCell icon={Truck} value={stats.activeSuppliers} label="ספקים פעילים" to="/suppliers" className="border-b" />
          <OverviewCell icon={CalendarDays} value={stats.shiftsThisWeek} label="משמרות השבוע" to="/shifts" className="border-e" />
          <OverviewCell icon={Users} value={stats.activeEmployees} label="עובדים פעילים" to="/admin/users" />
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionHeader title="הזמנות רכש אחרונות" link={{ to: '/purchase-orders', label: 'הצג הכל' }} />
        {recentOrders.length === 0 && (
          <p className="text-sm" style={{ color: C.textMuted }}>
            אין הזמנות רכש עדיין.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {recentOrders.map((order, index) => {
            const supplierName = supplierNames.get(order.supplier_id) ?? '—'
            const tone = purchaseOrderStatusTone[order.status]
            return (
              <Link
                key={order.id}
                to={`/purchase-orders/${order.id}`}
                className="flex items-center gap-3 rounded-2xl border p-3"
                style={{ background: C.card, borderColor: C.border, color: C.text }}
              >
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl text-[17px] font-extrabold text-white"
                  style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}
                >
                  {supplierName.charAt(0)}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-bold">{supplierName}</span>
                  <span className="text-xs" style={{ color: C.textMuted }}>
                    {order.order_number} · {dayMonthFormatter.format(new Date(order.created_at))}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${order.status === 'cancelled' ? 'line-through' : ''}`}
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    {purchaseOrderStatusLabels[order.status]}
                  </span>
                  <span className="text-[13px] font-bold">{formatMoney(orderTotals[order.id] ?? 0)}</span>
                </div>
              </Link>
            )
          })}
        </div>
      </section>
    </>
  )
}

interface ShiftManagerEmployee {
  id: string
  full_name: string
}

// One duty row of the management card: the duty's icon, who holds it (or
// "חסר שיבוץ"), and a picker styled as a small button -- a real <select>
// laid invisibly over it, so the phone's native picker opens on tap.
function StaffingRow({
  role,
  label,
  assignedName,
  isMe,
  options,
  disabled,
  extra,
  onPick,
}: {
  role: ShiftAssignmentRole
  label: string
  assignedName: string | null
  isMe: boolean
  options: ShiftManagerEmployee[]
  disabled: boolean
  extra?: ReactNode
  onPick: (employeeId: string) => void
}) {
  const Icon = DUTY_ICON[role]
  const missing = !assignedName

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full" style={{ background: DUTY_ICON_BG[role] }}>
        <Icon className="size-5 text-white" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs" style={{ color: C.textMuted }}>
          {label}
        </span>
        <span className="truncate text-[15px] font-bold" style={{ color: missing ? C.warning : C.text }}>
          {assignedName ?? 'חסר שיבוץ'}
          {isMe && (
            <span className="font-semibold" style={{ color: C.success }}>
              {' '}
              (את/ה)
            </span>
          )}
        </span>
      </div>
      {extra}
      <div
        className="relative flex h-9 shrink-0 items-center rounded-xl border px-3 text-[13px]"
        style={
          missing
            ? { background: C.warningBg, borderColor: '#F3D9A8', color: '#8A5000', fontWeight: 700 }
            : { background: C.card, borderColor: C.border, color: C.textSecondary, fontWeight: 600 }
        }
      >
        {missing ? 'בחירה' : 'החלפה'}
        <select
          aria-label={`${missing ? 'בחירת' : 'החלפת'} ${label}`}
          className="absolute inset-0 cursor-pointer opacity-0"
          value=""
          disabled={disabled}
          onChange={(e) => onPick(e.target.value)}
        >
          <option value="" disabled>
            {label}
          </option>
          {options.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

// Bar manager (week-level shift_manager_assignments) and area supervisor
// for this week and next, in one card. Area supervisor ("מנהל/ת מתחם") is
// one person for the whole night like bar manager, but there's no week-level
// table for it -- just a pair of shift_assignments rows (opening + closing)
// always written/removed together, matching WeekCard's
// handleSetAreaSupervisor in Shifts.tsx.
function ManagementStaffingCard({ employeeNames, myEmployeeId }: { employeeNames: Map<string, string>; myEmployeeId: string | null }) {
  const weeks = [toDateStr(activeWeekStart()), toDateStr(addDays(activeWeekStart(), 7))]
  const [barManagerOptions, setBarManagerOptions] = useState<ShiftManagerEmployee[]>([])
  const [barManagers, setBarManagers] = useState<Map<string, string>>(new Map())
  const [taskStats, setTaskStats] = useState<{ completed: number; total: number } | null>(null)
  const [supervisorOptions, setSupervisorOptions] = useState<ShiftManagerEmployee[]>([])
  const [shiftIdsByWeek, setShiftIdsByWeek] = useState<Map<string, string[]>>(new Map())
  const [supervisors, setSupervisors] = useState<Map<string, string>>(new Map())
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadBarManagers() {
    const [employeesRes, assignmentsRes] = await Promise.all([
      supabase.rpc('list_shift_manager_employees'),
      supabase.from('shift_manager_assignments').select('*').in('week_start', weeks),
    ])
    setBarManagerOptions((employeesRes.data as ShiftManagerEmployee[]) ?? [])
    const loadedAssignments = new Map(
      ((assignmentsRes.data as ShiftManagerAssignment[]) ?? []).map((a) => [a.week_start, a.employee_id]),
    )
    setBarManagers(loadedAssignments)

    const currentWeek = weeks[0]
    if (loadedAssignments.has(currentWeek)) {
      const { data: items } = await supabase.rpc('ensure_weekly_checklist', { p_week_start: currentWeek })
      const allItems = (items as WeeklyChecklistItem[]) ?? []
      setTaskStats({ completed: allItems.filter((i) => i.completed).length, total: allItems.length })
    } else {
      setTaskStats(null)
    }
  }

  async function loadSupervisors() {
    await supabase.rpc('ensure_upcoming_shifts')

    const [shiftsRes, employeesRes, rolesRes] = await Promise.all([
      supabase.from('shifts').select('id, week_start, shift_type').in('week_start', weeks),
      supabase.from('employees').select('id, full_name, can_supervise_area').order('full_name'),
      supabase.rpc('list_employee_roles'),
    ])

    const shiftsByWeek = new Map<string, string[]>()
    for (const s of (shiftsRes.data as { id: string; week_start: string; shift_type: string }[]) ?? []) {
      shiftsByWeek.set(s.week_start, [...(shiftsByWeek.get(s.week_start) ?? []), s.id])
    }
    setShiftIdsByWeek(shiftsByWeek)

    const roleByEmployeeId = new Map(
      ((rolesRes.data as { employee_id: string; role: string | null }[]) ?? []).map((r) => [r.employee_id, r.role]),
    )
    const allEmployees = (employeesRes.data as { id: string; full_name: string; can_supervise_area: boolean }[]) ?? []
    // Admins can cover area-supervisor duty too, on top of the explicit
    // can_supervise_area allow-list -- matches AllocationsList in Shifts.tsx.
    setSupervisorOptions(allEmployees.filter((e) => e.can_supervise_area || roleByEmployeeId.get(e.id) === 'administrator'))

    const allShiftIds = [...shiftsByWeek.values()].flat()
    if (allShiftIds.length === 0) {
      setSupervisors(new Map())
      return
    }

    const { data: assignmentRows } = await supabase
      .from('shift_assignments')
      .select('shift_id, employee_id')
      .in('shift_id', allShiftIds)
      .eq('assignment_role', 'area_supervisor')

    const shiftToWeek = new Map<string, string>()
    for (const [week, ids] of shiftsByWeek) {
      for (const id of ids) shiftToWeek.set(id, week)
    }

    const loadedAssignments = new Map<string, string>()
    for (const row of (assignmentRows as { shift_id: string; employee_id: string }[]) ?? []) {
      const week = shiftToWeek.get(row.shift_id)
      if (week) loadedAssignments.set(week, row.employee_id)
    }
    setSupervisors(loadedAssignments)
  }

  useEffect(() => {
    loadBarManagers()
    loadSupervisors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleAssignBarManager(week: string, employeeId: string) {
    if (!employeeId) return
    setSaving(`bar_manager:${week}`)
    setError(null)
    const { error: assignError } = await supabase.rpc('set_weekly_shift_manager', {
      p_week_start: week,
      p_employee_id: employeeId,
    })
    setSaving(null)
    if (assignError) {
      setError(assignError.message)
      return
    }
    loadBarManagers()
  }

  async function handleAssignSupervisor(week: string, employeeId: string) {
    if (!employeeId) return
    setSaving(`area_supervisor:${week}`)
    setError(null)

    const shiftIds = shiftIdsByWeek.get(week) ?? []
    const { error: deleteError } = await supabase
      .from('shift_assignments')
      .delete()
      .in('shift_id', shiftIds)
      .eq('assignment_role', 'area_supervisor')
    if (deleteError) {
      setError(deleteError.message)
      setSaving(null)
      return
    }

    if (shiftIds.length > 0) {
      const { error: insertError } = await supabase
        .from('shift_assignments')
        .insert(shiftIds.map((shift_id) => ({ shift_id, employee_id: employeeId, assignment_role: 'area_supervisor' })))
      if (insertError) {
        setError(insertError.message)
        setSaving(null)
        return
      }
    }

    setSaving(null)
    loadSupervisors()
  }

  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader title="שיבוץ ניהול" link={{ to: '/shifts', label: 'לכל המשמרות' }} />
      <div className="flex flex-col rounded-[20px] border" style={{ background: C.card, borderColor: C.border }}>
        {weeks.map((week, index) => {
          const barManagerId = barManagers.get(week) ?? null
          const supervisorId = supervisors.get(week) ?? null
          const isCurrentWeek = index === 0
          return (
            <div key={week} className="flex flex-col pb-1.5">
              {index > 0 && <div className="mx-3.5 h-px" style={{ background: C.border }} />}
              <span className="px-3.5 pt-3 pb-0.5 text-[13px] font-bold" style={{ color: C.textSecondary }}>
                {isCurrentWeek ? 'השבוע' : 'שבוע הבא'} · חמישי {dayMonthFormatter.format(shiftDateOfWeek(week))}
              </span>
              <StaffingRow
                role="bar_manager"
                label="מנהל/ת בר"
                assignedName={barManagerId ? (employeeNames.get(barManagerId) ?? '—') : null}
                isMe={!!barManagerId && barManagerId === myEmployeeId}
                options={barManagerOptions}
                disabled={saving === `bar_manager:${week}`}
                extra={
                  isCurrentWeek &&
                  taskStats && (
                    <Link
                      to={`/weekly-checklist?week=${week}`}
                      className="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold"
                      style={{ background: C.successBg, color: C.success }}
                    >
                      {taskStats.completed}/{taskStats.total} משימות
                    </Link>
                  )
                }
                onPick={(employeeId) => handleAssignBarManager(week, employeeId)}
              />
              <StaffingRow
                role="area_supervisor"
                label="מנהל/ת מתחם"
                assignedName={supervisorId ? (employeeNames.get(supervisorId) ?? '—') : null}
                isMe={!!supervisorId && supervisorId === myEmployeeId}
                options={supervisorOptions}
                disabled={saving === `area_supervisor:${week}`}
                onPick={(employeeId) => handleAssignSupervisor(week, employeeId)}
              />
            </div>
          )
        })}
      </div>
      {error && (
        <p className="text-sm" style={{ color: C.error }}>
          {error}
        </p>
      )}
    </section>
  )
}

function MyWeeklyTasksCard({ employeeId }: { employeeId: string }) {
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [items, setItems] = useState<WeeklyChecklistItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const week = toDateStr(activeWeekStart())
      const { data: assignment } = await supabase
        .from('shift_manager_assignments')
        .select('*')
        .eq('week_start', week)
        .maybeSingle()

      if (!assignment || (assignment as ShiftManagerAssignment).employee_id !== employeeId) {
        setWeekStart(null)
        setLoaded(true)
        return
      }

      setWeekStart(week)
      const { data } = await supabase.rpc('ensure_weekly_checklist', { p_week_start: week })
      setItems((data as WeeklyChecklistItem[]) ?? [])
      setLoaded(true)
    }

    load()
  }, [employeeId])

  if (!loaded || !weekStart) return null

  const todayStr = toDateStr(new Date())
  const completedCount = items.filter((i) => i.completed).length
  const openItems = items
    .filter((i) => !i.completed)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 3)

  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader title="המשימות שלי השבוע" link={{ to: `/weekly-checklist?week=${weekStart}`, label: 'לרשימה המלאה' }} />
      <div className="flex flex-col gap-3 rounded-[20px] border p-3.5" style={{ background: C.card, borderColor: C.border }}>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[13px]">
            <span className="font-bold" style={{ color: C.text }}>
              {completedCount} מתוך {items.length} הושלמו
            </span>
            <span style={{ color: C.textMuted }}>משמרת חמישי {dayMonthFormatter.format(shiftDateOfWeek(weekStart))}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: C.subtleBg }}>
            <div
              className="h-2 rounded-full"
              style={{ background: C.success, width: `${items.length > 0 ? (completedCount / items.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        {openItems.length === 0 && (
          <p className="text-sm" style={{ color: C.textMuted }}>
            כל המשימות לשבוע הושלמו.
          </p>
        )}
        {openItems.map((item) => {
          const isLate = !item.is_optional && item.due_date < todayStr
          const isToday = item.due_date === todayStr
          return (
            <div
              key={item.id}
              className="flex items-start gap-2.5 rounded-[14px] px-3 py-2.5"
              style={{ background: isLate ? C.errorBg : C.subtleBg }}
            >
              <span
                aria-hidden="true"
                className="mt-px size-[22px] shrink-0 rounded-[7px] border-2"
                style={{ background: C.card, borderColor: isLate ? C.error : '#B9BFBA' }}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold" style={{ color: C.text }}>
                  {item.title}
                  {item.is_optional && (
                    <span className="font-medium" style={{ color: C.textMuted }}>
                      {' '}
                      (אופציונלי)
                    </span>
                  )}
                </span>
                <span className="text-xs" style={{ color: isLate ? C.error : C.textMuted, fontWeight: isLate ? 700 : 400 }}>
                  {longDayMonthFormatter.format(parseDateStr(item.due_date))}
                  {isLate ? ' · באיחור' : isToday ? ' · היום' : ''}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ManagerDashboard() {
  const { appUser, effectiveRole } = useAppUserContext()
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    async function load() {
      const { data: shiftsData } = await supabase
        .from('shifts_with_effective_status')
        .select('*')
        .order('start_time', { ascending: true })

      const loadedShifts = (shiftsData as Shift[]) ?? []
      setShifts(loadedShifts)

      const { data: employeesData } = await supabase.from('employees').select('id, full_name')
      setEmployeeNames(new Map(((employeesData as EmployeeNameRow[]) ?? []).map((e) => [e.id, e.full_name])))
    }

    load()
  }, [])

  if (!shifts) return null

  const canManage = ROLES_MANAGING_SHIFTS.includes(effectiveRole)

  return (
    <div dir="rtl" className="min-h-svh" style={{ background: C.appBg, color: C.text }}>
      <div className="mx-auto flex max-w-xl flex-col gap-5 pt-1">
        <section className="flex flex-col gap-3 rounded-[20px] p-3.5" style={{ background: C.primaryLight }}>
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-[14px]" style={{ background: C.primary }}>
              <LayoutDashboard className="size-6 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-extrabold" style={{ color: C.primary }}>
                לוח בקרה
              </h1>
              <span className="text-sm" style={{ color: C.primaryHover }}>
                ברבורג — ניהול הבר הקהילתי
              </span>
            </div>
          </div>
          <Link
            to="/onboarding"
            className="flex h-11 items-center justify-center gap-2 rounded-[14px] text-[15px] font-bold"
            style={{ background: C.card, color: C.primary }}
          >
            <CalendarPlus className="size-[18px]" />
            שבץ אותי למשמרת
          </Link>
        </section>

        <ClosingAlertCard shifts={shifts} employeeNames={employeeNames} />

        {effectiveRole === 'shift_manager' && appUser.employee_id && (
          <MyWeeklyTasksCard employeeId={appUser.employee_id} />
        )}

        {canManage && <ManagementStaffingCard employeeNames={employeeNames} myEmployeeId={appUser.employee_id} />}

        {canManage && <ManagerSummary />}
      </div>
    </div>
  )
}

function RoleHome({ effectiveRole }: { effectiveRole: AppRole }) {
  if (ROLES_VIEWING_SHIFTS.includes(effectiveRole)) {
    return <ManagerDashboard />
  }

  if (effectiveRole === 'bartender') {
    return <Navigate to="/shifts" replace />
  }

  return (
    <Card className="mx-auto max-w-md text-center">
      <CardHeader>
        <CardTitle>לוח הבקרה בבנייה</CardTitle>
        <CardDescription>{roleLabels[effectiveRole]}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          תוכן לוח הבקרה יתווסף בהמשך, לפי תפקיד.
        </p>
      </CardContent>
    </Card>
  )
}

// The actual dashboard content, reachable unconditionally at /dashboard
// (the "לוח בקרה" nav link, and every internal "back to dashboard" link)
// -- never runs the wizard check, so it's never blocked by the toggle.
export function DashboardHome() {
  const { effectiveRole } = useAppUserContext()
  return <RoleHome effectiveRole={effectiveRole} />
}

// "/" is a one-shot landing dispatcher, hit only right after login (or a
// fresh page load) -- it decides whether whoever just logged in lands on
// the onboarding wizard first, based on the admin-controlled app_settings
// row (set on /admin/users) and, for "first_login" mode, whether this
// account has ever seen it (app_users.onboarding_seen_at). Applies to
// every role (bartender, bar manager, administrator) alike. Only
// evaluated once per real login (see clearWizardLandingSession in
// App.tsx, called on every SIGNED_IN event) -- after that, or once the
// wizard isn't due, it just forwards to /dashboard, same as the nav link
// would.
export function Dashboard() {
  const { appUser } = useAppUserContext()
  const [alreadyChecked] = useState(() => hasCheckedWizardLandingThisSession(appUser.id))
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    if (alreadyChecked) return
    supabase
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .single()
      .then(({ data }) => setSettings(data as AppSettings | null))
  }, [alreadyChecked])

  if (alreadyChecked) {
    return <Navigate to="/dashboard" replace />
  }

  if (!settings) return null

  markWizardLandingChecked(appUser.id)

  const wizardDue =
    settings.onboarding_wizard_enabled &&
    (settings.onboarding_wizard_frequency === 'every_login' || !appUser.onboarding_seen_at)

  if (wizardDue) {
    return <Navigate to="/onboarding" replace />
  }

  return <Navigate to="/dashboard" replace />
}
