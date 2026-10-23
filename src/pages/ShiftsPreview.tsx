import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Clock, Martini, Beer, ShieldCheck, Users, Phone, ChevronLeft, type LucideIcon } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { C } from '@/lib/designTokens'
import { useAppUserContext } from '@/lib/outletContext'
import { ROLES_MANAGING_SHIFTS } from '@/lib/roleLabels'
import { effectiveStatusLabels, shiftAssignmentRoleLabels } from '@/lib/shiftLabels'
import {
  sundaysInYear,
  EARLIEST_WEEK_START,
  YEAR_OPTIONS,
  toDateStr,
  activeWeekStart,
  shiftDateOfWeek,
  weekLabelFormatter,
} from '@/lib/weeklyChecklist'
import { formatTime, cn } from '@/lib/utils'
import {
  useShiftWeeksData,
  mergeDutyPeople,
  friendlyAssignmentError,
  type Duty,
  weekNeedsClosing,
  ARCHIVE_CUTOFF,
  FETCH_FROM,
  AREA_SUPERVISOR_HOURS,
  type WeekShifts,
  type ShiftCountInfo,
  type DutyPerson,
  type Employee,
} from '@/pages/Shifts'
import { useConfirmAssign, type ConfirmAssignState } from '@/hooks/useConfirmAssign'
import { ConfirmAssignDialog } from '@/components/ConfirmAssignDialog'
import { useInfoDialog, type InfoDialogState } from '@/hooks/useInfoDialog'
import { InfoDialog } from '@/components/InfoDialog'
import { SHIFTS_LEGACY_ACCESS_USER_IDS } from '@/lib/shiftsLegacyAccess'
import type { Shift, ShiftAssignment, ShiftAssignmentRole, EffectiveShiftStatus } from '@/lib/types'

const currentYear = new Date().getFullYear()

const pickerSelectClass = 'h-8 max-w-[65%] rounded-lg border px-2 text-xs font-semibold outline-none'
const pickerSelectStyle = { borderColor: C.border, background: C.card, color: C.text }

// Plain name, plus a star for whoever's already senior in that duty -- no
// "(shift count)" number, unlike the real /shifts page.
function nameWithStar(name: string, shiftCounts: Record<string, ShiftCountInfo>, employeeId: string, duty: Duty) {
  const senior = shiftCounts[employeeId]?.[duty]?.senior
  return senior ? `${name} ⭐` : name
}

function hasSenior(people: { employee_id: string }[], shiftCounts: Record<string, ShiftCountInfo>, duty: Duty) {
  return people.some((p) => shiftCounts[p.employee_id]?.[duty]?.senior)
}

function statusTone(status: EffectiveShiftStatus): { bg: string; fg: string } {
  if (status === 'cancelled') return { bg: C.errorBg, fg: C.error }
  if (status === 'waiting_for_closure' || status === 'reopened') return { bg: C.warningBg, fg: C.warning }
  if (status === 'active') return { bg: C.infoBg, fg: C.info }
  if (status === 'completed' || status === 'draft') return { bg: C.subtleBg, fg: C.textMuted }
  return { bg: C.successBg, fg: C.success } // published
}

function PhoneLine({ phone, compact }: { phone: string | undefined; compact: boolean }) {
  if (!phone) return null
  // Phones are stored as +972XXYYYYYYY (see the phone-normalization
  // migration) -- wa.me wants just the digits, no leading +.
  const whatsappHref = `https://wa.me/${phone.replace(/\D/g, '')}`
  return (
    <a
      href={whatsappHref}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1 underline-offset-2 hover:underline"
      style={{ color: C.textSecondary }}
    >
      <Phone className="size-3.5 shrink-0" />
      <span className={compact ? 'text-xs' : 'text-sm'} dir="ltr">
        {phone}
      </span>
    </a>
  )
}

function AssociateMeButton({
  compact,
  disabled,
  onClick,
}: {
  compact: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-fit rounded-xl px-3 font-semibold text-white disabled:opacity-40',
        compact ? 'h-8 text-xs' : 'h-9 text-sm',
      )}
      style={{ background: C.primary }}
    >
      שבץ אותי
    </button>
  )
}

function MineRow({
  name,
  phone,
  compact,
  onCancel,
}: {
  name: string
  phone: string | undefined
  compact: boolean
  onCancel: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2" style={{ background: C.successBg }}>
      <div className="min-w-0">
        <p className={cn('truncate font-semibold', compact ? 'text-sm' : 'text-base')} style={{ color: C.success }}>
          {name}
        </p>
        <PhoneLine phone={phone} compact={compact} />
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 text-xs font-semibold underline-offset-2 hover:underline"
        style={{ color: C.error }}
      >
        ביטול
      </button>
    </div>
  )
}

// Click a filled name to turn it into a restyled <select> offering swap /
// remove / (bartender-only) unify -- same interaction and option-filtering
// as the real page's DutySlotCell, just reskinned to the card design.
function EditableDutyName({
  name,
  phone,
  compact,
  eligible,
  takenIds,
  shiftCounts,
  duty,
  currentEmployeeId,
  onSwap,
  onRemove,
  onUnify,
}: {
  name: string
  phone: string | undefined
  compact: boolean
  eligible: Employee[]
  takenIds: Set<string>
  shiftCounts: Record<string, ShiftCountInfo>
  duty: Duty
  currentEmployeeId: string
  onSwap: (newEmployeeId: string) => void
  onRemove: () => void
  onUnify?: () => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <select
        autoFocus
        className={pickerSelectClass}
        style={pickerSelectStyle}
        defaultValue=""
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          const v = e.target.value
          setEditing(false)
          if (v === '__remove__') onRemove()
          else if (v === '__unify__') onUnify?.()
          else if (v) onSwap(v)
        }}
      >
        <option value={onUnify ? '__unify__' : ''} disabled={!onUnify}>
          {name}
        </option>
        <option value="__remove__">— הסרה —</option>
        {eligible
          .filter((e) => e.id === currentEmployeeId || !takenIds.has(e.id))
          .filter((e) => e.id !== currentEmployeeId)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {nameWithStar(e.full_name, shiftCounts, e.id, duty)}
            </option>
          ))}
      </select>
    )
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="truncate text-start font-medium underline-offset-2 hover:underline"
        style={{ color: C.text }}
      >
        {name}
      </button>
      <PhoneLine phone={phone} compact={compact} />
    </div>
  )
}

