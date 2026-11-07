import { howLong } from './time'
import type { AdminRole, ChecklistItem, ShopGroup, ShopStatus, ShopType, StrikeKind, TimelineEntry } from '../api/types'

export const SHOP_TYPES: ShopType[] = ['KIRANA', 'SALON']
export const TYPE_LABELS: Record<ShopType, string> = { KIRANA: 'Kirana', SALON: 'Salon' }

/** The dashboard's six counts, in the order the field team works them (closed shops last: nothing to do). */
export const GROUPS: ShopGroup[] = ['FIRST_VISIT', 'RECHECK', 'SENT_BACK', 'LIVE', 'SUSPENDED', 'CLOSED']

export const GROUP_LABELS: Record<ShopGroup, string> = {
  FIRST_VISIT: 'Waiting for first visit',
  RECHECK: 'Re-check after edit',
  SENT_BACK: 'Sent back',
  LIVE: 'Live',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed by the owner',
}

/**
 * How long a shop has been in its group, for its card: "Waiting 3 days", "Sent back 2 h ago", "Live for 5 days".
 * `since` is the shop's statusSince: when it entered its current status.
 */
export function sinceText(group: ShopGroup | null, since: string, now: number = Date.now()): string {
  const d = howLong(since, now)
  const fresh = d === 'just now'
  switch (group) {
    case 'FIRST_VISIT':
    case 'RECHECK':
      return fresh ? 'Waiting since just now' : `Waiting ${d}`
    case 'SENT_BACK':
      return fresh ? 'Sent back just now' : `Sent back ${d} ago`
    case 'LIVE':
      return fresh ? 'Live since just now' : `Live for ${d}`
    case 'SUSPENDED':
      return fresh ? 'Suspended just now' : `Suspended for ${d}`
    case 'CLOSED':
      return fresh ? 'Closed just now' : `Closed ${d} ago`
    default:
      return fresh ? 'Since just now' : `For ${d}`
  }
}

export const STATUS_LABELS: Record<ShopStatus, string> = {
  DRAFT: 'Sent back to the owner',
  PENDING_VISIT: 'Waiting for a visit',
  APPROVED: 'Live',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed by the owner',
}

/** The pill colour of each status. */
export const STATUS_TONES: Record<ShopStatus, 'good' | 'warn' | 'bad' | 'muted'> = {
  DRAFT: 'warn',
  PENDING_VISIT: 'warn',
  APPROVED: 'good',
  SUSPENDED: 'bad',
  CLOSED: 'muted',
}

export function isGroup(v: string | null | undefined): v is ShopGroup {
  return GROUPS.includes(v as ShopGroup)
}

export function isShopType(v: string | null | undefined): v is ShopType {
  return SHOP_TYPES.includes(v as ShopType)
}

export const CHECKLIST: ChecklistItem[] = [
  'NAME_BOARD_NOT_VISIBLE',
  'OWNER_PHOTO_UNCLEAR',
  'PIN_WRONG',
  'ADDRESS_MISMATCH',
  'GST_UDYAM_MISMATCH',
  'SHOP_SHUT',
  'OTHER',
]

export const CHECKLIST_LABELS: Record<ChecklistItem, string> = {
  NAME_BOARD_NOT_VISIBLE: "Photo doesn't show the name board",
  OWNER_PHOTO_UNCLEAR: 'Owner photo unclear',
  PIN_WRONG: 'Pin is in the wrong place',
  ADDRESS_MISMATCH: "Address doesn't match",
  GST_UDYAM_MISMATCH: "GSTIN / Udyam doesn't match",
  SHOP_SHUT: 'Business was shut',
  OTHER: 'Other',
}

/** A timeline entry's headline: "Approved by Asha", "Submitted by the owner", "Owner changed it after approval". */
export function eventLabel(e: Pick<TimelineEntry, 'event' | 'byName' | 'byAdmin'>): string {
  const by = e.byName ? ` by ${e.byName}` : ''
  switch (e.event) {
    case 'SUBMITTED':
      return e.byName && !e.byAdmin ? `Submitted by ${e.byName}` : 'Submitted by the owner'
    case 'EDITED':
      return 'Owner changed it after approval'
    case 'APPROVED':
      return `Approved${by}`
    case 'SENT_BACK':
      return `Sent back${by}`
    case 'SUSPENDED':
      return `Suspended${by}`
    case 'REINSTATED':
      return `Reinstated${by}`
    case 'NOTE':
      return `Note${by}`
    case 'CLOSED':
      return e.byName ? `Closed by ${e.byName} (the owner)` : 'Closed by the owner'
    case 'HANDED_OVER':
      return e.byName ? `Handed over to ${e.byName}` : 'Handed over to a new owner'
    default:
      return String(e.event)
  }
}

export const STRIKE_LABELS: Record<StrikeKind, string> = { NO_SHOW: 'No-show', LATE_CANCEL: 'Late cancel' }

export const ROLE_LABELS: Record<AdminRole, string> = { NONE: 'Not on the team', ADMIN: 'Admin', SUPER_ADMIN: 'Super admin' }
