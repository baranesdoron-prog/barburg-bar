import { ArrowUp, Plus, Trash2 } from 'lucide-react'

import { C } from '@/lib/designTokens'

// A menu item's preparation as data (menu_items.prep_steps, migration 117):
// the glass, the ice, then the pours in order. The bar menu draws one glass
// per step from it, so nobody has to photograph anything. Staff only.

export type Glass = 'highball' | 'lowball' | 'wine' | 'martini' | 'shot'
export type Ice = 'none' | 'three_quarters' | 'full' | 'on_request'
export type Amount = 'half' | 'one' | 'two' | 'top'

export interface Pour {
  ingredient: string
  amount: Amount
  color: string
}

export interface PrepSteps {
  glass: Glass
  ice: Ice
  pours: Pour[]
}

export const GLASS_LABELS: Record<Glass, string> = {
  highball: 'כוס הייבול',
  lowball: 'כוס לואו בול',
  wine: 'כוס יין',
  martini: 'כוס מרטיני',
  shot: 'כוס צ׳ייסר',
}

export const ICE_LABELS: Record<Ice, string> = {
  three_quarters: 'קרח ¾ כוס',
  full: 'כוס מלאה קרח',
  on_request: 'קרח לבקשת הלקוח',
  none: 'בלי קרח',
}

export const AMOUNT_LABELS: Record<Amount, string> = {
  half: '½ מנה',
  one: 'מנה אחת',
  two: '2 מנות',
  top: 'עד הסוף',
}

// Colours offered in the editor for an ingredient's layer in the drawing.
export const POUR_COLORS = ['#F26B1D', '#C8102E', '#F9A13A', '#F3D98B', '#B8742A', '#4A2616', '#E6D45C', '#E4EFB8', '#DCEEE6', '#EEF4F2']

// How much of the glass each amount fills (a fraction of its height).
const AMOUNT_FILL: Record<Exclude<Amount, 'top'>, number> = { half: 0.1, one: 0.2, two: 0.4 }
const FULL = 0.95

interface GlassShape {
  outline: string
  top: number
  bottom: number
  left: number
  right: number
  // The bowl the liquid fills, when the outline also draws a stem and base.
  bowl?: string
}

// viewBox 0 0 60 90 for every glass.
const SHAPES: Record<Glass, GlassShape> = {
  highball: { outline: 'M12 6 L48 6 L45 84 L15 84 Z', top: 6, bottom: 84, left: 12, right: 48 },
  lowball: { outline: 'M8 34 L52 34 L49 84 L11 84 Z', top: 34, bottom: 84, left: 8, right: 52 },
  wine: {
    outline: 'M14 8 L46 8 Q48 40 30 50 Q12 40 14 8 Z M30 50 L30 78 M20 84 L40 84',
    bowl: 'M14 8 L46 8 Q48 40 30 50 Q12 40 14 8 Z',
    top: 8,
    bottom: 48,
    left: 14,
    right: 46,
  },
  martini: {
    outline: 'M6 10 L54 10 L30 44 Z M30 44 L30 80 M18 84 L42 84',
    bowl: 'M6 10 L54 10 L30 44 Z',
    top: 10,
    bottom: 44,
    left: 6,
    right: 54,
  },
  shot: { outline: 'M20 50 L40 50 L38 84 L22 84 Z', top: 50, bottom: 84, left: 20, right: 40 },
}

interface Layer {
  from: number
  to: number
  color: string
}

interface DrawnStep {
  title: string
  detail: string
  layers: Layer[]
  ice: boolean
  pouring: boolean
}

