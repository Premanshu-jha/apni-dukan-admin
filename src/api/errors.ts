import type { ErrorBody } from './types'

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

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code)
}

/** The words to show a person for any error. The backend's messages are already written for people. */
export function messageOf(e: unknown): string {
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
  SHOP_CHANGED: 'The owner changed something; reload and check again',
  WRONG_STATUS: "This shop's status changed meanwhile, so that can't be done now. Here is how it is now.",
  ALREADY_ADMIN: 'This number is already on the team.',
  TEST_PHONE: "This is a test number, and a test number can't be an admin. Remove it in Test mode first.",
  CANT_REMOVE_SUPER_ADMIN: "The super admin can't be removed from the team.",
  ADMIN_PHONE: "This number belongs to someone on the team, and an admin's number can't be a test number.",
  ALREADY_TEST_PHONE: 'This number is already a test number.',
  CUSTOMER_NOT_FOUND: 'No customer has an account with this number.',
  SUPER_ADMIN_ONLY: 'Only the super admin can do this.',
}

/**
 * The words for an error: the admin codes above, the backend's field reasons spelled out for VALIDATION_FAILED
 * (its message alone, "Some fields are not valid", doesn't say what to fix), else the backend's message.
 */
export function explain(e: unknown): string {
  if (e instanceof ApiError) {
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
}
