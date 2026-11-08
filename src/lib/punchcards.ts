// Shared by the punchcard pages (/punchcards/*): types, the token value,
// and plain-Hebrew versions of the database errors.

export const SHEKELS_PER_TOKEN = 5
export const PUNCHCARD_AMOUNTS = [25, 50, 100] as const
// How long a customer can still cancel an order before it's punched.
export const CANCEL_WINDOW_MS = 60_000
// How long the confirmed card stays live (running clock) for the bartender.
// After that, or once the customer leaves the page, it's stamped "used".
export const SHOW_WINDOW_MS = 60_000

// Marks an order closed even while the page is being left or the phone
// locked: a keepalive request survives the page going away, which the
// regular client call doesn't.
export function closeOrderInBackground(orderId: string, accessToken: string | null) {
  if (!accessToken) return
  try {
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/close_punchcard_order`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ p_order_id: orderId }),
    }).catch(() => {})
  } catch {
    // Best effort: the card also freezes on its own once the minute is up.
  }
}

export interface Punchcard {
  id: string
  owner_id: string
  amount: number
  tokens_total: number
  tokens_used: number
  created_at: string
  expires_at: string
}

export interface OrderLine {
  item_id: string
  name: string
  qty: number
  tokens: number
}

export interface PunchcardOrder {
  id: string
  owner_id: string
  items: OrderLine[]
  total_tokens: number
  status: 'pending' | 'confirmed' | 'cancelled'
  evening_date: string
  night_color: string
  order_number: number | null
  created_at: string
  confirmed_at: string | null
  cancelled_at: string | null
  // Set when the customer closes the card after showing it; from then on
  // the card shows the order time frozen instead of a live clock.
  closed_at: string | null
  // 'tokens': a number of tokens punched without choosing from the menu.
  kind: 'menu' | 'tokens'
}

export interface CustomerMenuRow {
  category_id: string
  category_name: string
  category_sort: number
  default_tokens: number | null
  item_id: string
  name: string
  description: string | null
  tokens: number
  item_sort: number
}

export function tokensLeft(card: Punchcard) {
  return card.tokens_total - card.tokens_used
}

export function isUsable(card: Punchcard, now = Date.now()) {
  return tokensLeft(card) > 0 && new Date(card.expires_at).getTime() > now
}

// One-line summary for lists: the items, or "ניקוב של 4 ניקובים".
export function orderSummary(order: { kind: 'menu' | 'tokens'; items: OrderLine[]; total_tokens: number }) {
  if (order.kind === 'tokens') return `ניקוב של ${tokensLabel(order.total_tokens)}`
  return order.items.map((l) => `${l.qty} × ${l.name}`).join(', ')
}

export function tokensLabel(n: number) {
  return n === 1 ? 'ניקוב אחד' : `${n} ניקובים`
}

const dateFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

export function formatDate(iso: string) {
  return dateFormatter.format(new Date(iso))
}

const timeFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function formatTime(iso: string | Date) {
  return timeFormatter.format(typeof iso === 'string' ? new Date(iso) : iso)
}

export function friendlyPunchcardError(message: string | undefined) {
  if (!message) return 'משהו השתבש. כדאי לנסות שוב.'
  if (message.includes('not_enough_tokens')) return 'אין מספיק ניקובים בכרטיסיות שלך.'
  if (message.includes('pending_order_exists')) return 'יש לך הזמנה שעוד לא אושרה. כדאי לסיים אותה קודם.'
  if (message.includes('cancel_window_passed')) return 'עברה הדקה, ואי אפשר לבטל את ההזמנה.'
  if (message.includes('invalid_order')) return 'אחד הפריטים כבר לא בתפריט. כדאי לרענן ולנסות שוב.'
  if (message.includes('not allowed')) return 'אין לך הרשאה לפעולה הזו.'
  return message
}
