// Response and request shapes, written to match the admin API contract (backend PR "Admin roles, OTP test mode,
// field-visit pages") and the sign-in records shared with the partner app.
// Instants are ISO strings in UTC; phone numbers are 10 digits without +91.

export type AdminRole = 'NONE' | 'ADMIN' | 'SUPER_ADMIN'

export interface User {
  id: string
  phone: string | null
  name: string | null
  email: string | null
  emailVerified: boolean
  /** true for ADMIN and SUPER_ADMIN (kept by the backend for older apps). */
  admin: boolean
  /** Missing on a session saved by an older backend: treated as NONE. */
  adminRole?: AdminRole
}

export interface Tokens {
  accessToken: string
  accessExpiresAt: string
  refreshToken: string
  refreshExpiresAt: string
  user: User
  newUser: boolean
}

export interface ErrorBody {
  code: string
  message: string
  details?: Record<string, unknown>
}

// ---------- me ----------

export interface TestModeFlag {
  on: boolean
  until: string | null
}

/** GET /admin/me */
export interface AdminMe {
  userId: string
  name: string | null
  phone: string | null
  adminRole: AdminRole
  testMode: TestModeFlag
}

// ---------- shops ----------

export type ShopType = 'KIRANA' | 'SALON'
/** CLOSED: its owner closed it for good (no decision applies, 409 WRONG_STATUS). */
export type ShopStatus = 'DRAFT' | 'PENDING_VISIT' | 'APPROVED' | 'SUSPENDED' | 'CLOSED'
export type ShopGroup = 'FIRST_VISIT' | 'RECHECK' | 'SENT_BACK' | 'LIVE' | 'SUSPENDED' | 'CLOSED'

/** GET /admin/dashboard */
export type Dashboard = Record<ShopType, Record<ShopGroup, number>>

export interface AdminShop {
  id: string
  shopCode: number
  name: string
  ownerName: string
  addressLine: string
  area: string
  city: string
  pincode: string
  latitude: number
  longitude: number
  type: ShopType
  status: ShopStatus
  statusReason: string | null
  /** Links valid a few minutes. */
  ownerPhotoUrl: string | null
  shopPhotoUrl: string | null
  version: number
  createdAt: string
  group: ShopGroup | null
  ownerPhone: string | null
  gstin: string | null
  udyamNumber: string | null
  /** When it entered its current status (the waiting time; lists are sorted by it). */
  statusSince: string
}

export type ChangeField =
  | 'name'
  | 'ownerName'
  | 'addressLine'
  | 'area'
  | 'city'
  | 'pincode'
  | 'location'
  | 'gstin'
  | 'udyamNumber'
  | 'ownerPhoto'
  | 'shopPhoto'

export interface Change {
  field: ChangeField
  label: string
  /** null for photos (use the URLs) and for an empty value. */
  before: string | null
  after: string | null
}

export type ChecklistItem =
  | 'NAME_BOARD_NOT_VISIBLE'
  | 'OWNER_PHOTO_UNCLEAR'
  | 'PIN_WRONG'
  | 'ADDRESS_MISMATCH'
  | 'GST_UDYAM_MISMATCH'
  | 'SHOP_SHUT'
  | 'OTHER'

/** CLOSED: the owner closed it (reason: theirs, for the field team). HANDED_OVER: by = the new owner. */
export type TimelineEvent =
  | 'SUBMITTED'
  | 'EDITED'
  | 'APPROVED'
  | 'SENT_BACK'
  | 'SUSPENDED'
  | 'REINSTATED'
  | 'NOTE'
  | 'CLOSED'
  | 'HANDED_OVER'

export interface TimelineEntry {
  at: string
  event: TimelineEvent
  /** null = the owner or the system. */
  byName: string | null
  byAdmin: boolean
  /** What the owner saw. */
  reason: string | null
  /** Admins only. */
  note: string | null
  checklist: ChecklistItem[]
}

/** GET /admin/shops/{id} */
export interface ShopDetail {
  shop: AdminShop
  salon: { barbers: number; services: number } | null
  changes: Change[]
  pinMovedMetres: number | null
  previousOwnerPhotoUrl: string | null
  previousShopPhotoUrl: string | null
  /** Newest first, the first 50 entries. */
  timeline: TimelineEntry[]
  /** Where the next 50 start (GET /admin/shops/{id}/timeline with these); null when there are no more. */
  timelineNext: TimelineNext | null
}

/** A timeline page's end, sent back exactly as received as `afterAt` and `afterSeq`. */
export interface TimelineNext {
  afterAt: string
  /** The order of entries made in the same instant (a database sequence: well inside a safe JavaScript number). */
  afterSeq: number
}

/** GET /admin/shops/{id}/timeline: the entries after a cursor, newest first, 50 a page. */
export interface TimelinePage {
  items: TimelineEntry[]
  next: TimelineNext | null
}

export interface DecisionIn {
  version: number
  reason?: string
  note?: string
  checklist?: ChecklistItem[]
}

// ---------- support ----------

export type StrikeKind = 'NO_SHOW' | 'LATE_CANCEL'

export interface Strike {
  appointmentId: string
  bookingNo: string
  salonName: string
  kind: StrikeKind
  struckAt: string
}

export interface StrikeLookup {
  customerId: string
  blockedUntil: string | null
  strikes: Strike[]
}

// ---------- super admin ----------

export interface TeamMember {
  userId: string
  name: string | null
  phone: string
  adminRole: AdminRole
  /** When they became an admin. */
  since: string
}

export interface TestPhone {
  phone: string
  label: string
  addedAt: string
  hasAccount: boolean
}

export interface TestModeState {
  on: boolean
  until: string | null
  turnedOnByName: string | null
  phones: TestPhone[]
}