// Step 1 is the glass with its ice; then one step per pour, each adding its
// layer on top of the ones before.
export function stepsToDraw(steps: PrepSteps): DrawnStep[] {
  const ice = steps.ice === 'three_quarters' || steps.ice === 'full' || steps.ice === 'on_request'
  const drawn: DrawnStep[] = [{ title: GLASS_LABELS[steps.glass], detail: ICE_LABELS[steps.ice], layers: [], ice, pouring: false }]
  let level = 0
  const layers: Layer[] = []
  for (const pour of steps.pours) {
    const to = pour.amount === 'top' ? FULL : Math.min(FULL, level + AMOUNT_FILL[pour.amount])
    if (to > level) layers.push({ from: level, to, color: pour.color })
    level = to
    drawn.push({
      title: pour.ingredient || '…',
      detail: AMOUNT_LABELS[pour.amount],
      layers: layers.map((l) => ({ ...l })),
      ice,
      pouring: true,
    })
  }
  return drawn
}

function GlassDrawing({ glass, step, id }: { glass: Glass; step: DrawnStep; id: string }) {
  const shape = SHAPES[glass]
  const height = shape.bottom - shape.top
  const clipId = `glass-${id}`
  const cubes: { x: number; y: number }[] = []
  if (step.ice) {
    const rows = Math.max(1, Math.round((height * 0.75) / 14))
    const width = shape.right - shape.left
    for (let r = 0; r < rows; r++) {
      const y = shape.bottom - 15 - r * 14
      const offset = r % 2 ? 4 : 1
      for (let x = shape.left + offset; x + 13 <= shape.right - 1; x += Math.max(14, width / 2.4)) cubes.push({ x, y })
    }
  }
  return (
    <svg width="56" height="80" viewBox="-2 -4 64 94" role="img" aria-label={`${step.title} ${step.detail}`}>
      <defs>
        <clipPath id={clipId}>
          <path d={shape.bowl ?? shape.outline} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {step.layers.map((l, i) => (
          <rect key={i} x={0} width={60} y={shape.bottom - l.to * height} height={(l.to - l.from) * height} fill={l.color} />
        ))}
        {cubes.map((c, i) => (
          <rect key={`c${i}`} x={c.x} y={c.y} width={13} height={13} rx={3} fill="#FFFFFF" fillOpacity={0.55} stroke="#9BC4D6" strokeWidth={1} />
        ))}
      </g>
      <path d={shape.outline} fill="none" stroke="#6B7A75" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {step.pouring && (
        <path d={`M30 ${shape.top - 12} L30 ${shape.top + 4} M25 ${shape.top - 1} L30 ${shape.top + 4} L35 ${shape.top - 1}`} fill="none" stroke={C.accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

// The strip of drawn steps shown under an item on the bar menu.
export function PrepStepsStrip({ steps, idPrefix }: { steps: PrepSteps; idPrefix: string }) {
  const drawn = stepsToDraw(steps)
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {drawn.map((s, i) => (
        <div key={i} className="flex flex-col items-center gap-1 rounded-xl px-1 py-2" style={{ background: C.appBg }}>
          <span className="flex size-[22px] items-center justify-center rounded-full text-xs font-extrabold text-white" style={{ background: C.primary }}>
            {i + 1}
          </span>
          <GlassDrawing glass={steps.glass} step={s} id={`${idPrefix}-${i}`} />
          <span className="text-center text-xs leading-tight font-extrabold">{s.title}</span>
          <span className="text-center text-[11.5px] leading-tight" style={{ color: C.textSecondary }}>
            {s.detail}
          </span>
        </div>
      ))}
    </div>
  )
}

export function emptyPrepSteps(): PrepSteps {
  return { glass: 'highball', ice: 'three_quarters', pours: [{ ingredient: '', amount: 'one', color: POUR_COLORS[0] }] }
}

// The editor in the item form: glass, ice, and the pours in order, with a
// live preview of the drawings.
export function PrepStepsEditor({
  value,
  onChange,
  required = false,
}: {
  value: PrepSteps | null
  onChange: (next: PrepSteps | null) => void
  // Cocktails must have steps: no "remove" link.
  required?: boolean
}) {
  if (!value) {
    return (
      <button
        type="button"
        onClick={() => onChange(emptyPrepSteps())}
        className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm font-bold"
        style={{ borderColor: C.primary, color: C.primary }}
      >
        <Plus className="size-4" />
        הוספת שלבי הכנה בציור
      </button>
    )
  }

  const setPour = (index: number, patch: Partial<Pour>) =>
    onChange({ ...value, pours: value.pours.map((p, i) => (i === index ? { ...p, ...patch } : p)) })
  const movePourUp = (index: number) => {
    if (index === 0) return
    const pours = [...value.pours]
    ;[pours[index - 1], pours[index]] = [pours[index], pours[index - 1]]
    onChange({ ...value, pours })
  }
  const removePour = (index: number) => onChange({ ...value, pours: value.pours.filter((_, i) => i !== index) })

  return (
    <div className="flex flex-col gap-3 rounded-2xl border p-3" style={{ borderColor: C.border, background: C.card }}>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-bold">
          כוס
          <select
            value={value.glass}
            onChange={(e) => onChange({ ...value, glass: e.target.value as Glass })}
            className="h-11 rounded-lg border px-2 text-base font-normal"
            style={{ borderColor: '#CFC8BD', background: C.card }}
          >
            {(Object.keys(GLASS_LABELS) as Glass[]).map((g) => (
              <option key={g} value={g}>
                {GLASS_LABELS[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold">
          קרח
          <select
            value={value.ice}
            onChange={(e) => onChange({ ...value, ice: e.target.value as Ice })}
            className="h-11 rounded-lg border px-2 text-base font-normal"
            style={{ borderColor: '#CFC8BD', background: C.card }}
          >
            {(Object.keys(ICE_LABELS) as Ice[]).map((i) => (
              <option key={i} value={i}>
                {ICE_LABELS[i]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {value.pours.map((pour, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-xl border p-2.5" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white" style={{ background: C.primary }}>
              {index + 2}
            </span>
            <input
              value={pour.ingredient}
              onChange={(e) => setPour(index, { ingredient: e.target.value })}
              placeholder="רכיב, למשל אפרול"
              aria-label={`רכיב בשלב ${index + 2}`}
              className="h-10 min-w-0 flex-1 rounded-lg border px-2.5 text-base"
              style={{ borderColor: '#CFC8BD' }}
            />
            <button
              type="button"
              aria-label="הזזה למעלה"
              disabled={index === 0}
              onClick={() => movePourUp(index)}
              className="flex size-9 items-center justify-center rounded-lg border disabled:opacity-30"
              style={{ borderColor: C.border }}
            >
              <ArrowUp className="size-4" />
            </button>
            <button
              type="button"
              aria-label="מחיקת השלב"
              onClick={() => removePour(index)}
              className="flex size-9 items-center justify-center rounded-lg border"
              style={{ borderColor: C.border, color: C.error }}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(AMOUNT_LABELS) as Amount[]).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setPour(index, { amount: a })}
                className="h-8 rounded-full px-2.5 text-xs font-bold"
                style={pour.amount === a ? { background: C.primary, color: '#fff' } : { background: C.subtleBg, color: C.text }}
              >
                {AMOUNT_LABELS[a]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs" style={{ color: C.textSecondary }}>
              צבע בציור
            </span>
            {POUR_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`צבע ${color}`}
                onClick={() => setPour(index, { color })}
                className="size-6 rounded-full"
                style={{
                  background: color,
                  boxShadow: pour.color === color ? `0 0 0 2px #fff, 0 0 0 4px ${C.primary}` : '0 0 0 1px #CFC8BD',
                }}
              />
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange({ ...value, pours: [...value.pours, { ingredient: '', amount: 'top', color: POUR_COLORS[8] }] })}
        className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm font-bold"
        style={{ borderColor: C.primary, color: C.primary }}
      >
        <Plus className="size-4" />
        הוספת שלב
      </button>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold">תצוגה מקדימה</span>
        <PrepStepsStrip steps={value} idPrefix="editor" />
      </div>

      {!required && (
        <button type="button" onClick={() => onChange(null)} className="self-start text-xs font-semibold underline" style={{ color: C.textSecondary }}>
          הסרת שלבי ההכנה
        </button>
      )}
    </div>
  )
}