// Empty-slot equivalent: a button that reveals a restyled <select> of
// eligible, not-already-taken employees in place.
function EmptySlotPicker({
  compact,
  eligible,
  takenIds,
  shiftCounts,
  duty,
  buttonLabel,
  filled,
  onPick,
}: {
  compact: boolean
  eligible: Employee[]
  takenIds: Set<string>
  shiftCounts: Record<string, ShiftCountInfo>
  duty: Duty
  buttonLabel: string
  filled?: boolean
  onPick: (employeeId: string) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <select
        autoFocus
        className={pickerSelectClass}
        style={pickerSelectStyle}
        defaultValue=""
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          const v = e.target.value
          setEditing(false)
          if (v) onPick(v)
        }}
      >
        <option value="">בחר/י…</option>
        {eligible
          .filter((e) => !takenIds.has(e.id))
          .map((e) => (
            <option key={e.id} value={e.id}>
              {nameWithStar(e.full_name, shiftCounts, e.id, duty)}
            </option>
          ))}
      </select>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn('w-fit rounded-xl px-3 font-semibold', compact ? 'h-8 text-xs' : 'h-9 text-sm', filled ? '' : 'text-white')}
      style={filled ? { background: C.subtleBg, color: C.textMuted } : { background: C.primary }}
    >
      {buttonLabel}
    </button>
  )
}

// One row of a split bartender pair -- opening side next to closing side,
// either occupied (editable) or still open (pickable). Mirrors the real
// page's PartialDutyCellPair, including the pairedWith exclusion so a split
// person can be picked straight back into their own missing side, or swap
// directly into the other side's slot, in one action.
function SplitPairRow({
  openingPerson,
  closingPerson,
  openingShift,
  closingShift,
  openingLabel,
  closingLabel,
  employeeNames,
  shiftCounts,
  employeePhones,
  duty,
  eligible,
  takenIds,
  compact,
  onSwapSingle,
  onAssignSingle,
  onUnify,
  onRemove,
}: {
  openingPerson?: DutyPerson
  closingPerson?: DutyPerson
  openingShift: Shift
  closingShift: Shift
  openingLabel: string
  closingLabel: string
  employeeNames: Record<string, string>
  shiftCounts: Record<string, ShiftCountInfo>
  employeePhones: Record<string, string>
  duty: Duty
  eligible: Employee[]
  takenIds: Set<string>
  compact: boolean
  onSwapSingle?: (oldAssignmentId: string, newEmployeeId: string, shiftId: string) => void
  onAssignSingle?: (employeeId: string, shiftId: string) => void
  onUnify?: (employeeId: string, shiftId: string) => void
  onRemove: (assignmentIds: string[]) => void
}) {
  function cell(person: DutyPerson | undefined, shift: Shift, otherShift: Shift, sideLabel: string, pairedWith?: DutyPerson) {
    const cellTakenIds = pairedWith ? new Set(takenIds) : takenIds
    if (pairedWith) cellTakenIds.delete(pairedWith.employee_id)

    return (
      <div className="flex flex-col gap-1 rounded-xl border border-dashed px-2.5 py-2" style={{ borderColor: C.border }}>
        <span className="text-[10px] font-semibold" style={{ color: C.textMuted }}>
          {sideLabel}
        </span>
        {person ? (
          (() => {
            const occupiedId = (person.openingAssignmentId ?? person.closingAssignmentId)!
            return (
              <EditableDutyName
                name={nameWithStar(employeeNames[person.employee_id] ?? '—', shiftCounts, person.employee_id, duty)}
                phone={employeePhones[person.employee_id]}
                compact={compact}
                eligible={eligible}
                takenIds={cellTakenIds}
                shiftCounts={shiftCounts}
                duty={duty}
                currentEmployeeId={person.employee_id}
                onSwap={(newId) => onSwapSingle?.(occupiedId, newId, shift.id)}
                onRemove={() => onRemove([occupiedId])}
                onUnify={() => onUnify?.(person.employee_id, otherShift.id)}
              />
            )
          })()
        ) : (
          <EmptySlotPicker
            compact={compact}
            eligible={eligible}
            takenIds={cellTakenIds}
            shiftCounts={shiftCounts}
            duty={duty}
            buttonLabel="שבץ אותי"
            onPick={(id) => onAssignSingle?.(id, shift.id)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {cell(openingPerson, openingShift, closingShift, openingLabel, closingPerson)}
      {cell(closingPerson, closingShift, openingShift, closingLabel, openingPerson)}
    </div>
  )
}

function BarManagerBody({
  employeeId,
  employeeNames,
  shiftCounts,
  shiftManagers,
  myEmployeeId,
  viewerCanManage,
  canPickAnyone,
  disabled,
  dateLabel,
  confirmAssign,
  onSet,
  compact,
}: {
  employeeId: string | null
  employeeNames: Record<string, string>
  shiftCounts: Record<string, ShiftCountInfo>
  shiftManagers: Employee[]
  myEmployeeId: string | null
  viewerCanManage: boolean
  canPickAnyone: boolean
  disabled: boolean
  dateLabel: string
  confirmAssign: (details: ConfirmAssignState) => Promise<boolean>
  onSet: (employeeId: string | null) => void
  compact: boolean
}) {
  const [editing, setEditing] = useState(false)
  const iAmEligible = !!myEmployeeId && shiftManagers.some((e) => e.id === myEmployeeId)
  const name = employeeId ? nameWithStar(employeeNames[employeeId] ?? '—', shiftCounts, employeeId, 'bar_manager') : null
  const textSize = compact ? 'text-sm' : 'text-base'

  // Bartenders never touch this row -- read only.
  if (!viewerCanManage) {
    return (
      <p className={textSize} style={{ color: employeeId ? C.text : C.textMuted }}>
        {employeeId ? name : disabled ? 'מבוטל' : 'עדיין לא שובץ'}
      </p>
    )
  }

  // Shift manager: self-assign only, no editing once set.
  if (!canPickAnyone) {
    if (employeeId) return <p className={cn('font-medium', textSize)} style={{ color: C.text }}>{name}</p>
    if (disabled) return <p className={textSize} style={{ color: C.textMuted }}>מבוטל</p>
    return (
      <AssociateMeButton
        compact={compact}
        disabled={!iAmEligible}
        onClick={async () => {
          if (!myEmployeeId) return
          const ok = await confirmAssign({
            title: 'איזה כיף!',
            action: 'assign',
            dateLabel,
            typeLabel: 'משמרת שלמה',
            hoursLabel: AREA_SUPERVISOR_HOURS,
            positionLabel: 'מנהל/ת בר',
          })
          if (!ok) return
          onSet(myEmployeeId)
        }}
      />
    )
  }

  // Administrator: full picker.
  if (!employeeId && disabled) return <p className={textSize} style={{ color: C.textMuted }}>מבוטל</p>

  if (editing) {
    return (
      <select
        autoFocus
        className={pickerSelectClass}
        style={pickerSelectStyle}
        defaultValue=""
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          const v = e.target.value
          setEditing(false)
          if (v === '__remove__') onSet(null)
          else if (v) onSet(v)
        }}
      >
        <option value="">בחר/י מרשימה</option>
        {employeeId && <option value="__remove__">— הסרה —</option>}
        {shiftManagers
          .filter((e) => e.id !== employeeId)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {nameWithStar(e.full_name, shiftCounts, e.id, 'bar_manager')}
            </option>
          ))}
      </select>
    )
  }

  if (employeeId) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn('truncate text-start font-medium underline-offset-2 hover:underline', textSize)}
        style={{ color: C.text }}
      >
        {name}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <AssociateMeButton compact={compact} disabled={!iAmEligible} onClick={() => myEmployeeId && onSet(myEmployeeId)} />
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs font-semibold underline-offset-2 hover:underline"
        style={{ color: C.textMuted }}
      >
        בחר/י מרשימה
      </button>
    </div>
  )
}

