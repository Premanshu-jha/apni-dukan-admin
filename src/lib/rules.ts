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

/** Checks a decision form the way the backend does: reason 2–200 (when needed), note up to 500. */
export function checkDecision(d: Decision, reason: string, note: string): DecisionErrors {
  const errors: DecisionErrors = {}
  if (needsReason(d)) {
    const r = reason.trim()
    if (r.length < REASON_MIN) errors.reason = 'Write a reason for the owner (at least 2 letters)'
    else if (r.length > REASON_MAX) errors.reason = `Keep the reason under ${REASON_MAX} letters (now ${r.length})`
  }
  if (note.trim().length > NOTE_MAX) errors.note = `Keep the note under ${NOTE_MAX} letters (now ${note.trim().length})`
  return errors
}

/** A note on its own (Add note): needed, up to 500. */
export function checkNote(note: string): string | undefined {
  const n = note.trim()
  if (!n) return 'Write the note'
  if (n.length > NOTE_MAX) return `Keep the note under ${NOTE_MAX} letters (now ${n.length})`
  return undefined
}

/** Removing a strike: a reason of 2–200 letters (assumed the same limits as a decision reason). */
export function checkStrikeReason(reason: string): string | undefined {
  const r = reason.trim()
  if (r.length < REASON_MIN) return 'Write why (at least 2 letters)'
  if (r.length > REASON_MAX) return `Keep it under ${REASON_MAX} letters (now ${r.length})`
  return undefined
}

/** A test number: a valid mobile number and a label (who or what it is for). */
export function checkTestPhone(phone: string, label: string): { phone?: string; label?: string } {
  const errors: { phone?: string; label?: string } = {}
  if (!normalizePhone(phone)) errors.phone = 'Enter a 10-digit Indian mobile number'
  const l = label.trim()
  if (!l) errors.label = 'Say whose number this is'
  else if (l.length > LABEL_MAX) errors.label = `Keep it under ${LABEL_MAX} letters`
  return errors
}

export function validHours(h: number): boolean {
  return Number.isInteger(h) && h >= HOURS_MIN && h <= HOURS_MAX
}

/** Leaves out an empty optional note instead of sending "". */
export function optional(text: string): string | undefined {
  const t = text.trim()
  return t ? t : undefined
}
