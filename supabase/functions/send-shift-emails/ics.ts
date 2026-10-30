// Calendar attachment (.ics) plus the Google/Outlook "add event" links.
// The UID is stable per person+evening+duty, so the removal email's
// CANCEL file targets the same event the sign-up file added.

export interface CalendarEvent {
  uid: string
  title: string
  description: string
  location: string
  start: Date
  end: Date
}

function icsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function icsText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

// RFC 5545 caps content lines at 75 octets -- Hebrew is 2 bytes a letter,
// so fold by bytes, never mid-character.
function fold(line: string) {
  const encoder = new TextEncoder()
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const size = encoder.encode(ch).length
    if (bytes + size > (out.length === 0 ? 75 : 74)) {
      out.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += size
  }
  out.push(current)
  return out.join('\r\n ')
}

export function buildIcs(event: CalendarEvent, cancel: boolean) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Barburg//Shifts//HE',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancel ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    // Ever-increasing, so a later sign-up or cancel supersedes the earlier file.
    `SEQUENCE:${Math.floor(Date.now() / 1000)}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(event.start)}`,
    `DTEND:${icsDate(event.end)}`,
    `SUMMARY:${icsText(event.title)}`,
    `DESCRIPTION:${icsText(event.description)}`,
    `LOCATION:${icsText(event.location)}`,
    `STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function googleCalendarUrl(event: CalendarEvent) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${icsDate(event.start)}/${icsDate(event.end)}`,
    details: event.description,
    location: event.location,
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

export function outlookCalendarUrl(event: CalendarEvent) {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: event.start.toISOString(),
    enddt: event.end.toISOString(),
    location: event.location,
    body: event.description,
  })
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`
}

export function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
