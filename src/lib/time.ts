import { formatInTimeZone } from 'date-fns-tz'

/** The team works in India time, whatever zone the phone is set to. */
export const IST = 'Asia/Kolkata'

/** "4:30 PM" for an instant, in India time. */
export function timeIst(instant: string): string {
  return formatInTimeZone(new Date(instant), IST, 'h:mm a')
}

/** "Fri 7 Nov, 4:30 PM" for an instant, in India time. */
export function dateTimeIst(instant: string): string {
  return formatInTimeZone(new Date(instant), IST, 'EEE d MMM, h:mm a')
}

/** "7 Nov 2026" for an instant, in India time. */
export function dateIst(instant: string): string {
  return formatInTimeZone(new Date(instant), IST, 'd MMM yyyy')
}

/** "31 Mar 2027" for a date (YYYY-MM-DD), whatever zone the phone is in. */
export function dateOnly(day: string): string {
  return formatInTimeZone(new Date(`${day}T00:00:00Z`), 'UTC', 'd MMM yyyy')
}

/** Today's date in India, YYYY-MM-DD. */
export function todayInIndia(now: number = Date.now()): string {
  return istDate(now)
}

function istDate(instant: number): string {
  return formatInTimeZone(new Date(instant), IST, 'yyyy-MM-dd')
}

/**
 * How long ago an instant was, in words for a card: "just now", "12 min", "3 h", "1 day", "5 days".
 * A time in the future (a phone clock running behind) counts as just now.
 */
export function howLong(since: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(since).getTime()) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day' : `${days} days`
}

/** True while test mode is on and its end hasn't passed (the banner goes by itself at the end). */
export function testModeActive(flag: { on: boolean; until: string | null } | null | undefined, now: number = Date.now()): boolean {
  if (!flag?.on) return false
  return flag.until === null || new Date(flag.until).getTime() > now
}

/** "6:30 PM", or "tomorrow 1:30 AM" / "Fri 7 Nov, 1:30 AM" when the end is not today in India. */
export function untilLabel(until: string, now: number = Date.now()): string {
  const end = new Date(until).getTime()
  const today = istDate(now)
  const day = istDate(end)
  if (day === today) return timeIst(until)
  if (day === istDate(now + 86_400_000)) return `tomorrow ${timeIst(until)}`
  return dateTimeIst(until)
}

/** The red banner's words: "OTP test mode is on until 6:30 PM". */
export function testModeText(until: string | null, now: number = Date.now()): string {
  return until ? `OTP test mode is on until ${untilLabel(until, now)}` : 'OTP test mode is on'
}