function AreaSupervisorBody({
  employeeId,
  phone,
  eligible,
  employeeNames,
  shiftCounts,
  myEmployeeId,
  viewerCanManage,
  canSelfRemove,
  disabled,
  dateLabel,
  confirmAssign,
  showInfo,
  onSet,
  compact,
}: {
  employeeId: string | null
  phone: string | undefined
  eligible: Employee[]
  employeeNames: Record<string, string>
  shiftCounts: Record<string, ShiftCountInfo>
  myEmployeeId: string | null
  viewerCanManage: boolean
  canSelfRemove: boolean
  disabled: boolean
  dateLabel: string
  confirmAssign: (details: ConfirmAssignState) => Promise<boolean>
  showInfo: (details: InfoDialogState) => Promise<void>
  onSet: (employeeId: string | null) => void
  compact: boolean
}) {
  const [editing, setEditing] = useState(false)
  const iAmEligible = !!myEmployeeId && eligible.some((e) => e.id === myEmployeeId)
  const isMine = !!employeeId && employeeId === myEmployeeId
  const name = employeeId ? nameWithStar(employeeNames[employeeId] ?? '—', shiftCounts, employeeId, 'area_supervisor') : null
  const textSize = compact ? 'text-sm' : 'text-base'

  const assignSelf = async () => {
    if (!myEmployeeId) return
    const ok = await confirmAssign({
      title: 'איזה כיף!',
      action: 'assign',
      dateLabel,
      typeLabel: 'משמרת שלמה',
      hoursLabel: AREA_SUPERVISOR_HOURS,
      positionLabel: 'מנהל/ת מתחם',
    })
    if (!ok) return
    onSet(myEmployeeId)
  }

  if (viewerCanManage) {
    if (!employeeId && disabled) return <p className={textSize} style={{ color: C.textMuted }}>מבוטל</p>

    if (editing) {
      return (
        <select
          autoFocus
          className={pickerSelectClass}
          style={pickerSelectStyle}
          defaultValue=""
          onBlur={() => setEditing(false)}
          onChange={(e) => {
            const v = e.target.value
            setEditing(false)
            if (v === '__remove__') onSet(null)
            else if (v) onSet(v)
          }}
        >
          <option value="">בחר/י מרשימה</option>
          {employeeId && <option value="__remove__">— הסרה —</option>}
          {eligible
            .filter((e) => e.id !== employeeId)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {nameWithStar(e.full_name, shiftCounts, e.id, 'area_supervisor')}
              </option>
            ))}
        </select>
      )
    }

    if (employeeId) {
      return (
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn('truncate text-start font-medium underline-offset-2 hover:underline', textSize)}
            style={{ color: C.text }}
          >
            {name}
          </button>
          <PhoneLine phone={phone} compact={compact} />
        </div>
      )
    }

    return (
      <div className="flex items-center gap-2">
        <AssociateMeButton compact={compact} disabled={!iAmEligible} onClick={assignSelf} />
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs font-semibold underline-offset-2 hover:underline"
          style={{ color: C.textMuted }}
        >
          בחר/י מרשימה
        </button>
      </div>
    )
  }

  // Self-service.
  return (
    <>
      {employeeId && !isMine && (
        <div>
          <p className={cn('truncate font-medium', textSize)} style={{ color: C.text }}>
            {name}
          </p>
          <PhoneLine phone={phone} compact={compact} />
        </div>
      )}
      {isMine && (
        <MineRow
          name={name!}
          phone={phone}
          compact={compact}
          onCancel={async () => {
            if (canSelfRemove) {
              const ok = await confirmAssign({
                title: 'איזה באסה! לא מסתדר?',
                action: 'remove',
                dateLabel,
                typeLabel: 'משמרת שלמה',
                hoursLabel: AREA_SUPERVISOR_HOURS,
                positionLabel: 'מנהל/ת מתחם',
              })
              if (!ok) return
              onSet(null)
            } else {
              showInfo({
                title: 'איזה באסה! לא מסתדר?',
                body: 'לא ניתן לבטל משמרת בסמיכות למועד המשמרת. אנא צור/י קשר עם מנהל הבר של המשמרת.',
              })
            }
          }}
        />
      )}
      {!employeeId && disabled && <p className={textSize} style={{ color: C.textMuted }}>מבוטל</p>}
      {!employeeId && !disabled && <AssociateMeButton compact={compact} disabled={!iAmEligible} onClick={assignSelf} />}
    </>
  )
}

