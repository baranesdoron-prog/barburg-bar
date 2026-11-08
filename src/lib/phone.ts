// Free-text phone numbers (suppliers) to the digits wa.me wants:
// country code + national number, no "+", no leading 0. Same rules as the
// database's normalize_il_phone(), plus the forms people actually type:
// "050-1234567", "+972 50 123 4567", "+972 050...", "00972...", "972-50...".
// Returns null when it can't be a phone number.
export function whatsappDigits(phone: string | null | undefined): string | null {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)

  // Typed into a right-to-left field, "+972 54..." can end up saved with
  // the country code at the end ("542609623972"): put it back in front.
  if (digits.length === 12 && digits.endsWith('972') && digits.startsWith('5')) return `972${digits.slice(0, 9)}`
  if (digits.length === 13 && digits.endsWith('972') && digits.startsWith('05')) return `972${digits.slice(1, 10)}`

  if (digits.startsWith('972')) {
    const national = digits.slice(3).replace(/^0/, '')
    return national.length === 8 || national.length === 9 ? `972${national}` : null
  }
  if (digits.startsWith('0')) {
    const national = digits.slice(1)
    return national.length === 8 || national.length === 9 ? `972${national}` : null
  }
  // A mobile number typed without its leading 0 (e.g. 501234567).
  if (digits.length === 9 && digits.startsWith('5')) return `972${digits}`
  // Already international, another country.
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}

// "+972 50-123-4567" for showing which number WhatsApp will open.
export function formatWhatsappNumber(digits: string) {
  if (digits.startsWith('972') && digits.length === 12) {
    const n = digits.slice(3)
    return `+972 ${n.slice(0, 2)}-${n.slice(2, 5)}-${n.slice(5)}`
  }
  return `+${digits}`
}
