// Face ID / fingerprint login (passkeys, through Supabase Auth). The
// biometrics never leave the device; Supabase only keeps a public key.

const DEVICE_KEY = 'barburg-passkey-device'
const OFFER_DISMISSED_KEY = 'barburg-passkey-offer-dismissed'

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private mode: the button just won't be remembered on this device.
  }
}

export function passkeysSupported() {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials
}

// Set once this device has a passkey, so the login page shows the Face ID
// button only where it can work. Holds the passkey's id.
export function devicePasskeyId() {
  return read(DEVICE_KEY)
}

export function rememberDevicePasskey(id: string | null) {
  write(DEVICE_KEY, id)
}

export function offerDismissed() {
  return read(OFFER_DISMISSED_KEY) === '1'
}

export function dismissOffer() {
  write(OFFER_DISMISSED_KEY, '1')
}

// A readable name for the list on the profile page.
export function guessDeviceName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'טלפון Android' : 'טאבלט Android'
  if (/Macintosh/.test(ua)) return 'מחשב Mac'
  if (/Windows/.test(ua)) return 'מחשב Windows'
  return 'מכשיר'
}

export function friendlyPasskeyError(message: string | undefined) {
  if (!message) return 'משהו השתבש. אפשר לנסות שוב, או להיכנס עם סיסמה.'
  const m = message.toLowerCase()
  if (m.includes('notallowed') || m.includes('cancel') || m.includes('abort') || m.includes('timed out')) {
    return 'הפעולה בוטלה. אפשר לנסות שוב.'
  }
  if (m.includes('not enabled') || m.includes('disabled') || m.includes('404') || m.includes('not found')) {
    return 'כניסה עם Face ID עדיין לא מופעלת בשרת. אפשר להיכנס עם סיסמה.'
  }
  if (m.includes('excluded') || m.includes('already registered') || m.includes('invalidstate')) {
    return 'המכשיר הזה כבר מופעל.'
  }
  return message
}
