import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Clock, Package, ShoppingCart, Truck, Users, CalendarDays, type LucideIcon } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { roleLabels, ROLES_VIEWING_SHIFTS } from '@/lib/roleLabels'
import { purchaseOrderStatusBadgeClass, purchaseOrderStatusLabels } from '@/lib/purchaseOrderLabels'
import { useAppUserContext } from '@/lib/outletContext'
import { effectiveStatusLabels } from '@/lib/shiftLabels'
import { cn, formatDate, formatDateTime, formatTime } from '@/lib/utils'
import { SelfCheckIn } from '@/components/SelfCheckIn'
import type {
  EffectiveShiftStatus,
  PurchaseOrder,
  PurchaseOrderItem,
  ReplacementRequest,
  Shift,
  ShiftAssignment,
  Supplier,
} from '@/lib/types'

interface EmployeeNameRow {
  id: string
  full_name: string
}

function ShiftSection({ title, shifts }: { title: string; shifts: Shift[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {shifts.length === 0 && <p className="text-muted-foreground text-sm">אין משמרות</p>}
        {shifts.map((shift) => (
          <Link
            key={shift.id}
            to={`/shifts/${shift.id}`}
            className="hover:bg-accent flex flex-col rounded-md border p-3 text-sm transition-colors"
          >
            <span className="font-medium">{shift.shift_type}</span>
            <span className="text-muted-foreground">
              {formatDateTime(shift.start_time)} – {formatDateTime(shift.end_time)}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

function ClosingAlertCard({ shifts, employeeNames }: { shifts: Shift[]; employeeNames: Map<string, string> }) {
  const needsClosing = shifts.filter(
    (s) => s.effective_status === 'waiting_for_closure' || s.effective_status === 'reopened',
  )

  if (needsClosing.length === 0) return null

  return (
    <Card className="border-amber-500/60 bg-amber-50 dark:bg-amber-950/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-amber-800 dark:text-amber-400">
            משמרות ממתינות לסגירה ({needsClosing.length})
          </CardTitle>
          <Clock className="size-5 text-amber-600" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {needsClosing.map((shift) => (
          <div
            key={shift.id}
            className="bg-background flex items-center justify-between gap-3 rounded-md border border-amber-500/40 p-3 text-sm"
          >
            <div>
              <p className="font-medium">
                {formatDate(shift.start_time)} — {shift.shift_type}
              </p>
              <p className="text-muted-foreground">
                {shift.shift_manager_id ? (employeeNames.get(shift.shift_manager_id) ?? '—') : 'לא הוגדר אחראי משמרת'}
                {' • '}
                {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to={`/shifts/${shift.id}/close`}>סיום משמרת</Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function StatCard({
  icon: Icon,
  value,
  label,
  colorClass,
  to,
}: {
  icon: LucideIcon
  value: number
  label: string
  colorClass: string
  to?: string
}) {
  const content = (
    <Card className={cn(to && 'hover:bg-accent transition-colors')}>
      <CardContent className="flex flex-col items-start gap-3 pt-6">
        <div className={cn('flex size-10 items-center justify-center rounded-lg', colorClass)}>
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-2xl font-semibold">{value}</p>
          <p className="text-muted-foreground text-xs">{label}</p>
        </div>
      </CardContent>
    </Card>
  )

  return to ? <Link to={to}>{content}</Link> : content
}

interface ManagerStats {
  openOrders: number
  activeProducts: number
  activeSuppliers: number
  shiftsThisWeek: number
  activeEmployees: number
  lowStockProducts: number
}

function ManagerSummary({ shifts }: { shifts: Shift[] }) {
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
  const upcomingShifts = shifts.filter((s) => s.effective_status === 'published')

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          icon={AlertTriangle}
          value={stats.lowStockProducts}
          label="מוצרים מתחת למינימום"
          colorClass="bg-red-100 text-red-600"
          to="/purchase-orders/reorder"
        />
        <StatCard icon={ShoppingCart} value={stats.openOrders} label="הזמנות פתוחות" colorClass="bg-rose-100 text-rose-600" />
        <StatCard icon={Package} value={stats.activeProducts} label="מוצרים פעילים" colorClass="bg-amber-100 text-amber-600" />
        <StatCard icon={Truck} value={stats.activeSuppliers} label="ספקים פעילים" colorClass="bg-emerald-100 text-emerald-600" />
        <StatCard icon={CalendarDays} value={stats.shiftsThisWeek} label="משמרות השבוע" colorClass="bg-violet-100 text-violet-600" />
        <StatCard icon={Users} value={stats.activeEmployees} label="עובדים פעילים" colorClass="bg-blue-100 text-blue-600" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">הזמנות רכש אחרונות</CardTitle>
            <Link to="/purchase-orders" className="text-muted-foreground text-xs hover:underline">
              הצג הכל
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentOrders.length === 0 && <p className="text-muted-foreground text-sm">אין הזמנות רכש עדיין.</p>}
            {recentOrders.map((order) => (
              <Link
                key={order.id}
                to={`/purchase-orders/${order.id}`}
                className="hover:bg-accent flex items-center justify-between rounded-md border p-2 text-sm transition-colors"
              >
                <div>
                  <p className="font-medium">{supplierNames.get(order.supplier_id) ?? '—'}</p>
                  <p className="text-muted-foreground text-xs">
                    {order.order_number} • {formatDate(order.created_at)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={cn(
                      'rounded-full px-2 py-1 text-xs font-medium',
                      purchaseOrderStatusBadgeClass[order.status],
                    )}
                  >
                    {purchaseOrderStatusLabels[order.status]}
                  </span>
                  <span className="text-muted-foreground">₪{(orderTotals[order.id] ?? 0).toFixed(2)}</span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">משמרות קרובות</CardTitle>
            <Link to="/shifts" className="text-muted-foreground text-xs hover:underline">
              הצג הכל
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {upcomingShifts.length === 0 && <p className="text-muted-foreground text-sm">אין משמרות קרובות</p>}
            {upcomingShifts.map((shift) => (
              <Link
                key={shift.id}
                to={`/shifts/${shift.id}`}
                className="hover:bg-accent flex flex-col rounded-md border p-2 text-sm transition-colors"
              >
                <span className="font-medium">{shift.shift_type}</span>
                <span className="text-muted-foreground">
                  {formatDateTime(shift.start_time)} – {formatDateTime(shift.end_time)}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function ManagerDashboard() {
  const { effectiveRole } = useAppUserContext()
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [pendingRequestShifts, setPendingRequestShifts] = useState<Shift[]>([])
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

      const { data: pendingRequests } = await supabase
        .from('replacement_requests')
        .select('*')
        .eq('status', 'pending')

      const requests = (pendingRequests as ReplacementRequest[]) ?? []
      if (requests.length === 0) {
        setPendingRequestShifts([])
        return
      }

      const { data: assignments } = await supabase
        .from('shift_assignments')
        .select('*')
        .in(
          'id',
          requests.map((r) => r.shift_assignment_id),
        )

      const shiftIds = new Set((assignments as ShiftAssignment[])?.map((a) => a.shift_id))
      setPendingRequestShifts(loadedShifts.filter((s) => shiftIds.has(s.id)))
    }

    load()
  }, [])

  if (!shifts) return null

  const byStatus = (status: EffectiveShiftStatus) => shifts.filter((s) => s.effective_status === status)
  const understaffed = shifts.filter(
    (s) =>
      (s.effective_status === 'published' || s.effective_status === 'active') &&
      s.required_staff_count !== null &&
      s.assigned_count < s.required_staff_count,
  )
  const canManage = effectiveRole === 'administrator'

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <ClosingAlertCard shifts={shifts} employeeNames={employeeNames} />

      <div>
        <h1 className="text-xl font-semibold">לוח בקרה</h1>
        <p className="text-muted-foreground text-sm">ברבורג — ניהול הבר הקהילתי</p>
      </div>

      {canManage && <ManagerSummary shifts={shifts} />}

      <ShiftSection title={effectiveStatusLabels.active} shifts={byStatus('active')} />
      <ShiftSection title="משמרות בתת-איוש" shifts={understaffed} />
      <ShiftSection title="בקשות החלפה ממתינות" shifts={pendingRequestShifts} />
      <ShiftSection title={effectiveStatusLabels.published} shifts={byStatus('published')} />
      <ShiftSection title={effectiveStatusLabels.waiting_for_closure} shifts={byStatus('waiting_for_closure')} />
    </div>
  )
}

function EmployeeDashboard({ employeeId }: { employeeId: string }) {
  const [upcoming, setUpcoming] = useState<Shift[] | null>(null)
  const [assignmentIdByShiftId, setAssignmentIdByShiftId] = useState<Map<string, string>>(new Map())
  const [pendingRequestCount, setPendingRequestCount] = useState(0)

  useEffect(() => {
    async function load() {
      const { data: assignments } = await supabase
        .from('shift_assignments')
        .select('*')
        .eq('employee_id', employeeId)

      const loadedAssignments = (assignments as ShiftAssignment[]) ?? []
      setAssignmentIdByShiftId(new Map(loadedAssignments.map((a) => [a.shift_id, a.id])))

      if (loadedAssignments.length === 0) {
        setUpcoming([])
        setPendingRequestCount(0)
        return
      }

      const [shiftsRes, requestsRes] = await Promise.all([
        supabase
          .from('shifts_with_effective_status')
          .select('*')
          .in(
            'id',
            loadedAssignments.map((a) => a.shift_id),
          )
          .in('effective_status', ['published', 'active'])
          .order('start_time', { ascending: true }),
        supabase
          .from('replacement_requests')
          .select('id')
          .in(
            'shift_assignment_id',
            loadedAssignments.map((a) => a.id),
          )
          .eq('status', 'pending'),
      ])

      setUpcoming((shiftsRes.data as Shift[]) ?? [])
      setPendingRequestCount(requestsRes.data?.length ?? 0)
    }

    load()
  }, [employeeId])

  if (upcoming === null) return null

  const [nextShift, ...rest] = upcoming

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">המשמרת הבאה שלי</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {nextShift ? (
            <>
              <Link to="/my-shifts" className="flex flex-col text-sm">
                <span className="font-medium">{nextShift.shift_type}</span>
                <span className="text-muted-foreground">
                  {formatDateTime(nextShift.start_time)} – {formatDateTime(nextShift.end_time)}
                </span>
              </Link>
              {nextShift.effective_status === 'active' &&
                assignmentIdByShiftId.get(nextShift.id) && (
                  <SelfCheckIn shiftAssignmentId={assignmentIdByShiftId.get(nextShift.id)!} />
                )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">אין משמרות קרובות.</p>
          )}
        </CardContent>
      </Card>

      {rest.length > 0 && <ShiftSection title="משמרות קרובות" shifts={rest} />}

      {pendingRequestCount > 0 && (
        <Card>
          <CardContent className="pt-6 text-sm">
            <Link to="/my-shifts" className="text-muted-foreground">
              {pendingRequestCount} בקש{pendingRequestCount === 1 ? 'ת' : 'ות'} החלפה ממתינות לאישור
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function Dashboard() {
  const { appUser, effectiveRole } = useAppUserContext()

  if (ROLES_VIEWING_SHIFTS.includes(effectiveRole)) {
    return <ManagerDashboard />
  }

  if (effectiveRole === 'bartender' && appUser.employee_id) {
    return <EmployeeDashboard employeeId={appUser.employee_id} />
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
