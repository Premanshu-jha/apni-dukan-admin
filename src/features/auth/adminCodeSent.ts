import { storage } from '../../lib/storage'

/** When the last code was sent, per person: a reload or a second tab doesn't send a new one (which replaces it). */
export const SENT_KEY = 'ada.adminCodeSent'
/** A code works 10 minutes; within them, opening the screen again doesn't send another. */
const CODE_LIFE_MS = 10 * 60_000
export const RESEND_AFTER_S = 30

export interface SentMark {
  userId: string
  at: number
}

/**
 * A new sign-in (phone code, recovery) or a sign-out: a code sent before belongs to the old sign-in and won't work for
 * the new one, so the next step sends a fresh one at once.
 */
export function forgetAdminCodeSent() {
  storage.remove(SENT_KEY)
}

/** When this person's last code was sent, if it still works (within 10 minutes); else null. */
export function lastSent(userId: string | undefined, now = Date.now()): number | null {
  const mark = storage.getJson<SentMark>(SENT_KEY)
  return mark && mark.userId === userId && now - mark.at < CODE_LIFE_MS ? mark.at : null
}