function DutyListBody({
  role,
  max,
  openingShift,
  closingShift,
  openingAssignments,
  closingAssignments,
  eligible,
  employeeNames,
  shiftCounts,
  employeePhones,
  myEmployeeId,
  viewerCanManage,
  canSelfRemove,
  takenIds,
  dateLabel,
  hoursLabel,
  compact,
  confirmAssign,
  showInfo,
  onAssign,
  onRemove,
  onSwap,
  allowSplit,
  onSplit,
  onSwapSingle,
  onUnify,
  onAssignSingle,
}: {
  role: Duty
  max: number
  openingShift?: Shift
  closingShift?: Shift
  openingAssignments: ShiftAssignment[]
  closingAssignments: ShiftAssignment[]
  eligible: Employee[]
  employeeNames: Record<string, string>
  shiftCounts: Record<string, ShiftCountInfo>
  employeePhones: Record<string, string>
  myEmployeeId: string | null
  viewerCanManage: boolean
  canSelfRemove: boolean
  takenIds: Set<string>
  dateLabel: string
  hoursLabel: string
  compact: boolean
  confirmAssign: (details: ConfirmAssignState) => Promise<boolean>
  showInfo: (details: InfoDialogState) => Promise<void>
  onAssign: (employeeId: string) => void
  onRemove: (assignmentIds: string[]) => void
  onSwap: (oldAssignmentIds: string[], newEmployeeId: string) => void
  allowSplit?: boolean
  onSplit?: (closingAssignmentId: string) => void
  onSwapSingle?: (oldAssignmentId: string, newEmployeeId: string, shiftId: string) => void
  onUnify?: (employeeId: string, shiftId: string) => void
  onAssignSingle?: (employeeId: string, shiftId: string) => void
}) {
  const people = mergeDutyPeople(openingAssignments, closingAssignments)
  const iAmEligible = !!myEmployeeId && eligible.some((e) => e.id === myEmployeeId)
  const anyShiftId = openingShift?.id ?? closingShift?.id
  const typeLabel = 'משמרת שלמה'
  const positionLabel = shiftAssignmentRoleLabels[role]

  async function associateMe() {
    if (!myEmployeeId) return
    const ok = await confirmAssign({ title: 'איזה כיף!', action: 'assign', dateLabel, typeLabel, hoursLabel, positionLabel })
    if (!ok) return
    onAssign(myEmployeeId)
  }

  if (viewerCanManage) {
    const bothShiftsActive = !!openingShift && !!closingShift
    const fullyPaired = bothShiftsActive ? people.filter((p) => p.openingAssignmentId && p.closingAssignmentId) : people
    const openingOnly = bothShiftsActive ? people.filter((p) => p.openingAssignmentId && !p.closingAssignmentId) : []
    const closingOnly = bothShiftsActive ? people.filter((p) => !p.openingAssignmentId && p.closingAssignmentId) : []

    return (
      <div className="flex flex-col gap-2">
        {fullyPaired.map((person) => (
          <div key={person.employee_id} className="flex items-start justify-between gap-2">
            <EditableDutyName
              name={nameWithStar(employeeNames[person.employee_id] ?? '—', shiftCounts, person.employee_id, role)}
              phone={employeePhones[person.employee_id]}
              compact={compact}
              eligible={eligible}
              takenIds={takenIds}
              shiftCounts={shiftCounts}
              duty={role}
              currentEmployeeId={person.employee_id}
              onSwap={(newId) => onSwap(person.assignmentIds, newId)}
              onRemove={() => onRemove(person.assignmentIds)}
            />
            {allowSplit && bothShiftsActive && (
              <button
                type="button"
                onClick={() => onSplit?.(person.closingAssignmentId!)}
                className={cn('shrink-0 rounded-xl px-3 font-semibold', compact ? 'h-8 text-xs' : 'h-9 text-sm')}
                style={{ background: C.subtleBg, color: C.textMuted }}
              >
                פיצול
              </button>
            )}
          </div>
        ))}

        {(openingOnly.length > 0 || closingOnly.length > 0) &&
          Array.from({ length: Math.max(openingOnly.length, closingOnly.length) }, (_, i) => i).map((i) => (
            <SplitPairRow
              key={i}
              openingPerson={openingOnly[i]}
              closingPerson={closingOnly[i]}
              openingShift={openingShift!}
              closingShift={closingShift!}
              openingLabel={`פתיחה ${formatTime(openingShift!.start_time)}–${formatTime(openingShift!.end_time)}`}
              closingLabel={`סגירה ${formatTime(closingShift!.start_time)}–${formatTime(closingShift!.end_time)}`}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              employeePhones={employeePhones}
              duty={role}
              eligible={eligible}
              takenIds={takenIds}
              compact={compact}
              onSwapSingle={onSwapSingle}
              onAssignSingle={onAssignSingle}
              onUnify={onUnify}
              onRemove={onRemove}
            />
          ))}

        {people.length === 0 && (
          <p className={cn(compact ? 'text-sm' : 'text-base')} style={{ color: C.textMuted }}>
            עדיין לא שובץ
          </p>
        )}

        {people.length < max && anyShiftId && (
          <EmptySlotPicker
            compact={compact}
            eligible={eligible}
            takenIds={takenIds}
            shiftCounts={shiftCounts}
            duty={role}
            buttonLabel={people.length > 0 ? 'הוספת שיבוץ נוסף' : 'שבץ אותי'}
            filled={people.length > 0}
            onPick={onAssign}
          />
        )}
      </div>
    )
  }

  // Self-service.
  const mine = people.find((p) => p.employee_id === myEmployeeId)
  const others = people.filter((p) => p.employee_id !== myEmployeeId)

  return (
    <div className="flex flex-col gap-2">
      {others.map((p) => (
        <div key={p.employee_id}>
          <p className={cn('truncate font-medium', compact ? 'text-sm' : 'text-base')} style={{ color: C.text }}>
            {nameWithStar(employeeNames[p.employee_id] ?? '—', shiftCounts, p.employee_id, role)}
          </p>
          <PhoneLine phone={employeePhones[p.employee_id]} compact={compact} />
        </div>
      ))}
      {others.length === 0 && !mine && (
        <p className={cn(compact ? 'text-sm' : 'text-base')} style={{ color: C.textMuted }}>
          עדיין לא שובץ
        </p>
      )}
      {mine && (
        <MineRow
          name={nameWithStar(employeeNames[mine.employee_id] ?? '—', shiftCounts, mine.employee_id, role)}
          phone={employeePhones[mine.employee_id]}
          compact={compact}
          onCancel={async () => {
            if (canSelfRemove) {
              const ok = await confirmAssign({ title: 'איזה באסה! לא מסתדר?', action: 'remove', dateLabel, typeLabel, hoursLabel, positionLabel })
              if (!ok) return
              onRemove(mine.assignmentIds)
            } else {
              showInfo({
                title: 'איזה באסה! לא מסתדר?',
                body: 'לא ניתן לבטל משמרת בסמיכות למועד המשמרת. אנא צור/י קשר עם מנהל הבר של המשמרת.',
              })
            }
          }}
        />
      )}
      {!mine && <AssociateMeButton compact={compact} disabled={!iAmEligible || people.length >= max || !anyShiftId} onClick={associateMe} />}
    </div>
  )
}

