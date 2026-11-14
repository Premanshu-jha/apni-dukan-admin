import { dateOnly, dateTimeIst, howLong, todayInIndia } from './time'
import type { AdminRole, LicenceAiUsage, ChecklistItem, ShopGroup, ShopStatus, ShopType, StrikeKind, TimelineEntry, Designation } from '../api/types'

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
 * How long a shop has been in its group, for its card: "Waiting 3 days", "Sent back 2 h ago", "Last checked 5 days ago".
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
      // statusSince is the last approval: the first one, or the last re-check approved (the shop was live meanwhile)
      return fresh ? 'Checked just now' : `Last checked ${d} ago`
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

/** The checklist offered for a business: a salon has no GSTIN or Udyam number now, so no "doesn't match" for them. */
export function checklistFor(type: ShopType): ChecklistItem[] {
  return type === 'SALON' ? CHECKLIST.filter((c) => c !== 'GST_UDYAM_MISMATCH') : CHECKLIST
}

/** Why a trade licence wasn't accepted (LicenceCheckReason on the backend), for the field team. */
export const LICENCE_REASON_LABELS: Record<string, string> = {
  UNREADABLE: 'too blurred or cut off to read',
  NOT_TRADE_LICENCE: 'not a municipal trade licence',
  LOOKS_EDITED: 'looks edited',
  NO_NUMBER: 'no licence number found',
  NOT_A_SALON_TRADE: 'a licence for another trade',
  NO_VALIDITY: 'no "valid up to" date found',
  EXPIRED: 'expired',
  NAME_MISMATCH: "neither the business nor the owner's name matches the salon",
  ADDRESS_MISMATCH: "the address doesn't match the salon's",
  DUPLICATE: 'another salon already has this licence',
  NOT_READ: 'the AI gave no usable answer three times',
}

/** Where a salon's trade licence check stands, in a sentence for the field team. */
export function licenceCheckText(doc: {
  type: string
  check?: string | null
  reason?: string | null
  licenceNumber?: string | null
  validUntil?: string | null
  since?: string | null
}, today: string = todayInIndia(), now: number = Date.now()): string {
  if (doc.check === 'PASSED') {
    const until = doc.validUntil ? dateOnly(doc.validUntil) : '?'
    return doc.validUntil && doc.validUntil < today
      ? `Passed (${doc.licenceNumber ?? 'no number'}), but expired on ${until}: no "Licensed" badge.`
      : `Passed: ${doc.licenceNumber ?? 'no number'}, valid until ${until}. Customers see "Licensed".`
  }
  if (doc.check === 'FAILED') {
    const why = doc.reason ? (LICENCE_REASON_LABELS[doc.reason] ?? doc.reason) : 'no reason given'
    return `Not accepted: ${why}. No "Licensed" badge; the owner was told why.`
  }
  const since = doc.since ? ` since ${dateTimeIst(doc.since)}` : ''
  // Usually under a minute; past half an hour (as the follow-up list) the AI is likely down or its key isn't set
  const long = doc.since != null && now - Date.parse(doc.since) > 30 * 60_000
  const why = long ? " (a long wait: the AI may be down or its key isn't set)" : ''
  return `Being checked automatically${since}${why}. No "Licensed" badge yet.`
}

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
    case 'FIX_ASKED':
      return `Asked the owner to fix${by}`
    case 'HANDED_OVER':
      return e.byName ? `Handed over to ${e.byName}` : 'Handed over to a new owner'
    default:
      return String(e.event)
  }
}

export const STRIKE_LABELS: Record<StrikeKind, string> = { NO_SHOW: 'No-show', LATE_CANCEL: 'Late cancel' }

export const ROLE_LABELS: Record<AdminRole, string> = { NONE: 'Not on the team', ADMIN: 'Admin', SUPER_ADMIN: 'Super admin' }
export const DESIGNATION_LABELS: Record<Designation, string> = { FIELD_AGENT: 'Field agent', SUPPORT: 'Support' }
export const DESIGNATIONS: Designation[] = ['FIELD_AGENT', 'SUPPORT']

/** Whole cents, rounding half up the way the backend's emails do (1.005 is $1.01, not the float's $1.00). */
function cents(amount: number): number {
  return Math.round(Number((amount * 100).toFixed(6)))
}

/** "$12.34": a dollar amount, to the cent. */
export function usd(amount: number): string {
  return `$${(cents(amount) / 100).toFixed(2)}`
}

/**
 * The dashboard's line about the licence checks' AI: how many it read this credit period and what that cost of the
 * budget ("4 Nov 2026 to 3 Dec 2026: 120 licences read, $1.20 of $100.00 (1%)"). The percent is of the cents shown,
 * rounded down, so it never says 100% before the amount does.
 */
export function licenceAiText(u: LicenceAiUsage): string {
  const budget = cents(u.budgetUsd)
  const percent = budget > 0 ? Math.floor((cents(u.spentUsd) * 100) / budget) : 0
  const read = u.reads === 1 ? '1 licence read' : `${u.reads} licences read`
  return `${dateOnly(u.periodStart)} to ${dateOnly(u.periodEnd)}: ${read}, ${usd(u.spentUsd)} of ${usd(u.budgetUsd)} (${percent}%)`
}

/** Where to fix each problem: the Console's Billing or API keys page. */
export const CONSOLE_BILLING = 'https://platform.claude.com/settings/billing'
export const CONSOLE_KEYS = 'https://platform.claude.com/settings/keys'

/**
 * Why the licence checks stopped and what to do, or null while they work: the AI refusing our account, or no key
 * at all. The link (Console's page to fix it) is shown after the text, when there is one.
 */
export function licenceAiProblem(u: LicenceAiUsage): { text: string; link: { href: string; label: string } | null } | null {
  if (!u.keySet) {
    return {
      text: 'Licence checks are off: ANTHROPIC_API_KEY isn\'t set on the backend (Railway, apni-dukan-backend, Variables). Every licence waits as "Checking…".',
      link: { href: CONSOLE_KEYS, label: 'Create a key in the Claude Console' },
    }
  }
  if (!u.problem) return null
  const since = u.problemSince ? ` since ${dateTimeIst(u.problemSince)}` : ''
  const waiting = ' Salons see "Checking…"; nothing is refused, and every waiting licence is read once it works again.'
  switch (u.problem) {
    case 'CREDIT':
      return {
        text: `Licence checks are stopped${since}: Anthropic refuses for the API credit. Add credits (or turn on auto-reload), or they start again when next month's credit arrives.${waiting}`,
        link: { href: CONSOLE_BILLING, label: 'Open Billing in the Claude Console' },
      }
    case 'KEY':
      return {
        text: `Licence checks are stopped${since}: Anthropic refuses our API key. Create a key and paste it in Railway (apni-dukan-backend, Variables, ANTHROPIC_API_KEY), then Deploy.${waiting}`,
        link: { href: CONSOLE_KEYS, label: 'Open API keys in the Claude Console' },
      }
    case 'MODEL':
      return {
        text: `Licence checks are stopped${since}: Anthropic doesn't know the AI model asked for. In Railway (apni-dukan-backend, Variables), remove LICENCE_AI_MODEL or set a current model, then Deploy. The key works.${waiting}`,
        link: null,
      }
  }
}

/** Shown when no super admin has a verified email: the alerts reach nobody. */
export const NO_ALERT_RECIPIENTS =
  'No super admin has a verified email, so nobody gets the emails about the licence checks (credit running low or used up, checks stopped). Add and verify an email in your profile.'
