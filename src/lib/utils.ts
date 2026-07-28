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

const dateFormatter = new Intl.DateTimeFormat('he-IL', {
  dateStyle: 'short',
  timeZone: 'Asia/Jerusalem',
})

export function formatDate(isoString: string) {
  return dateFormatter.format(new Date(isoString))
}

const timeFormatter = new Intl.DateTimeFormat('he-IL', {
  timeStyle: 'short',
  timeZone: 'Asia/Jerusalem',
})

export function formatTime(isoString: string) {
  return timeFormatter.format(new Date(isoString))
}
