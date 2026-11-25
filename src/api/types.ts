// Response and request shapes, written to match the admin API contract (backend PR "Admin roles, OTP test mode,
// field-visit pages") and the sign-in records shared with the partner app.
// Instants are ISO strings in UTC; phone numbers are 10 digits without +91.

export type AdminRole = 'NONE' | 'ADMIN' | 'SUPER_ADMIN'
/**
 * An ADMIN's job title (a SUPER_ADMIN has none). FIELD_AGENT: visits only the businesses assigned to them. SUPPORT:
 * answers only the support tickets given to them (no businesses, no pincodes).
 */
export type Designation = 'FIELD_AGENT' | 'SUPPORT'

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
  /**
   * An admin whose sign-in on this device still has to pass the email step (a code to their verified email) before
   * the admin pages open; asked again 12 hours after it was passed. Missing from an older backend: not needed.
   */
  adminCodeNeeded?: boolean
}

/** After the email step: a new access token that opens the admin pages (the refresh token stays the same). */
export interface AdminAccess {
  accessToken: string
  accessExpiresAt: string
  user: User
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
  /** An ADMIN's designation; null for a super admin. Missing from a backend older than field agents. */
  designation?: Designation | null
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
  /** The team's words to the owner (a send back, fix asked for or suspension); null when none (also with ticks only). */
  statusReason: string | null
  /** The reasons ticked with a send back or fix asked for (the owner reads each in their language); empty when none. */
  statusReasonCodes: ReviewReason[]
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
  /** The field agent who visits it; null when unassigned (missing from a backend older than field agents). */
  assignedTo?: Assignee | null
  /**
   * Waiting for the field team: its first visit, a reinstated one's, or a live shop's re-check (status APPROVED: it
   * stays live while its changes are checked). Approve, Send back and Assign are for these. Missing from an older
   * backend: there, only PENDING_VISIT waits.
   */
  waitingForVisit?: boolean
  /** The owner asked for a new address and it waits for the field team (Approve applies it). */
  addressRequested?: boolean
  /** The language the owner reads (saved in the app); null if not chosen (missing from an older backend). */
  ownerLanguage?: Language | null
}

/** A new address and pin, as the owner asks for it or the field team sets it. */
export interface AddressIn {
  addressLine: string
  area: string
  city: string
  pincode: string
  latitude: number
  longitude: number
}

/** The owner's address change request waiting for the field team (GET /admin/shops/{id} `addressRequest`). */
export interface AddressRequest extends AddressIn {
  id: string
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED'
  reason: string | null
  createdAt: string
  decidedAt: string | null
  /** The language the person who asked reads; null if not chosen (missing from an older backend). */
  requesterLanguage?: Language | null
}