function DutyCard({
  label,
  icon: Icon,
  iconBg,
  hoursLabel,
  isGap,
  status,
  compact,
  children,
}: {
  label: string
  icon: LucideIcon
  iconBg: string
  hoursLabel: string
  isGap: boolean
  status: EffectiveShiftStatus
  compact: boolean
  children: ReactNode
}) {
  const tone = isGap ? { bg: C.warningBg, fg: C.warning } : statusTone(status)
  const iconSize = compact ? 'size-11' : 'size-14'

  return (
    <div
      className="relative rounded-2xl border"
      style={{
        background: C.card,
        borderColor: C.border,
        paddingTop: compact ? 12 : 16,
        paddingBottom: compact ? 10 : 14,
        // Explicit physical sides via inline style, not Tailwind's pr-*/pl-*
        // utilities -- those (and left-*/right-*) resolve as RTL-logical in
        // this setup, which silently swaps sides under dir="rtl".
        paddingRight: compact ? 10 : 14,
        paddingLeft: compact ? 20 : 24,
      }}
    >
      <span
        className="absolute rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{ background: tone.bg, color: tone.fg, top: 10, left: 12 }}
      >
        {isGap ? 'חסר שיבוץ' : effectiveStatusLabels[status]}
      </span>

      <div
        className={cn('absolute flex items-center justify-center rounded-full ring-4', iconSize)}
        style={{ background: iconBg, ['--tw-ring-color' as string]: C.subtleBg, top: -16, right: 12 }}
      >
        <Icon className={cn('text-white', compact ? 'size-5' : 'size-6')} />
      </div>

      <div className={cn('flex flex-col gap-2 pr-1', compact ? 'pt-9' : 'pt-10')}>
        <div>
          <p className={cn('font-semibold', compact ? 'text-base' : 'text-lg')} style={{ color: C.text }}>
            {label}
          </p>
          <div className="mt-0.5 flex items-center gap-1" style={{ color: C.textSecondary }}>
            <Clock className="size-4 shrink-0" />
            <span className={compact ? 'text-xs' : 'text-sm'}>{hoursLabel}</span>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function WeekSection({
  week,
  shifts,
  assignmentsByShift,
  teamByWeek,
  shiftManagers,
  dutyEligible,
  areaSupervisorEligible,
  employeeNames,
  shiftCounts,
  employeePhones,
  myEmployeeId,
  compact,
  canManage,
  isAdmin,
  onSaved,
}: {
  week: string
  shifts: WeekShifts
  assignmentsByShift: Map<string, ShiftAssignment[]>
  teamByWeek: Map<string, string>
  shiftManagers: Employee[]
  dutyEligible: Employee[]
  areaSupervisorEligible: Employee[]
  employeeNames: Record<string, string>
  shiftCounts: Record<string, ShiftCountInfo>
  employeePhones: Record<string, string>
  myEmployeeId: string | null
  compact: boolean
  canManage: boolean
  isAdmin: boolean
  onSaved: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const { confirmAssign, dialogState, handleApprove, handleDecline } = useConfirmAssign()
  const { showInfo, infoState, handleClose } = useInfoDialog()

  const activeOpening = shifts.opening && shifts.opening.status !== 'cancelled' ? shifts.opening : undefined
  const activeClosing = shifts.closing && shifts.closing.status !== 'cancelled' ? shifts.closing : undefined
  const weekFullyCancelled = !activeOpening && !activeClosing && !!(shifts.opening || shifts.closing)

  const openingId = shifts.opening?.id
  const closingId = shifts.closing?.id
  const openingAll = openingId ? (assignmentsByShift.get(openingId) ?? []) : []
  const closingAll = closingId ? (assignmentsByShift.get(closingId) ?? []) : []
  const byRole = (role: string) => ({
    opening: openingAll.filter((a) => a.assignment_role === role),
    closing: closingAll.filter((a) => a.assignment_role === role),
  })
  const bartenders = byRole('bartender')
  const areaManagers = byRole('area_manager')
  const areaSupervisors = byRole('area_supervisor')

  // Anyone already holding any duty on either of this week's shifts -- a
  // manager's picker excludes these from "add new" regardless of which
  // duty they're currently in.
  const weekTakenIds = new Set([...openingAll, ...closingAll].map((a) => a.employee_id))

  // Matches shift_assignments_delete_self_future_week's RLS: a bartender
  // can only remove their own assignment for a strictly-future week.
  const canSelfRemove = week > toDateStr(activeWeekStart())

  const bartenderMax = activeOpening?.required_staff_count ?? activeClosing?.required_staff_count ?? 3
  const eveningHours =
    activeOpening && activeClosing
      ? `${formatTime(activeOpening.start_time)}–${formatTime(activeClosing.end_time)}`
      : activeOpening
        ? `${formatTime(activeOpening.start_time)}–${formatTime(activeOpening.end_time)}`
        : activeClosing
          ? `${formatTime(activeClosing.start_time)}–${formatTime(activeClosing.end_time)}`
          : ''

  const barManagerId = teamByWeek.get(week) ?? null
  const bartenderPeople = mergeDutyPeople(bartenders.opening, bartenders.closing)
  const areaManagerPeople = mergeDutyPeople(areaManagers.opening, areaManagers.closing)
  const areaSupervisorId = areaSupervisors.opening[0]?.employee_id ?? areaSupervisors.closing[0]?.employee_id ?? null

  // Same evening-wide gap checks as the real page's CombinedStatus -- a
  // manager-only informational summary line, not shown to anyone else.
  const primaryShift = shifts.closing ?? shifts.opening
  const openForStaffing =
    !!primaryShift &&
    primaryShift.status !== 'cancelled' &&
    (primaryShift.effective_status === 'published' || primaryShift.effective_status === 'active')
  const gaps: string[] = []
  if (primaryShift && openForStaffing) {
    if (primaryShift.required_staff_count !== null && bartenderPeople.length < primaryShift.required_staff_count) {
      gaps.push('תת-איוש ברמנים/יות')
    }
    if (areaManagerPeople.length === 0) {
      gaps.push('אין אחראי/ת מתחם')
    }
    if (bartenderPeople.length > 0 && !hasSenior(bartenderPeople, shiftCounts, 'bartender')) {
      gaps.push('אין ברמן/ית בכיר/ה')
    }
    if (areaManagerPeople.length > 0 && !hasSenior(areaManagerPeople, shiftCounts, 'area_manager')) {
      gaps.push('אין אחראי/ת מתחם בכיר/ה')
    }
  }

  const cancellableShiftIds = [
    shifts.opening && shifts.opening.status !== 'cancelled' ? shifts.opening.id : null,
    shifts.closing && shifts.closing.status !== 'cancelled' ? shifts.closing.id : null,
  ].filter((v): v is string => !!v)
  const cancelledShiftIds = [
    shifts.opening?.status === 'cancelled' ? shifts.opening.id : null,
    shifts.closing?.status === 'cancelled' ? shifts.closing.id : null,
  ].filter((v): v is string => !!v)

  async function handleSetShiftManager(employeeId: string | null) {
    setError(null)
    const { error: rpcError } = await supabase.rpc('set_weekly_shift_manager', { p_week_start: week, p_employee_id: employeeId })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    onSaved()
  }

  async function handleAssignDuty(employeeId: string, role: ShiftAssignmentRole) {
    setError(null)
    const shiftIds =
      role === 'bartender'
        ? [
            activeOpening && bartenders.opening.length < bartenderMax ? activeOpening.id : null,
            activeClosing && bartenders.closing.length < bartenderMax ? activeClosing.id : null,
          ].filter((id): id is string => !!id)
        : [openingId, closingId].filter((id): id is string => !!id)
    const rows = shiftIds.map((shift_id) => ({ shift_id, employee_id: employeeId, assignment_role: role }))
    if (rows.length === 0) return
    const { error: insertError } = await supabase.from('shift_assignments').insert(rows)
    if (insertError) {
      setError(friendlyAssignmentError(insertError))
      return
    }
    onSaved()
  }

  async function handleRemoveDuty(assignmentIds: string[]) {
    if (assignmentIds.length === 0) return
    setError(null)
    const { error: deleteError } = await supabase.from('shift_assignments').delete().in('id', assignmentIds)
    if (deleteError) {
      setError(friendlyAssignmentError(deleteError))
      return
    }
    onSaved()
  }

  async function handleSwapDuty(oldAssignmentIds: string[], newEmployeeId: string, role: ShiftAssignmentRole) {
    setError(null)
    if (oldAssignmentIds.length > 0) {
      const { error: deleteError } = await supabase.from('shift_assignments').delete().in('id', oldAssignmentIds)
      if (deleteError) {
        setError(friendlyAssignmentError(deleteError))
        return
      }
    }
    const rows = [openingId, closingId]
      .filter((id): id is string => !!id)
      .map((shift_id) => ({ shift_id, employee_id: newEmployeeId, assignment_role: role }))
    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('shift_assignments').insert(rows)
      if (insertError) {
        setError(friendlyAssignmentError(insertError))
        return
      }
    }
    onSaved()
  }

  async function handleUnifyDuty(employeeId: string, role: ShiftAssignmentRole, shiftId: string) {
    setError(null)
    const { error: insertError } = await supabase
      .from('shift_assignments')
      .insert({ shift_id: shiftId, employee_id: employeeId, assignment_role: role })
    if (insertError) {
      setError(friendlyAssignmentError(insertError))
      return
    }
    onSaved()
  }

  async function handleSwapSingleDuty(oldAssignmentId: string, newEmployeeId: string, role: ShiftAssignmentRole, shiftId: string) {
    setError(null)
    const { error: deleteError } = await supabase.from('shift_assignments').delete().eq('id', oldAssignmentId)
    if (deleteError) {
      setError(friendlyAssignmentError(deleteError))
      return
    }
    const { error: insertError } = await supabase
      .from('shift_assignments')
      .insert({ shift_id: shiftId, employee_id: newEmployeeId, assignment_role: role })
    if (insertError) {
      setError(friendlyAssignmentError(insertError))
      return
    }
    onSaved()
  }

  async function handleSetAreaSupervisor(employeeId: string | null) {
    setError(null)
    const existingIds = [areaSupervisors.opening[0]?.id, areaSupervisors.closing[0]?.id].filter((id): id is string => !!id)
    if (existingIds.length > 0) {
      const { error: deleteError } = await supabase.from('shift_assignments').delete().in('id', existingIds)
      if (deleteError) {
        setError(friendlyAssignmentError(deleteError))
        return
      }
    }
    if (employeeId) {
      const rows = [openingId, closingId]
        .filter((id): id is string => !!id)
        .map((shift_id) => ({ shift_id, employee_id: employeeId, assignment_role: 'area_supervisor' as const }))
      if (rows.length > 0) {
        const { error: insertError } = await supabase.from('shift_assignments').insert(rows)
        if (insertError) {
          setError(friendlyAssignmentError(insertError))
          return
        }
      }
    }
    onSaved()
  }

  async function handleCancelWeek() {
    if (!cancelReason.trim()) return
    setCancelling(true)
    setError(null)
    const { error: cancelError } = await supabase
      .from('shifts')
      .update({ status: 'cancelled', cancellation_reason: cancelReason.trim() })
      .in('id', cancellableShiftIds)
    setCancelling(false)
    if (cancelError) {
      setError(cancelError.message)
      return
    }
    setShowCancelForm(false)
    setCancelReason('')
    onSaved()
  }

  async function handleRestoreWeek() {
    if (!confirm('לשחזר את המשמרת?')) return
    setRestoring(true)
    setError(null)
    const { error: restoreError } = await supabase.rpc('restore_cancelled_shifts', { p_shift_ids: cancelledShiftIds })
    setRestoring(false)
    if (restoreError) {
      setError(restoreError.message)
      return
    }
    onSaved()
  }

  const dateLabel = shifts.opening?.start_time
    ? weekLabelFormatter.format(new Date(shifts.opening.start_time))
    : shifts.closing?.start_time
      ? weekLabelFormatter.format(new Date(shifts.closing.start_time))
      : weekLabelFormatter.format(shiftDateOfWeek(week))
  const weekdayLabel = new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(shiftDateOfWeek(week))
  const cardStatus = activeOpening?.effective_status ?? activeClosing?.effective_status ?? 'published'

  return (
    <div
      className={cn('flex flex-col rounded-3xl border', compact ? 'gap-5 p-3 pt-4' : 'gap-6 p-4 pt-5')}
      style={{ background: C.subtleBg, borderColor: C.border }}
    >
      <ConfirmAssignDialog state={dialogState} onApprove={handleApprove} onDecline={handleDecline} />
      <InfoDialog state={infoState} onClose={handleClose} />

      <div className="px-1">
        <h2 className={cn('font-bold', compact ? 'text-lg' : 'text-xl')} style={{ color: C.text }}>
          {dateLabel}
        </h2>
        <p className="text-sm" style={{ color: C.textMuted }}>
          {weekdayLabel}
        </p>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs">
          <span style={{ color: C.textMuted }}>סטטוס</span>
          {primaryShift ? (
            <Link
              to={`/shifts/${primaryShift.id}`}
              className="rounded-full px-2 py-0.5 font-semibold hover:underline"
              style={{
                background: statusTone(primaryShift.effective_status).bg,
                color: statusTone(primaryShift.effective_status).fg,
              }}
            >
              {effectiveStatusLabels[primaryShift.effective_status]}
            </Link>
          ) : (
            <span style={{ color: C.textMuted }}>—</span>
          )}
          {gaps.map((g) => (
            <span key={g} className="font-medium" style={{ color: C.warning }}>
              {g}
            </span>
          ))}
        </div>
      )}

      {weekFullyCancelled ? (
        <div className="rounded-2xl border p-3.5 text-center font-medium" style={{ background: C.errorBg, borderColor: C.border, color: C.error }}>
          השבוע הזה בוטל
        </div>
      ) : (
        <div className={cn('flex flex-col', compact ? 'gap-5' : 'gap-6')}>
          <DutyCard label="מנהל/ת בר" icon={Martini} iconBg={C.primary} hoursLabel={eveningHours} isGap={!barManagerId} status={cardStatus} compact={compact}>
            <BarManagerBody
              employeeId={barManagerId}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              shiftManagers={shiftManagers}
              myEmployeeId={myEmployeeId}
              viewerCanManage={canManage}
              canPickAnyone={isAdmin}
              disabled={weekFullyCancelled}
              dateLabel={dateLabel}
              confirmAssign={confirmAssign}
              onSet={handleSetShiftManager}
              compact={compact}
            />
          </DutyCard>

          <DutyCard
            label={`ברמנים/יות (עד ${bartenderMax})`}
            icon={Beer}
            iconBg={C.accent}
            hoursLabel={eveningHours}
            isGap={bartenderPeople.length === 0}
            status={cardStatus}
            compact={compact}
          >
            <DutyListBody
              role="bartender"
              max={bartenderMax}
              openingShift={activeOpening}
              closingShift={activeClosing}
              openingAssignments={bartenders.opening}
              closingAssignments={bartenders.closing}
              eligible={dutyEligible}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              employeePhones={employeePhones}
              myEmployeeId={myEmployeeId}
              viewerCanManage={canManage}
              canSelfRemove={canSelfRemove}
              takenIds={weekTakenIds}
              dateLabel={dateLabel}
              hoursLabel={eveningHours}
              compact={compact}
              confirmAssign={confirmAssign}
              showInfo={showInfo}
              onAssign={(employeeId) => handleAssignDuty(employeeId, 'bartender')}
              onRemove={handleRemoveDuty}
              onSwap={(oldIds, newId) => handleSwapDuty(oldIds, newId, 'bartender')}
              allowSplit
              onSplit={(closingAssignmentId) => handleRemoveDuty([closingAssignmentId])}
              onSwapSingle={(oldId, newId, shiftId) => handleSwapSingleDuty(oldId, newId, 'bartender', shiftId)}
              onUnify={(employeeId, shiftId) => handleUnifyDuty(employeeId, 'bartender', shiftId)}
              onAssignSingle={(employeeId, shiftId) => handleUnifyDuty(employeeId, 'bartender', shiftId)}
            />
          </DutyCard>

          <DutyCard
            label="אחראי/ת מתחם בכיר/ה"
            icon={ShieldCheck}
            iconBg={C.info}
            hoursLabel={AREA_SUPERVISOR_HOURS}
            isGap={!areaSupervisorId}
            status={cardStatus}
            compact={compact}
          >
            <AreaSupervisorBody
              employeeId={areaSupervisorId}
              phone={areaSupervisorId ? employeePhones[areaSupervisorId] : undefined}
              eligible={areaSupervisorEligible}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              myEmployeeId={myEmployeeId}
              viewerCanManage={canManage}
              canSelfRemove={canSelfRemove}
              disabled={weekFullyCancelled}
              dateLabel={dateLabel}
              confirmAssign={confirmAssign}
              showInfo={showInfo}
              onSet={handleSetAreaSupervisor}
              compact={compact}
            />
          </DutyCard>

          <DutyCard
            label="אחראי/ת מתחם (עד 2)"
            icon={Users}
            iconBg="#3F8F6B"
            hoursLabel={AREA_SUPERVISOR_HOURS}
            isGap={areaManagerPeople.length === 0}
            status={cardStatus}
            compact={compact}
          >
            <DutyListBody
              role="area_manager"
              max={2}
              openingShift={activeOpening}
              closingShift={activeClosing}
              openingAssignments={areaManagers.opening}
              closingAssignments={areaManagers.closing}
              eligible={dutyEligible}
              employeeNames={employeeNames}
              shiftCounts={shiftCounts}
              employeePhones={employeePhones}
              myEmployeeId={myEmployeeId}
              viewerCanManage={canManage}
              canSelfRemove={canSelfRemove}
              takenIds={weekTakenIds}
              dateLabel={dateLabel}
              hoursLabel={AREA_SUPERVISOR_HOURS}
              compact={compact}
              confirmAssign={confirmAssign}
              showInfo={showInfo}
              onAssign={(employeeId) => handleAssignDuty(employeeId, 'area_manager')}
              onRemove={handleRemoveDuty}
              onSwap={(oldIds, newId) => handleSwapDuty(oldIds, newId, 'area_manager')}
            />
          </DutyCard>
        </div>
      )}

      {error && <p className="text-xs" style={{ color: C.error }}>{error}</p>}

      {canManage &&
        shifts.closing &&
        (shifts.closing.effective_status === 'active' ||
          shifts.closing.effective_status === 'waiting_for_closure' ||
          shifts.closing.effective_status === 'reopened') && (
          <Link
            to={`/shifts/${shifts.closing.id}/close`}
            className="flex items-center justify-center rounded-xl py-2.5 text-sm font-semibold text-white"
            style={{ background: C.primary }}
          >
            סגירת משמרת
          </Link>
        )}

      {canManage && cancellableShiftIds.length > 0 && cancelledShiftIds.length === 0 && !showCancelForm && (
        <button
          type="button"
          onClick={() => setShowCancelForm(true)}
          className="rounded-xl py-2.5 text-sm font-semibold"
          style={{ background: C.errorBg, color: C.error }}
        >
          ביטול משמרת
        </button>
      )}

      {canManage && cancellableShiftIds.length > 0 && cancelledShiftIds.length === 0 && showCancelForm && (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-16 rounded-xl border p-2 text-xs"
            style={{ borderColor: C.border, background: C.card }}
            placeholder="סיבת הביטול (חובה)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowCancelForm(false)
                setCancelReason('')
              }}
              className="flex-1 rounded-xl py-2 text-sm font-semibold"
              style={{ background: C.subtleBg, color: C.textMuted }}
            >
              חזרה
            </button>
            <button
              type="button"
              disabled={cancelling || !cancelReason.trim()}
              onClick={handleCancelWeek}
              className="flex-1 rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: C.error }}
            >
              אישור ביטול
            </button>
          </div>
        </div>
      )}

      {canManage && cancelledShiftIds.length > 0 && (
        <button
          type="button"
          disabled={!isAdmin || restoring}
          title={isAdmin ? undefined : 'רק מנהל/ת מערכת יכול/ה לשחזר משמרת מבוטלת'}
          onClick={handleRestoreWeek}
          className="rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: C.success }}
        >
          שחזור משמרת
        </button>
      )}
    </div>
  )
}

