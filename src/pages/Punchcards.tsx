import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Minus, Plus, RotateCcw, AlertTriangle } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { C } from '@/lib/designTokens'
import { useAppUserContext } from '@/lib/outletContext'
import { PunchcardView } from '@/components/PunchcardView'
import {
  CANCEL_WINDOW_MS,
  PUNCHCARD_AMOUNTS,
  SHEKELS_PER_TOKEN,
  formatDate,
  formatTime,
  friendlyPunchcardError,
  isUsable,
  tokensLabel,
  tokensLeft,
  type CustomerMenuRow,
  type Punchcard,
  type PunchcardOrder,
} from '@/lib/punchcards'

// The cart survives a trip to the top-up page and back.
const CART_KEY = 'punchcard-cart'

function readCart(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(CART_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function writeCart(cart: Record<string, number>) {
  try {
    if (Object.keys(cart).length === 0) sessionStorage.removeItem(CART_KEY)
    else sessionStorage.setItem(CART_KEY, JSON.stringify(cart))
  } catch {
    // Storage unavailable: the cart just isn't kept.
  }
}

function Page({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div dir="rtl" className="mx-auto flex max-w-md flex-col gap-4 pb-24" style={{ color: C.text }}>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle && (
          <p className="text-sm" style={{ color: C.textSecondary }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

const primaryButton = 'flex h-13 items-center justify-center rounded-xl text-base font-bold text-white disabled:opacity-50'

// ---------------------------------------------------------------------
// My punchcards
// ---------------------------------------------------------------------

export function MyPunchcards() {
  const { appUser } = useAppUserContext()
  const navigate = useNavigate()
  const [cards, setCards] = useState<Punchcard[] | null>(null)
  const [orders, setOrders] = useState<PunchcardOrder[]>([])
  const [tab, setTab] = useState<'available' | 'archive'>('available')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [cardsRes, ordersRes] = await Promise.all([
      supabase.from('punchcards').select('*').eq('owner_id', appUser.id).order('expires_at'),
      supabase
        .from('punchcard_orders')
        .select('*')
        .eq('owner_id', appUser.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    if (cardsRes.error) setError(cardsRes.error.message)
    setCards((cardsRes.data as Punchcard[]) ?? [])
    setOrders((ordersRes.data as PunchcardOrder[]) ?? [])
    return (ordersRes.data as PunchcardOrder[]) ?? []
  }, [appUser.id])

  useEffect(() => {
    load().then(async (loaded) => {
      // An order whose minute ran out while the app was closed counts as
      // confirmed; one still inside its minute goes back to its countdown.
      const pending = loaded.find((o) => o.status === 'pending')
      if (!pending) return
      if (Date.now() - new Date(pending.created_at).getTime() < CANCEL_WINDOW_MS) {
        navigate(`/punchcards/orders/${pending.id}`)
        return
      }
      await supabase.rpc('confirm_punchcard_order', { p_order_id: pending.id })
      load()
    })
  }, [load, navigate])

  if (cards === null) return null

  const available = cards.filter((c) => isUsable(c))
  const archive = cards.filter((c) => !isUsable(c)).reverse()
  const balance = available.reduce((sum, c) => sum + tokensLeft(c), 0)
  const shown = tab === 'available' ? available : archive
  const recentOrders = orders.filter((o) => o.status === 'confirmed').slice(0, 5)

  return (
    <Page title="הכרטיסיות שלי" subtitle={<>נשארו <b style={{ color: C.primary }}>{tokensLabel(balance)}</b> בכל הכרטיסיות</>}>
      <div className="flex gap-2">
        <Link
          to={balance > 0 ? '/punchcards/order' : '/punchcards/buy'}
          className={`${primaryButton} flex-1`}
          style={{ background: C.primary }}
        >
          {balance > 0 ? 'להזמנה מהתפריט' : 'קניית כרטיסייה'}
        </Link>
        {balance > 0 && (
          <Link
            to="/punchcards/buy"
            className="flex h-13 flex-1 items-center justify-center rounded-xl border text-base font-semibold"
            style={{ borderColor: C.border, background: C.card }}
          >
            כרטיסייה נוספת
          </Link>
        )}
      </div>

      <div className="flex gap-1 rounded-full p-1" style={{ background: C.subtleBg }}>
        {(['available', 'archive'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="h-10 flex-1 rounded-full text-sm font-bold"
            style={tab === t ? { background: C.primary, color: '#fff' } : { color: C.textSecondary }}
          >
            {t === 'available' ? `זמינות · ${available.length}` : `ארכיון · ${archive.length}`}
          </button>
        ))}
      </div>

      {error && <p style={{ color: C.error }}>{error}</p>}

      {shown.length === 0 && (
        <p className="text-sm" style={{ color: C.textSecondary }}>
          {tab === 'available' ? 'אין כרטיסיות זמינות.' : 'עוד אין כרטיסיות בארכיון.'}
        </p>
      )}

      {shown.map((card) => {
        const expired = new Date(card.expires_at).getTime() <= Date.now()
        return (
          <div key={card.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-extrabold">כרטיסיית ניקובים {card.amount} ₪</span>
              <span className="text-base font-bold" style={{ color: tokensLeft(card) ? C.primary : C.textSecondary }}>
                נשארו {tokensLeft(card)}
              </span>
            </div>
            <PunchcardView amount={card.amount} tokensTotal={card.tokens_total} tokensUsed={card.tokens_used} />
            <span className="text-center text-sm" style={{ color: C.textSecondary }}>
              {expired ? 'פג תוקף ב־' : 'בתוקף עד '}
              {formatDate(card.expires_at)}
            </span>
          </div>
        )
      })}

      {recentOrders.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <span className="text-base font-extrabold">הזמנות אחרונות</span>
          {recentOrders.map((o) => (
            <Link
              key={o.id}
              to={`/punchcards/orders/${o.id}`}
              className="flex items-center gap-3 rounded-xl border p-3"
              style={{ borderColor: C.border, background: C.card }}
            >
              <span className="size-4 shrink-0 rounded-full" style={{ background: o.night_color }} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {o.items.map((l) => `${l.qty} × ${l.name}`).join(', ')}
              </span>
              <span className="text-sm whitespace-nowrap" style={{ color: C.textSecondary }}>
                {formatDate(o.created_at)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------
// Buy a punchcard (no payment yet: the card is added straight away)
// ---------------------------------------------------------------------

export function BuyPunchcard() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnToOrder = searchParams.get('return') === 'order'
  const [amount, setAmount] = useState<number>(100)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function buy() {
    setBusy(true)
    setError(null)
    const { error: buyError } = await supabase.rpc('buy_punchcard', { p_amount: amount })
    setBusy(false)
    if (buyError) {
      setError(friendlyPunchcardError(buyError.message))
      return
    }
    navigate(returnToOrder ? '/punchcards/order' : '/punchcards')
  }

  return (
    <Page title="רכישת כרטיסייה" subtitle={`כל ניקוב שווה ${SHEKELS_PER_TOKEN} ₪`}>
      {returnToOrder && (
        <p className="rounded-xl p-3 text-sm" style={{ background: C.warningBg, color: '#7A4A0A' }}>
          אחרי הקנייה חוזרים להזמנה. מה שבחרת נשמר.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="punchcard-amount" className="text-sm font-bold">
          סכום
        </label>
        <select
          id="punchcard-amount"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="h-12 rounded-xl border px-3 text-base"
          style={{ borderColor: C.border, background: C.card }}
        >
          {PUNCHCARD_AMOUNTS.map((a) => (
            <option key={a} value={a}>
              {a} ₪ · {a / SHEKELS_PER_TOKEN} ניקובים
            </option>
          ))}
        </select>
      </div>

      <PunchcardView
        amount={amount}
        tokensTotal={amount / SHEKELS_PER_TOKEN}
        tokensUsed={0}
        footer={<span className="text-sm">בתוקף שנה מיום הקנייה</span>}
      />

      <p className="rounded-xl border p-3 text-sm" style={{ borderColor: C.border, background: C.card, color: C.textSecondary }}>
        הכרטיסייה נוספת לחשבון שלך מיד. בשלב הזה אין סליקה באפליקציה: התשלום עצמו מתבצע כרגיל.
      </p>

      {error && <p style={{ color: C.error }}>{error}</p>}

      <button type="button" disabled={busy} onClick={buy} className={primaryButton} style={{ background: C.primary }}>
        קניית כרטיסייה · {amount} ₪
      </button>
    </Page>
  )
}

// ---------------------------------------------------------------------
// Order from the menu
// ---------------------------------------------------------------------

export function OrderFromMenu() {
  const navigate = useNavigate()
  const [menu, setMenu] = useState<CustomerMenuRow[] | null>(null)
  const [balance, setBalance] = useState(0)
  const [cart, setCart] = useState<Record<string, number>>(() => readCart())
  const [showNotEnough, setShowNotEnough] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([supabase.rpc('customer_menu'), supabase.rpc('punchcard_balance')]).then(([menuRes, balanceRes]) => {
      setMenu((menuRes.data as CustomerMenuRow[]) ?? [])
      setBalance((balanceRes.data as number) ?? 0)
      if (menuRes.error) setError(menuRes.error.message)
    })
  }, [])

  const sections = useMemo(() => {
    const map = new Map<string, { name: string; tokens: number | null; items: CustomerMenuRow[] }>()
    for (const row of menu ?? []) {
      if (!map.has(row.category_id)) map.set(row.category_id, { name: row.category_name, tokens: row.default_tokens, items: [] })
      map.get(row.category_id)!.items.push(row)
    }
    return [...map.values()]
  }, [menu])

  if (menu === null) return null

  const total = menu.reduce((sum, row) => sum + (cart[row.item_id] ?? 0) * row.tokens, 0)
  const enough = total <= balance

  function change(itemId: string, delta: number) {
    setCart((prev) => {
      const next = { ...prev, [itemId]: Math.max(0, Math.min(20, (prev[itemId] ?? 0) + delta)) }
      if (!next[itemId]) delete next[itemId]
      writeCart(next)
      return next
    })
  }

  async function place() {
    if (!enough) {
      setShowNotEnough(true)
      return
    }
    setBusy(true)
    setError(null)
    const { data, error: placeError } = await supabase.rpc('place_punchcard_order', {
      p_items: Object.entries(cart).map(([item_id, qty]) => ({ item_id, qty })),
    })
    setBusy(false)
    if (placeError || !data) {
      if (placeError?.message.includes('not_enough_tokens')) setShowNotEnough(true)
      else setError(friendlyPunchcardError(placeError?.message))
      return
    }
    writeCart({})
    navigate(`/punchcards/orders/${(data as PunchcardOrder).id}`, { replace: true })
  }

  return (
    <Page title="מה להזמין?" subtitle={<>נשארו <b style={{ color: C.primary }}>{tokensLabel(balance)}</b></>}>
      <div
        className="sticky top-2 z-10 flex flex-col gap-2 rounded-2xl border p-3 shadow-sm"
        style={{ borderColor: C.border, background: C.card }}
      >
        <div className="flex justify-between text-base">
          <span>סה״כ</span>
          <b>{tokensLabel(total)}</b>
        </div>
        <div className="flex justify-between text-sm" style={{ color: C.textSecondary }}>
          <span>יישארו בכרטיסיות</span>
          <span>{enough ? balance - total : 'לא מספיק'}</span>
        </div>
        {error && <p className="text-sm" style={{ color: C.error }}>{error}</p>}
        <button
          type="button"
          disabled={total === 0 || busy}
          onClick={place}
          className={primaryButton}
          style={{ background: total === 0 ? C.border : C.primary, color: total === 0 ? C.textSecondary : '#fff' }}
        >
          {total === 0 ? 'בחירת פריטים' : `הזמנה · ${tokensLabel(total)}`}
        </button>
      </div>

      {sections.map((section) => (
        <div key={section.name} className="flex flex-col gap-2">
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-base font-extrabold">{section.name}</span>
            {section.tokens !== null && (
              <span className="text-sm font-extrabold" style={{ color: '#7A5230' }}>
                {tokensLabel(section.tokens)}
              </span>
            )}
          </div>
          {section.items.map((item) => {
            const qty = cart[item.item_id] ?? 0
            return (
              <div
                key={item.item_id}
                className="flex items-center gap-2 rounded-xl border px-3 py-2"
                style={{ borderColor: qty ? C.primary : C.border, background: C.card }}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-bold">{item.name}</span>
                  {item.description && (
                    <span className="text-xs" style={{ color: C.textSecondary }}>
                      {item.description}
                    </span>
                  )}
                  {section.tokens !== item.tokens && (
                    <span className="text-xs font-bold" style={{ color: '#7A5230' }}>
                      {tokensLabel(item.tokens)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`פחות ${item.name}`}
                  onClick={() => change(item.item_id, -1)}
                  disabled={qty === 0}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full border disabled:opacity-40"
                  style={{ borderColor: C.border, background: C.card }}
                >
                  <Minus className="size-4" />
                </button>
                <span className="w-5 text-center text-lg font-extrabold">{qty}</span>
                <button
                  type="button"
                  aria-label={`עוד ${item.name}`}
                  onClick={() => change(item.item_id, 1)}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ background: C.primary }}
                >
                  <Plus className="size-4" />
                </button>
              </div>
            )
          })}
        </div>
      ))}

      {showNotEnough && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4" style={{ background: 'rgba(32,42,38,.55)' }}>
          <div dir="rtl" className="flex w-full max-w-md flex-col gap-3 rounded-2xl bg-white p-5">
            <div className="flex size-14 items-center justify-center self-center rounded-full" style={{ background: C.warningBg }}>
              <AlertTriangle className="size-7" style={{ color: C.warning }} />
            </div>
            <h2 className="text-center text-xl font-extrabold">אין מספיק ניקובים</h2>
            <p className="text-center" style={{ color: C.textSecondary }}>
              ההזמנה צריכה <b style={{ color: C.text }}>{tokensLabel(total)}</b>, ובכרטיסיות נשארו{' '}
              <b style={{ color: C.text }}>{balance}</b>. חסרים {total - balance}.
            </p>
            <p className="rounded-xl p-3 text-center text-sm" style={{ background: C.subtleBg, color: C.textSecondary }}>
              אפשר לטעון כרטיסייה חדשה ולחזור לכאן. מה שבחרת נשמר.
            </p>
            <Link to="/punchcards/buy?return=order" className={primaryButton} style={{ background: C.primary }}>
              טעינה: קניית כרטיסייה חדשה
            </Link>
            <button
              type="button"
              onClick={() => setShowNotEnough(false)}
              className="h-12 rounded-xl border text-base font-semibold"
              style={{ borderColor: C.border }}
            >
              חזרה לעריכת ההזמנה
            </button>
          </div>
        </div>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------
// One order: the cancel minute, then the card to show the bartender
// ---------------------------------------------------------------------

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

const weekdayFormatter = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' })
const dayMonthFormatter = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' })

export function PunchcardOrderPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState<PunchcardOrder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const now = useNow(250)

  useEffect(() => {
    supabase
      .from('punchcard_orders')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error: loadError }) => {
        if (loadError || !data) setError(loadError?.message ?? 'ההזמנה לא נמצאה')
        else setOrder(data as PunchcardOrder)
      })
  }, [id])

  const confirm = useCallback(async () => {
    if (!order || busy) return
    setBusy(true)
    const { data, error: confirmError } = await supabase.rpc('confirm_punchcard_order', { p_order_id: order.id })
    setBusy(false)
    if (confirmError || !data) setError(friendlyPunchcardError(confirmError?.message))
    else setOrder(data as PunchcardOrder)
  }, [order, busy])

  async function cancel() {
    if (!order) return
    setBusy(true)
    const { data, error: cancelError } = await supabase.rpc('cancel_punchcard_order', { p_order_id: order.id })
    setBusy(false)
    if (cancelError || !data) setError(friendlyPunchcardError(cancelError?.message))
    else setOrder(data as PunchcardOrder)
  }

  const msLeft = order ? new Date(order.created_at).getTime() + CANCEL_WINDOW_MS - now.getTime() : 0

  // The minute ran out: the order goes through.
  useEffect(() => {
    if (order?.status === 'pending' && msLeft <= 0 && !busy) confirm()
  }, [order?.status, msLeft, busy, confirm])

  if (error && !order) return <p style={{ color: C.error }}>{error}</p>
  if (!order) return null

  const lines = order.items.map((l) => `${l.qty} × ${l.name}`)

  if (order.status === 'cancelled') {
    return (
      <Page title="ההזמנה בוטלה" subtitle="לא נוקבו ניקובים.">
        <div className="rounded-2xl border p-4" style={{ borderColor: C.border, background: C.card }}>
          {lines.map((l) => (
            <p key={l} className="text-lg">
              {l}
            </p>
          ))}
        </div>
        <button type="button" onClick={() => navigate('/punchcards/order')} className={primaryButton} style={{ background: C.primary }}>
          הזמנה חדשה
        </button>
      </Page>
    )
  }

  if (order.status === 'pending') {
    const seconds = Math.max(0, Math.ceil(msLeft / 1000))
    const progress = Math.max(0, Math.min(1, msLeft / CANCEL_WINDOW_MS))
    return (
      <Page title="ההזמנה כמעט מוכנה">
        <div
          className="flex size-44 flex-col items-center justify-center self-center rounded-full"
          style={{ background: `conic-gradient(${C.accent} ${progress * 360}deg, ${C.border} 0deg)` }}
        >
          <div className="flex size-36 flex-col items-center justify-center rounded-full" style={{ background: C.appBg }}>
            <span dir="ltr" className="text-5xl leading-none font-extrabold tabular-nums">
              0:{String(seconds).padStart(2, '0')}
            </span>
            <span className="text-sm" style={{ color: C.textSecondary }}>
              אפשר עוד לבטל
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-2xl border p-4" style={{ borderColor: C.border, background: C.card }}>
          {order.items.map((l) => (
            <div key={l.item_id} className="flex justify-between text-lg">
              <span>
                {l.qty} × {l.name}
              </span>
              <b>{l.qty * l.tokens}</b>
            </div>
          ))}
          <div className="flex justify-between border-t pt-2 text-lg font-extrabold" style={{ borderColor: C.border }}>
            <span>סה״כ</span>
            <span>{tokensLabel(order.total_tokens)}</span>
          </div>
        </div>

        <p className="text-center text-sm" style={{ color: C.textSecondary }}>
          הניקובים עוד לא נוקבו. בסוף הדקה, או בלחיצה על "אישור", יופיע כרטיס ההזמנה להצגה לברמן/ית.
        </p>
        {error && <p style={{ color: C.error }}>{error}</p>}

        <button type="button" disabled={busy} onClick={confirm} className={primaryButton} style={{ background: C.primary }}>
          אישור ההזמנה
        </button>
        <button
          type="button"
          disabled={busy || msLeft <= 0}
          onClick={cancel}
          className="h-12 rounded-xl text-base font-bold disabled:opacity-50"
          style={{ background: C.errorBg, color: '#B03434' }}
        >
          ביטול ההזמנה
        </button>
      </Page>
    )
  }

  // Confirmed: the full-screen card in tonight's colour.
  return (
    <div dir="rtl" className="fixed inset-0 z-50 flex flex-col gap-3 overflow-y-auto p-5 text-white" style={{ background: order.night_color }}>
      <style>{'@keyframes livepulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}'}</style>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="ברבורג" className="size-11 rounded-full object-cover ring-3 ring-white/60" />
          <span className="text-lg font-extrabold">ברבורג</span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1.5 text-sm font-bold">
          <span className="size-2.5 rounded-full" style={{ background: '#7CF29A', animation: 'livepulse 1.2s ease-in-out infinite' }} />
          הזמנה #{order.order_number}
        </span>
      </div>

      <div className="flex flex-col items-center rounded-2xl bg-black/25 px-4 py-3">
        <span className="text-3xl font-extrabold">
          {weekdayFormatter.format(now)} {dayMonthFormatter.format(now)}
        </span>
        <span dir="ltr" className="text-6xl leading-none font-extrabold tabular-nums">
          {formatTime(now)}
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-1">
        {lines.map((l) => (
          <span key={l} className="text-4xl leading-tight font-extrabold">
            {l}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-white/15 px-4 py-3">
        <span className="text-xl font-bold">נוקבו</span>
        <span className="text-4xl font-extrabold">{tokensLabel(order.total_tokens)}</span>
      </div>
      <span className="text-center text-sm opacity-90">
        הוזמן ב־{formatTime(order.created_at)}
        {order.confirmed_at && ` · אושר ב־${formatTime(order.confirmed_at)}`}
      </span>

      <div className="flex-1" />
      <button
        type="button"
        onClick={() => navigate('/punchcards')}
        className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white/90 text-base font-extrabold"
        style={{ color: order.night_color }}
      >
        <RotateCcw className="size-4" />
        סגירה (ההזמנה נשמרת)
      </button>
    </div>
  )
}
