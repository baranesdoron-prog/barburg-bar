import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const dateTimeFormatter = new Intl.DateTimeFormat('he-IL', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Jerusalem',
})

export function formatDateTime(isoString: string) {
  return dateTimeFormatter.format(new Date(isoString))
}

const localDateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function toLocalDateKey(isoString: string) {
  return localDateKeyFormatter.format(new Date(isoString))
}