export interface Assignee {
  id: string
  /** Null if they haven't set a name yet. */
  name: string | null
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
  | 'shopVideo'
  | 'registrationDoc'

export interface Change {
  field: ChangeField
  label: string
  /** null for photos (use the URLs) and for an empty value. */
  before: string | null
  after: string | null
}

/** The app languages a person can choose (users.language). */
export type Language = 'en' | 'hi' | 'te' | 'mr' | 'ta' | 'kn'

/**
 * Why the team sends a business back, asks for a fix or declines an address (ReviewReason on the backend). The owner
 * sees each one in their language; OTHER needs a note.
 */
export type ReviewReason =
  | 'SHOP_FRONT_PHOTO'
  | 'BOARD_NOT_VISIBLE'
  | 'INSIDE_PHOTOS'
  | 'LICENCE_UNREADABLE'
  | 'LICENCE_NAME_MISMATCH'
  | 'LICENCE_EXPIRED'
  | 'LICENCE_WRONG_TYPE'
  | 'ADDRESS_WRONG'
  | 'PIN_WRONG_PLACE'
  | 'SERVICES_MISSING'
  | 'HOURS_MISSING'
  | 'VIDEO_UNCLEAR'
  | 'OWNER_NAME'
  | 'OTHER'

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
  | 'FIX_ASKED'

export interface TimelineEntry {
  at: string
  event: TimelineEvent
  /** null = the owner or the system. */
  byName: string | null
  byAdmin: boolean
  /** What the owner saw in the team's words (the note under the ticked reasons); null when none. */
  reason: string | null
  /** The reasons ticked (a send back, fix asked for or address declined); empty when none. */
  reasonCodes: ReviewReason[]
  /** Admins only. */
  note: string | null
  checklist: ChecklistItem[]
}

/** A salon's service as the field team checks it (prices in paise). */
export interface SalonServiceFact {
  name: string
  durationMinutes: number
  pricePaise: number
  priceIsFrom: boolean
  /** Days after a visit the customer is reminded to come back; 0: never. */
  returnAfterDays: number
}

/** An open day: weekday 1 = Monday … 7 = Sunday, "HH:mm" ("24:00" = midnight). */
export interface OpenDay {
  weekday: number
  open: string
  close: string
}

/** A salon's size and setup. Older backends send only the two counts. */
export interface SalonFacts {
  barbers: number
  services: number
  serviceList?: SalonServiceFact[]
  /** Open days, Monday first; a weekday left out is closed. Empty until set. */
  hours?: OpenDay[]
  ratings?: number
  /** To one decimal; null with no ratings. */
  ratingAverage?: number | null
}

/** TRADE_LICENCE; a SHOPS_ESTABLISHMENT or UDYAM one was added before only a trade licence counted (it doesn't now). */
export type RegistrationDocType = 'SHOPS_ESTABLISHMENT' | 'TRADE_LICENCE' | 'UDYAM'

/** The automatic check of a salon's trade licence. */
export type LicenceCheck = 'PENDING' | 'PASSED' | 'FAILED'

/** GET /admin/shops/licence-ai-usage (super admins): the licence-reading AI this credit period. */
export interface LicenceAiUsage {
  periodStart: string
  periodEnd: string
  /** Licences read this period (each an answer Anthropic billed). */
  reads: number
  /** What they cost, counted by the backend from each answer's tokens (Console's Billing page is official). */
  spentUsd: number
  budgetUsd: number
  /** Anthropic refusing our account now: credit, the key, or the model's name; null while it answers. */
  problem: 'CREDIT' | 'KEY' | 'MODEL' | null
  problemSince: string | null
  /** False without ANTHROPIC_API_KEY: nothing is read, every licence waits as "Checking". */
  keySet: boolean
  /** Super admins with a verified email: who the alert emails reach (0: nobody). */
  alertRecipients: number
}

/** What the AI read from the licence (null where not on it). */
export interface LicenceRead {
  readable: boolean
  tradeLicence: boolean
  looksEdited: boolean
  provisional: boolean
  salonTrade: boolean
  issuingBody: string | null
  licenceNumber: string | null
  tradeName: string | null
  ownerName: string | null
  address: string | null
  pincode: string | null
  tradeCategory: string | null
  validUntil: string | null
}

/** A salon's trade licence and its automatic check: for the field team only. */
export interface RegistrationDoc {
  type: RegistrationDocType
  /** e.g. "Trade licence" */
  label: string
  /** A signed link to the photo or PDF (valid at least 15 more minutes); null if the file is gone. */
  url: string | null
  /** When it passed the automatic check; null: not (yet). */
  checkedAt?: string | null
  /** PENDING (being checked, or no AI key set yet), PASSED, FAILED; missing from an older backend. */
  check?: LicenceCheck | null
  /** Why it FAILED (e.g. NAME_MISMATCH); null otherwise. */
  reason?: string | null
  /** The number it passed with; null otherwise. */
  licenceNumber?: string | null
  /** Its last valid day (YYYY-MM-DD) once PASSED: customers see "Licensed" until then. */
  validUntil?: string | null
  /** What the AI read from it; null if not read. */
  read?: LicenceRead | null
  /** When this check started (a PENDING one has waited since then). */
  since?: string | null
}

/** GET /admin/shops/{id} */
export interface ShopDetail {
  shop: AdminShop
  salon: SalonFacts | null
  /** A salon's trade licence; null if none (kiranas, salons without one). */
  registrationDoc?: RegistrationDoc | null
  changes: Change[]
  pinMovedMetres: number | null
  previousOwnerPhotoUrl: string | null
  previousShopPhotoUrl: string | null
  /** The salon video the owner recorded at registration (a signed link, valid at least 15 more minutes); null if none. */
  videoUrl?: string | null
  /** The owner's address change request waiting for the field team; null if none (missing from an older backend). */
  addressRequest?: AddressRequest | null
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
  /** What the owner is told: needed for Suspend; for Send back and Ask to fix, an optional note beside reasonCodes. */
  reason?: string
  /** Internal note: admins only. */
  note?: string
  checklist?: ChecklistItem[]
  /** Send back and Ask to fix: at least one. */
  reasonCodes?: ReviewReason[]
}

/** POST /admin/shops/{id}/address-request/decline */
export interface AddressDeclineIn {
  version: number
  /** At least one. */
  reasonCodes: ReviewReason[]
  /** An optional note for the owner (needed with OTHER). */
  reason?: string
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
  email: string | null
  /** False until they confirm it at their next sign-in (an email typed on the Team page). */
  emailVerified: boolean
  adminRole: AdminRole
  /** An ADMIN's designation; null for a super admin. */
  designation: Designation | null
  /** The pincodes a field agent covers, in order; empty for a super admin. */
  pincodes: string[]
  /** Businesses waiting for their visit. */
  pendingVisits: number
  /** Support tickets given to them and not resolved yet (missing from an older backend: 0). */
  openTickets: number
  /** When they became an admin. */
  since: string
  /** Send it back with an edit (409 MEMBER_CHANGED if someone changed them since). */
  version: number
}

/** POST /admin/team, and PUT /admin/team/{id} with `version`. */
export interface MemberIn {
  phone: string
  email: string
  name: string
  role: 'ADMIN' | 'SUPER_ADMIN'
  /** Required for ADMIN; ignored for SUPER_ADMIN. */
  designation: Designation | null
  /** At least one for ADMIN; ignored for SUPER_ADMIN. */
  pincodes: string[]
}

/** GET /admin/team/coverage: each covered pincode with the agents covering it. */
export interface Covered {
  pincode: string
  agents: Array<{ userId: string; name: string | null; phone: string | null }>
}

/** POST /admin/assignments/move */
export interface Moved {
  moved: number
  /** Businesses the new agent works in, left with the old one. */
  stayed: number
}

export interface TestPhone {
  phone: string
  label: string
  addedAt: string
  hasAccount: boolean
}

export interface TestEmail {
  email: string
  label: string
  addedAt: string
  /** Whether an account has verified it yet. */
  inUse: boolean
}

export interface TestModeState {
  on: boolean
  until: string | null
  turnedOnByName: string | null
  phones: TestPhone[]
  /** Missing from a backend older than the test email list. */
  emails?: TestEmail[]
}

// ---------- support tickets ----------

/** OPEN: waiting on us. WAITING: we replied, waiting on them. RESOLVED: answered (their reply opens it again). */
export type TicketStatus = 'OPEN' | 'WAITING' | 'RESOLVED'
export type TicketSource = 'EMAIL' | 'CUSTOMER' | 'PARTNER'
/** The lists: ACTIVE = open or waiting; UNASSIGNED is for super admins. */
export type TicketView = 'ACTIVE' | 'OPEN' | 'WAITING' | 'RESOLVED' | 'UNASSIGNED'

/** GET /admin/tickets: one row. */
export interface TicketSummary {
  id: string
  /** CLZ-1042 */
  number: string
  subject: string
  status: TicketStatus
  source: TicketSource
  /** The account's name, an unknown sender's name or address, or "Deleted account". */
  requester: string
  /** null = Unassigned */
  assigneeId: string | null
  assigneeName: string | null
  createdAt: string
  lastMessageAt: string
}

export interface TicketMessage {
  seq: number
  /** IN: from the person. OUT: our reply. */
  direction: 'IN' | 'OUT'
  author: string
  body: string
  /** Files they attached: kept only in the support Gmail inbox. */
  attachments: number
  /** False for an email whose sender we couldn't prove (it may not be from them). */
  senderVerified: boolean
  at: string
  /** Photos, videos and PDFs sent with it in the apps or with a reply. Missing from a backend before round 4a. */
  files?: MessageFile[]
}

/** A file on a ticket message (a photo, video or PDF shown; any other kind only downloaded). */
export interface MessageFile {
  id: string
  contentType: string
  sizeBytes: number
  name: string | null
  /** Opens it for at least 15 minutes (a file of a kind we don't show: downloads it); null once removed */
  url: string | null
  /** Saves it under its name; null once removed */
  downloadUrl?: string | null
  /** Deleted (6 months after the ticket was resolved, or the person deleted their account) */
  removed: boolean
}

export interface TicketEvent {
  event: string
  /** null = the system */
  actor: string | null
  detail: string | null
  at: string
}

/** One module's facts about the person (Account, Business, Latest bookings). */
export interface ProfileSection {
  order: number
  title: string
  lines: string[]
}

/** GET /admin/tickets/{id} */
export interface TicketDetail {
  ticket: TicketSummary
  requesterId: string | null
  /** The language the person reads (their saved app language); null if not chosen or no account. */
  requesterLanguage?: Language | null
  /** Where replies go; null once they deleted their account. */
  requesterEmail: string | null
  messages: TicketMessage[]
  events: TicketEvent[]
  /** Empty for an email from an unknown address. */
  profile: ProfileSection[]
  earlierTickets: number
  emailsWaiting: number
  emailsFailed: number
  /** Send it back with a reply (409 NEW_MESSAGE if they wrote after it). */
  lastIncomingSeq: number
  /** Send it back with a reassignment (409 TICKET_CHANGED). */
  version: number
  /** False when the first email's sender couldn't be proven: confirm who it is before acting on it. */
  senderVerified: boolean
}

/** GET /admin/tickets/counts: for the menu badge. */
/** GET /admin/tickets/away: a support person who is away (leave, sick), and since when. */
export interface AwayEntry {
  userId: string
  since: string
}

/** PUT /admin/tickets/away/{userId}: their open tickets given to others (marked away), and what stayed. */
export interface AwayChange {
  away: boolean
  moved: number
  stayed: number
}

export interface TicketCounts {
  mineOpen: number
  unassigned: number
}

/** GET /admin/tickets/stats (super admins) */
export interface TicketStats {
  people: Array<{ userId: string; name: string; support: boolean; open: number; waiting: number; resolved: number }>
  unassigned: number
}

/**
 * A salon's subscription (GET /admin/shops/{id}/subscription, SubscriptionService.View): ₹500 a month after a 30-day
 * free trial from its first approval.
 */
export interface SalonSubscription {
  /** NONE (not approved yet), AUTOPAY, TRIAL, PAID (paid up, AutoPay off), GRACE (ended, 3 days to pay), HIDDEN */
  state: 'NONE' | 'AUTOPAY' | 'TRIAL' | 'PAID' | 'GRACE' | 'HIDDEN'
  trialEndsAt: string | null
  paidUntil: string | null
  accessUntil: string | null
  hiddenFrom: string | null
  razorpayStatus: string | null
  pricePerMonth: number
  /** Whether lapsed salons are really hidden (SUBSCRIPTIONS_ENFORCED) */
  enforced: boolean
  paymentsReady: boolean
  testMode: boolean
  /** The last AutoPay charge failed or is overdue */
  autoPayFailed?: boolean
  /** Its owner is an OTP test account: a super admin may end its trial (Razorpay's review) */
  testSalon?: boolean
}


/** The two Play Store apps (App releases page). */
export type AppName = 'partner' | 'customer'

/** Per app: who must update, and which app version Google has approved (AdminAppReleasesController.SettingsView). */
export interface AppUpdateSettings {
  /** Older app versions see "Please update to continue"; null: none have to */
  minVersionCode: number | null
  /** The newest version live on the Play Store; newer ones (in Google's review) get no screen updates */
  storeVersionCode: number | null
  /** Send back when saving (409 SETTINGS_CHANGED if another super admin saved meanwhile) */
  version: number
  changedAt: string | null
  changedByName: string | null
}

export type AppReleaseStatus = 'UPLOADING' | 'LIVE' | 'PULLED'

/** One screen release sent by CI after a merge (AdminAppReleasesController.ReleaseView). */
export interface AppRelease {
  /** The CI run's number: the same as the versionCode of that run's APK */
  build: number
  nativeLevel: number
  versionName: string
  commitSha: string
  sizeBytes: number
  status: AppReleaseStatus
  createdAt: string
  publishedAt: string | null
  changedAt: string | null
  changedByName: string | null
  /** Open phones show "A fix for the app is ready" with Restart once they have it */
  urgent: boolean
  /** What it fixes (only when urgent) */
  urgentNote: string | null
  urgentAt: string | null
  /** The super admin who marked it; null when CI did (a PR titled "[urgent] …") */
  urgentByName: string | null
}

export interface AppReleasePage {
  settings: AppUpdateSettings
  releases: AppRelease[]
  more: boolean
}

// ---- Analytics (super admins only) -----------------------------------------------------------------------------

export type PaymentSource = 'WEBSITE' | 'APP_RAZORPAY' | 'GOOGLE_PLAY'

/** One month's money (for one source, or all: source null), in paise. Google's fee is an estimate. */
export interface Money {
  source: PaymentSource | null
  payments: number
  salons: number
  grossPaise: number
  refundsPaise: number
  refundCount: number
  razorpayFeePaise: number
  googleFeeEstimatePaise: number
  netPaise: number
}

export interface MoneyMonth {
  /** yyyy-MM, India's month */
  month: string
  total: Money
  bySource: Money[]
}

export interface FeeSettings {
  /** basis points: 1500 = 15% */
  playFeeBps: number
  userChoiceFeeBps: number
  version: number
  changedAt: string | null
  changedByName: string | null
}

export interface MoneyView {
  months: MoneyMonth[]
  recurring: { salons: number; monthlyPaise: number; bySource: { source: PaymentSource; salons: number; monthlyPaise: number }[] }
  fees: FeeSettings
}

export interface AnalyticsSalonLine {
  shopId: string
  name: string
  area: string | null
  pincode: string | null
  /** when its free or paid time ends */
  ends: string
  state: 'TRIAL' | 'PAYING' | 'GRACE' | 'LAPSED'
  source: PaymentSource
}

export interface SubscriptionsView {
  trial: number
  trialWithAutoPay: number
  paying: number
  payingBySource: { source: PaymentSource; salons: number; renewing: number }[]
  grace: number
  lapsed: number
  paymentProblems: number
  months: { month: string; firstPayments: number; stopped: number }[]
  trialsEnding: AnalyticsSalonLine[]
  problems: AnalyticsSalonLine[]
}

/** A daily total: day (yyyy-MM-dd), what it is split by (a role, a pincode, an hour, "CUSTOMER:APP"…), the count. */
export interface Point {
  day: string
  dim: string
  value: number
}

export interface PeopleView {
  from: string
  to: string
  accounts: Point[]
  salons: Point[]
  salonsEverApproved: number
  signups: Point[]
  salonsRegistered: Point[]
  salonsApproved: Point[]
  approvalHoursMedian: number | null
  activeDay: Point[]
  activeToday: Point[]
  activeWeek: Point[]
  activeMonth: Point[]
}

export interface BookingsView {
  from: string
  to: string
  pincode: string | null
  created: Point[]
  visits: Point[]
  visitsByStatus: Point[]
  busiestHours: Point[]
  topAreas: Point[]
}

export interface SalonUse {
  shopId: string
  name: string
  area: string | null
  pincode: string | null
  status: string
  lastActiveDay: string | null
  bookings30d: number
  completed30d: number
  walkIns30d: number
  noShows30d: number
  services: number
  staff: number
  pictures: number
}

export interface SalonsView {
  salons: SalonUse[]
  more: boolean
  quietSalons: number
}

export interface VersionsView {
  today: string
  days: { day: string; app: AppName; versionCode: number; store: boolean; phones: number }[]
}
