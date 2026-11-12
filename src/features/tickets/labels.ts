import type { TicketSource, TicketStatus, TicketView } from '../../api/types'

export const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Waiting on us',
  WAITING: 'Waiting on them',
  RESOLVED: 'Resolved',
}

export const STATUS_TONES: Record<TicketStatus, 'warn' | 'brand' | 'good'> = {
  OPEN: 'warn',
  WAITING: 'brand',
  RESOLVED: 'good',
}

export const SOURCE_LABELS: Record<TicketSource, string> = {
  EMAIL: 'Email',
  CUSTOMER: 'Customer app',
  PARTNER: 'Partner app',
}

export const VIEW_LABELS: Record<TicketView, string> = {
  OPEN: 'Waiting on us',
  WAITING: 'Waiting on them',
  RESOLVED: 'Resolved',
  ACTIVE: 'Not resolved',
  UNASSIGNED: 'Unassigned',
}

export function isTicketView(v: string | null): v is TicketView {
  return v === 'OPEN' || v === 'WAITING' || v === 'RESOLVED' || v === 'ACTIVE' || v === 'UNASSIGNED'
}

/** What a history entry says, in words. */
export const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Created',
  ASSIGNED: 'Assigned',
  REASSIGNED: 'Moved',
  UNASSIGNED: 'Unassigned',
  PROFILE_VIEWED: 'Profile viewed',
  REPLIED: 'Replied',
  RESOLVED: 'Resolved',
  REOPENED: 'Opened again',
  EMAIL_FAILED: 'Email not sent',
  EMAIL_SKIPPED: 'No acknowledgement sent',
}

const DRAFT_PREFIX = 'ada.ticketDraft.'

/** Where a support person's unsent reply is kept while they move around (per person and ticket, this browser). */
export function draftKey(userId: string, ticketId: string): string {
  return `${DRAFT_PREFIX}${userId}.${ticketId}`
}

/** Signing out forgets every unsent reply, so the next person on this browser never sees one. */
export function forgetTicketDrafts() {
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k?.startsWith(DRAFT_PREFIX)) keys.push(k)
    }
    keys.forEach((k) => window.localStorage.removeItem(k))
  } catch {
    /* storage blocked: nothing was kept */
  }
}
