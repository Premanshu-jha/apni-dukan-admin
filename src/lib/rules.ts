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

/** The decision buttons each status offers (Add note is always there). A sent-back draft waits for the owner. */
export function decisionsFor(status: ShopStatus): Decision[] {
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

/** Text as the backend reads it: trimmed, runs of spaces and new lines collapsed to one space. */
export function clean(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** How many letters or digits (any script) a text has: "..." or "!!" alone is not a reason. */
export function lettersOrDigits(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length
}

/**
 * The backend's text rule for reasons, notes, labels and strike reasons: after cleaning, a length within the
 * limits and at least 2 letters or digits. `empty` is said when nothing was written (for a needed text).
 */
export function checkText(text: string, max: number, empty: string): string | undefined {
  const t = clean(text)
  if (!t) return empty
  if (t.length < 2 || lettersOrDigits(t) < 2) return 'Write at least 2 letters or digits'
  if (t.length > max) return `Keep it under ${max} characters (now ${t.length})`
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

export function validHours(h: number): boolean {
  return Number.isInteger(h) && h >= HOURS_MIN && h <= HOURS_MAX
}

/** Leaves out an empty optional note instead of sending "". */
export function optional(text: string): string | undefined {
  const t = clean(text)
  return t ? t : undefined
}