export function ShiftsPreview() {
  const { appUser, effectiveRole } = useAppUserContext()
  const [year, setYear] = useState(currentYear)
  const [compact, setCompact] = useState(false)
  const [employeePhones, setEmployeePhones] = useState<Record<string, string>>({})

  const canManage = ROLES_MANAGING_SHIFTS.includes(effectiveRole)
  const isAdmin = effectiveRole === 'administrator'
  const myEmployeeId = appUser.employee_id
  const weeks = sundaysInYear(year)
    .map(toDateStr)
    .filter((w) => w >= EARLIEST_WEEK_START && w >= FETCH_FROM)

  const {
    shiftsByWeek,
    assignmentsByShift,
    teamByWeek,
    shiftManagers,
    dutyEligible,
    areaSupervisorEligible,
    employeeNames,
    shiftCounts,
    reload,
  } = useShiftWeeksData({ weeks, canManage, callEnsureUpcoming: true })

  // Separate fetch (not part of the shared hook, which the legacy page
  // also uses and doesn't need phone numbers for).
  useEffect(() => {
    let isMounted = true
    supabase
      .from('employees')
      .select('id, phone')
      .then(({ data }) => {
        if (!isMounted || !data) return
        setEmployeePhones(
          Object.fromEntries(
            (data as { id: string; phone: string | null }[])
              .filter((e) => !!e.phone)
              .map((e) => [e.id, e.phone as string]),
          ),
        )
      })
    return () => {
      isMounted = false
    }
  }, [])

  const visibleWeeks = weeks.filter((w) => w >= ARCHIVE_CUTOFF || weekNeedsClosing(shiftsByWeek.get(w) ?? {}))
  const canSeeLegacy = SHIFTS_LEGACY_ACCESS_USER_IDS.includes(appUser.id)

  return (
    <div dir="rtl" className="min-h-svh pb-24" style={{ background: C.appBg, color: C.text }}>
      <header
        className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3"
        style={{ background: C.card, borderColor: C.border }}
      >
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="ברבורג" className="size-9 shrink-0 rounded-full object-cover" />
          <span className="text-lg font-bold">ברבורג</span>
        </div>
        {canSeeLegacy && (
          <Link to="/shifts-legacy" className="flex items-center gap-1 text-sm font-semibold" style={{ color: C.textMuted }}>
            <ChevronLeft className="size-4" />
            גרסה קודמת
          </Link>
        )}
      </header>

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.primaryLight }}>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ background: C.primary }}>
            <Calendar className="size-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: C.primary }}>
            משמרות
          </h1>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <Link
              to="/shifts/archive"
              className="flex-1 rounded-xl border py-2 text-center text-sm font-semibold"
              style={{ borderColor: C.border, color: C.textSecondary }}
            >
              ארכיון
            </Link>
            <Link
              to="/shifts/new"
              className="flex-1 rounded-xl py-2 text-center text-sm font-semibold text-white"
              style={{ background: C.primary }}
            >
              משמרת חדשה
            </Link>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <select
            className="h-10 rounded-xl border px-3 text-base font-medium"
            style={{ borderColor: C.border, background: C.card }}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          <div className="flex rounded-full p-1" style={{ background: C.subtleBg }}>
            <button
              type="button"
              onClick={() => setCompact(false)}
              className="rounded-full px-4 py-1.5 text-sm font-semibold transition"
              style={!compact ? { background: C.primary, color: '#fff' } : { color: C.textSecondary }}
            >
              מורחב
            </button>
            <button
              type="button"
              onClick={() => setCompact(true)}
              className="rounded-full px-4 py-1.5 text-sm font-semibold transition"
              style={compact ? { background: C.primary, color: '#fff' } : { color: C.textSecondary }}
            >
              קומפקטי
            </button>
          </div>
        </div>

        {visibleWeeks.length === 0 && <p style={{ color: C.textMuted }}>אין שבועות להצגה בשנה זו.</p>}

        {visibleWeeks.map((week) => (
          <WeekSection
            key={week}
            week={week}
            shifts={shiftsByWeek.get(week) ?? {}}
            assignmentsByShift={assignmentsByShift}
            teamByWeek={teamByWeek}
            shiftManagers={shiftManagers}
            dutyEligible={dutyEligible}
            areaSupervisorEligible={areaSupervisorEligible}
            employeeNames={employeeNames}
            shiftCounts={shiftCounts}
            employeePhones={employeePhones}
            myEmployeeId={myEmployeeId}
            compact={compact}
            canManage={canManage}
            isAdmin={isAdmin}
            onSaved={reload}
          />
        ))}
      </div>
    </div>
  )
}
