import type { ChecklistItem, ShopStatus } from '../api/types'
import { CHECKLIST, CHECKLIST_LABELS } from './labels'
import { normalizePhone } from './phone'

/** The limits the backend checks (it has the final say). */
export const REASON_MIN = 2
export const REASON_MAX = 200
export const NOTE_MAX = 500
export const LABEL_MAX = 60
export const HOURS_MIN = 1
export const HOURS_MAX = 8

export type Decision = 'approve' | 'reject' | 'suspend' | 'reinstate'

/**
 * The decision buttons each status offers (Add note is always there). A sent-back draft waits for the owner. A field
 * agent only approves or sends back (suspending and reinstating are for super admins).
 */
export function decisionsFor(status: ShopStatus, superAdmin = true): Decision[] {
  if (!superAdmin) return status === 'PENDING_VISIT' ? ['approve', 'reject'] : []
  switch (status) {
    case 'PENDING_VISIT':
      return ['approve', 'reject', 'suspend']
    case 'APPROVED':
      return ['suspend']
    case 'SUSPENDED':
      return ['reinstate']
    default:
      return []
  }
}

export const DECISION_LABELS: Record<Decision, string> = {
  approve: 'Approve',
  reject: 'Send back',
  suspend: 'Suspend',
  reinstate: 'Reinstate',
}

/** Send back and Suspend need a reason for the owner; Approve and Reinstate only confirm. */
export function needsReason(d: Decision): boolean {
  return d === 'reject' || d === 'suspend'
}

/** A starting reason from the ticked items, in checklist order ("Shop was shut. Owner photo unclear."). */
export function reasonFromChecklist(items: ChecklistItem[]): string {
  const picked = CHECKLIST.filter((c) => items.includes(c) && c !== 'OTHER')
  return picked.length ? `${picked.map((c) => CHECKLIST_LABELS[c]).join('. ')}.` : ''
}

export interface DecisionErrors {
  reason?: string
  note?: string
}

/**
 * The backend's TextCleaner (common/text/TextCleaner.java), step for step, so the screen refuses exactly what the
 * backend refuses: NFKC (full-width "Ｓｈａｒｍａ" becomes "Sharma"), refuse hidden characters, collapse every kind
 * of space, at least 2 letters or digits, length in code points (as Postgres counts).
 */

/** Hidden characters: control codes (but tab, newline, carriage return), format, private use, unassigned, lone surrogates, line and paragraph separators. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\u2028\u2029]/u
const ALLOWED_CONTROLS = new Set(['\t', '\n', '\r'])

/** True when the text holds a character the backend refuses as invisible or special (checked by code point). */
export function hasHiddenCharacters(text: string): boolean {
  for (const ch of text.normalize('NFKC')) {
    if (!ALLOWED_CONTROLS.has(ch) && HIDDEN.test(ch)) return true
  }
  return false
}

/** Text as the backend saves it: NFKC, every run of spaces (any script) as one space, trimmed. */
export function clean(text: string): string {
  return text.normalize('NFKC').replace(/[\s\p{Z}]+/gu, ' ').trim()
}

/** How many letters or decimal digits (any script, by code point): "..." or "!!" alone is not a reason. */
export function lettersOrDigits(text: string): number {
  return (text.match(/\p{L}|\p{Nd}/gu) ?? []).length
}

/** Length in code points, as the backend and Postgres count it (an emoji is one, not two). */
export function codePoints(text: string): number {
  return [...text].length
}

/**
 * The backend's text rule for reasons, notes, labels and strike reasons, in its order: hidden characters, then
 * (after cleaning) at least 2 letters or digits, then the length. `empty` is said when nothing was written.
 */
export function checkText(text: string, max: number, empty: string): string | undefined {
  if (hasHiddenCharacters(text)) return 'Contains invisible or special characters'
  const t = clean(text)
  if (!t) return empty
  if (lettersOrDigits(t) < 2) return 'Write at least 2 letters or digits'
  const n = codePoints(t)
  if (n < 2) return 'Write at least 2 letters or digits'
  if (n > max) return `Keep it under ${max} characters (now ${n})`
  return undefined
}

/** Checks a decision form the way the backend does: reason 2–200 (when needed), note 2–500 when given. */
export function checkDecision(d: Decision, reason: string, note: string): DecisionErrors {
  const errors: DecisionErrors = {}
  if (needsReason(d)) {
    const r = checkText(reason, REASON_MAX, 'Write a reason for the owner')
    if (r) errors.reason = r
  }
  if (clean(note)) {
    const n = checkText(note, NOTE_MAX, '')
    if (n) errors.note = n
  }
  return errors
}

/** A note on its own (Add note): needed, 2–500. */
export function checkNote(note: string): string | undefined {
  return checkText(note, NOTE_MAX, 'Write the note')
}

/** Removing a strike: a reason of 2–200. */
export function checkStrikeReason(reason: string): string | undefined {
  return checkText(reason, REASON_MAX, 'Write why')
}

/** A test number: a valid mobile number and a label of 2–60 (who or what it is for). */
export function checkTestPhone(phone: string, label: string): { phone?: string; label?: string } {
  const errors: { phone?: string; label?: string } = {}
  if (!normalizePhone(phone)) errors.phone = 'Enter a 10-digit Indian mobile number'
  const l = checkText(label, LABEL_MAX, 'Say whose number this is')
  if (l) errors.label = l
  return errors
}

/** Roughly an email address: something@something.something, no spaces (the backend checks it fully). */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A test email: an email address and a label of 2–60 (who or what it is for). */
export function checkTestEmail(email: string, label: string): { email?: string; label?: string } {
  const errors: { email?: string; label?: string } = {}
  if (!EMAIL.test(email.trim())) errors.email = 'Enter an email address, like name@gmail.com'
  const l = checkText(label, LABEL_MAX, 'Say whose email this is')
  if (l) errors.label = l
  return errors
}

export function validHours(h: number): boolean {
  return Number.isInteger(h) && h >= HOURS_MIN && h <= HOURS_MAX
}

/** Leaves out an empty optional note instead of sending "". */
export function optional(text: string): string | undefined {
  const t = clean(text)
  return t ? t : undefined
}

/** The shortest name, owner or phone search the backend takes (ShopAdminService.requireSearchable). */
export const SEARCH_MIN = 3

/**
 * What the search box may send: the text trimmed, or "" (no search) while it is 1 or 2 letters that aren't a shop
 * number ("7" and "#42" are, at any length). The backend refuses those with 400 VALIDATION_FAILED {q}: they would
 * match most shops. Lengths count characters as the backend does (code points), so "डा" is 2.
 */
export function searchable(text: string): { q: string; tooShort: boolean } {
  const t = text.trim()
  const tooShort = t.length > 0 && [...t].length < SEARCH_MIN && !/^#?\d+$/.test(t)
  return { q: tooShort ? '' : t, tooShort }
}
