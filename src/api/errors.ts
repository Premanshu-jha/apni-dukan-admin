import { STATUS_LABELS } from '../lib/labels'
import type { ErrorBody, ShopStatus } from './types'

/** Every failed call becomes one of these. `code` is the backend's error code, or NETWORK / UNKNOWN. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>
  readonly retryAfterSeconds: number | null

  constructor(status: number, body: Partial<ErrorBody>, retryAfterSeconds: number | null = null) {
    super(body.message || 'Something went wrong. Please try again.')
    this.name = 'ApiError'
    this.status = status
    this.code = body.code || 'UNKNOWN'
    this.details = body.details ?? {}
    this.retryAfterSeconds = retryAfterSeconds
  }

  static network(): ApiError {
    return new ApiError(0, { code: 'NETWORK', message: "You're offline or the server can't be reached. Try again." })
  }
}

/**
 * How long TanStack Query waits before trying a failed read again: what the backend asked for in Retry-After when it
 * sent one (SERVICE_BUSY: 5 s; at most 30 s), else 1 s, 2 s, 4 s… up to 30 s. The client has already waited and tried
 * once more for SERVICE_BUSY, so a busy backend gets a call every 5 s at most, never a burst.
 */
export function retryDelay(attempt: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfterSeconds) return Math.min(error.retryAfterSeconds, 30) * 1000
  return Math.min(1000 * 2 ** attempt, 30_000)
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code)
}

/** The words to show a person for any error. The backend's messages are already written for people. */
export function messageOf(e: unknown): string {
  // 429 TRY_LATER (sign-in codes): this network has to wait before the next try; Retry-After says how long
  if (e instanceof ApiError && e.code === 'TRY_LATER') return tryLaterText(e.retryAfterSeconds)
  if (e instanceof ApiError) return e.message
  return 'Something went wrong. Please try again.'
}

/** VALIDATION_FAILED details map field names to messages; this picks one field's message. */
export function fieldError(e: unknown, field: string): string | undefined {
  if (!(e instanceof ApiError) || e.code !== 'VALIDATION_FAILED') return undefined
  const value = e.details[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * The admin API's refusals, in the words the field team should see. These are fixed by the contract, so the app
 * says exactly what to do next rather than the backend's general message.
 */
export const ADMIN_MESSAGES: Record<string, string> = {
  SHOP_CHANGED: 'This business changed since you opened it (the owner or another admin). Reload and check again.',
  WRONG_STATUS: 'Someone else decided meanwhile.',
  ALREADY_ADMIN: 'This number is already on the team.',
  TEST_PHONE: 'This is a test number, or an account made in test mode, so it can\'t be an admin.',
  CANT_REMOVE_SUPER_ADMIN: "The super admin can't be removed from the team.",
  ADMIN_PHONE: "This number belongs to someone on the team, and an admin's number can't be a test number.",
  REAL_ACCOUNT: 'That number already has a real account (a customer or a business). Use a number nobody has signed in with.',
  ALREADY_TEST_PHONE: 'This number is already a test number.',
  CUSTOMER_NOT_FOUND: 'No customer has an account with this number.',
  STRIKE_NOT_FOUND: 'This strike was already removed, maybe by someone else. The list now shows what is left.',
  INVALID_PHONE: "That isn't a valid mobile number. Check the 10 digits.",
  SUPER_ADMIN_ONLY: 'Only the super admin can do this.',
  OWN_SHOP:
    "You work in this business (as its owner, a helper or a barber), so you can't decide on it or write notes about it. Ask another admin.",
}

/** 409 WRONG_STATUS: "Someone else decided meanwhile: it is now Live." (details.status = the status now). */
export function wrongStatusText(e: unknown): string {
  const now = e instanceof ApiError ? (e.details.status as ShopStatus | undefined) : undefined
  return now && STATUS_LABELS[now] ? `Someone else decided meanwhile: it is now ${STATUS_LABELS[now]}.` : ADMIN_MESSAGES.WRONG_STATUS
}

/** The words for a phone field: 400 INVALID_PHONE (no details) or a VALIDATION_FAILED on `phone`. */
export function phoneError(e: unknown): string | undefined {
  if (isApiError(e, 'INVALID_PHONE')) return ADMIN_MESSAGES.INVALID_PHONE
  return fieldError(e, 'phone')
}

/** A network failure or timeout: the call may or may not have reached the backend. */
export function isNetwork(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0
}

/**
 * The words for an error: the admin codes above, the backend's field reasons spelled out for VALIDATION_FAILED
 * (its message alone, "Some fields are not valid", doesn't say what to fix), else the backend's message.
 */
export function explain(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'WRONG_STATUS') return wrongStatusText(e)
    if (ADMIN_MESSAGES[e.code]) return ADMIN_MESSAGES[e.code]
    if (e.code === 'VALIDATION_FAILED') {
      const reasons = Object.entries(e.details)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => `${FIELD_NAMES[k] ?? k} ${v}`)
      if (reasons.length) return `${reasons.join('. ')}.`
    }
  }
  return messageOf(e)
}

const FIELD_NAMES: Record<string, string> = {
  reason: 'The reason',
  note: 'The note',
  checklist: 'The checklist',
  version: 'The version',
  phone: 'The number',
  label: 'The label',
  hours: 'The hours',
  name: 'The name',
  q: 'The search:',
}

/** "Too many tries from this network. Try again in 4 minutes." (from Retry-After; at least a minute). */
export function tryLaterText(seconds: number | null): string {
  const minutes = Math.max(1, Math.ceil((seconds ?? 60) / 60))
  return `Too many tries from this network. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
}
