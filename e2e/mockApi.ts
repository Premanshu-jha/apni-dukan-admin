import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BrowserContext, Route } from '@playwright/test'

/**
 * A fake backend for the end-to-end tests, answering exactly as the admin API contract says (paths, fields, status
 * codes and error codes; errors are {code, message, details}). Sign-in follows the partner app's fake. State lives
 * per test. Where the contract leaves something open, the choice is written next to it and listed in the README.
 */
export const API = 'http://api.test'
/** Photo links point at their own server, like the real signed links (the CSP allows images from PHOTO_ORIGIN only). */
export const PHOTOS = 'https://photos.test'
const P = '/api/v1'

export type AdminRole = 'NONE' | 'ADMIN' | 'SUPER_ADMIN'
export type Status = 'DRAFT' | 'PENDING_VISIT' | 'APPROVED' | 'SUSPENDED' | 'CLOSED'
type Json = Record<string, unknown>
/** An answer refusing a request, before it is sent. */
type Refusal = { status: number; code: string; message: string; details: Json }

export interface MockUser {
  id: string
  phone: string
  name: string | null
  email: string | null
  emailVerified: boolean
  admin: boolean
  adminRole: AdminRole
  /** An ADMIN's designation (FIELD_AGENT when missing). */
  designation?: 'FIELD_AGENT' | 'SUPPORT'
}

/** A support ticket as the fake keeps it: the TicketDetail fields, plus who it's with. */
export interface MockTicket {
  id: string
  number: string
  subject: string
  status: 'OPEN' | 'WAITING' | 'RESOLVED'
  source: 'EMAIL' | 'CUSTOMER' | 'PARTNER'
  requester: string
  requesterId: string | null
  requesterEmail: string | null
  assigneeId: string | null
  createdAt: string
  lastMessageAt: string
  messages: Json[]
  events: Json[]
  profile: Json[]
  emailsWaiting: number
  emailsFailed: number
  version: number
  /** False: the first email's sender couldn't be proven. */
  senderVerified?: boolean
}

export interface Call {
  method: string
  path: string
  body: unknown
  auth: string | null
  /** When it arrived (ms), to check the waits between retries. */
  at: number
}

/** The parts of a shop's page that are not the AdminShop itself. */
export interface ShopExtra {
  approvedBefore: boolean
  /** A live shop waiting for its re-check (the backend's recheck_since): it stays APPROVED meanwhile. */
  rechecking: boolean
  statusSince: string
  /** SalonFacts (the field team's facts about a salon); null for a kirana. */
  salon: Json | null
  /** The salon's registration document, or null. */
  registrationDoc: Json | null
  changes: Json[]
  pinMovedMetres: number | null
  previousOwnerPhotoUrl: string | null
  previousShopPhotoUrl: string | null
  /** The salon video's signed link (salons), or null. */
  videoUrl: string | null
  timeline: Json[]
  /** The owner's address change request waiting for the field team (AddressRequestStore), or null. */
  addressRequest?: Json | null
}

/** A real 20-second video (64×64, VP9 in MP4). */
const VIDEO = readFileSync(resolve('e2e/fixtures/salon-20s.mp4'))
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

/**
 * The backend's text rule, as TextCleaner does it, in its order: NFKC; refuse hidden characters (control codes but
 * tab, newline and carriage return; format; private use; unassigned; lone surrogates; line and paragraph
 * separators); collapse every kind of space and trim; at least 2 letters or decimal digits; length in code points.
 */
export function textProblem(value: unknown, min: number, max: number): string | null {
  const normal = (typeof value === 'string' ? value : '').normalize('NFKC')
  for (const ch of normal) {
    if (ch !== '\t' && ch !== '\n' && ch !== '\r' && /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\u2028\u2029]/u.test(ch)) {
      return 'contains invisible or special characters'
    }
  }
  const t = cleanText(normal)
  if ((t.match(/\p{L}|\p{Nd}/gu) ?? []).length < 2) return 'must have at least 2 letters or digits'
  const length = [...t].length
  if (length < min || length > max) return `must be ${min} to ${max} characters`
  return null
}

/** As TextCleaner saves it: NFKC, every run of spaces as one, trimmed. */
export function cleanText(value: string): string {
  return value.normalize('NFKC').replace(/[\s\p{Z}]+/gu, ' ').trim()
}

const PHONE = /^[6-9]\d{9}$/
/** Emails.normalize's rule (after trimming and lower-casing). */
const EMAIL = /^[a-z0-9._%+-]{1,64}@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Shops a list page returns (ShopReviewStore.PAGE). */
const SHOPS_PAGE = 50
/** Timeline entries per page (ShopReviewStore.TIMELINE_PAGE): the shop page's first, then .../timeline. */
const TIMELINE_PAGE = 50

/**
 * An instant's microseconds since 1970, from the backend's text ("…T04:30:00.123456Z"): the backend orders and
 * pages by the microsecond, so the fake does too (a JavaScript Date keeps only milliseconds).
 */
export function micros(instant: string): number {
  const fraction = (instant.match(/\.(\d+)Z$/)?.[1] ?? '').padEnd(6, '0').slice(0, 6)
  return Math.floor(Date.parse(instant) / 1000) * 1_000_000 + Number(fraction)
}

/** What Spring can read as an Instant query value (ISO-8601, in UTC). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?Z$/

/** An ETag as Spring's ShallowEtagHeaderFilter makes it: "0" and the MD5 of the body, in quotes. */
export function etagOf(body: string): string {
  return `"0${createHash('md5').update(body).digest('hex')}"`
}

/** If-None-Match holds this ETag (a list, weak or strong, or *), as the filter compares them. */
function matches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false
  return ifNoneMatch.split(',').some((t) => t.trim() === '*' || t.trim().replace(/^W\//, '') === etag)
}

export class MockApi {
  /** How many times a salon video link was signed (each read of a business page signs it again). */
  videoSigs = 0
  user: MockUser = MockApi.completeUser('ADMIN')
  calls: Call[] = []
  shops: Json[] = []
  extra = new Map<string, ShopExtra>()
  /** Shops (ids) the signed-in admin works in (owner, helper or barber): decisions and notes answer 403 OWN_SHOP. */
  memberOf = new Set<string>()
  /** The team as GET /admin/team gives it (pendingVisits is counted from the shops when answering). */
  team: Json[] = [
    MockApi.teamMember({ userId: 'u0', name: 'Meera Super', phone: '9000000001', adminRole: 'SUPER_ADMIN', since: '2026-10-01T05:00:00Z' }),
    MockApi.teamMember({ userId: 'u5', name: 'Ravi Field', phone: '9000000005', pincodes: ['201309'], since: '2026-10-03T05:00:00Z' }),
  ]
  /** Accounts by phone that aren't on the team (a customer, say): 409 PHONE_IN_USE when a member's phone moves there. */
  otherPhones = new Set<string>(['9811122233'])
  /** Verified emails of accounts not on the team: 409 EMAIL_IN_USE. */
  otherEmails = new Set<string>(['owner@gmail.com'])
  testMode: { on: boolean; until: string | null; turnedOnByName: string | null } = { on: false, until: null, turnedOnByName: null }
  testPhones: Json[] = []
  testEmails: Json[] = []
  /** Answer test-mode state without `emails`, like a backend from before the list. */
  testEmailsMissing = false
  /** Emails verified by real accounts or admins: 409 REAL_ACCOUNT_EMAIL as a test email. */
  realEmails = new Set<string>(['owner@gmail.com'])
  customers = new Map<string, { customerId: string; blockedUntil: string | null; strikes: Json[] }>()
  /** Every request fails as with no network. */
  offline = false
  /** Answer requests whose path ends with this after a wait (ms), to see loading states. */
  slow = new Map<string, number>()
  /** The next call to a path (by suffix) is carried out, but its answer is lost on the way back (a weak network). */
  loseAnswer = new Set<string>()
  /** Numbers that already have a real account (a customer or a shop): they can't become test numbers. */
  realAccounts = new Set<string>(['9811122233'])
  /** Accounts made in test mode: they can't become admins. */
  testAccounts = new Set<string>()
  /**
   * This person signed in as a test account: once test mode no longer covers their number (switched off, ended, or
   * the number removed), their refresh answers 401 TEST_MODE_OFF.
   */
  signedInAsTestAccount = false
  /** How many next-page requests of a shop list fail with 500 (the pages already shown must stay). */
  failShopPages = 0
  /** How many earlier-timeline requests fail with 500 (the entries already shown must stay). */
  failTimelinePages = 0
  /** Paths (by suffix) answered 503 SERVICE_BUSY with Retry-After this many times. */
  busy = new Map<string, { times: number; retryAfter: number }>()
  /**
   * Each timeline entry's seq (shop_events.seq: the order entries were made, for ties in `at`). Kept beside the
   * entries, not in them: the backend's TimelineEntry has no seq, only the page cursors do.
   */
  private seqOf = new WeakMap<Json, number>()
  private lastSeq = 0
  /** Paths (with the query) answered 304 Not Modified, in order. */
  notModified: string[] = []
  /** Next answer of a path (by suffix): a code + status, once. */
  failOnce = new Map<string, { status: number; code: string; message: string; details?: Json }>()
  private n = 0
  /** Access token → the adminRole it was issued with (as the real token's claim). */
  private access = new Map<string, AdminRole>()
  refreshTokens = new Map<string, 'live' | 'rotated'>()

  /** A team member as the backend answers it; an ADMIN is a field agent. */
  static teamMember(over: Json): Json {
    const admin = (over.adminRole ?? 'ADMIN') === 'ADMIN'
    return {
      email: `${over.userId as string}@example.com`,
      emailVerified: true,
      adminRole: 'ADMIN',
      designation: admin ? 'FIELD_AGENT' : null,
      pincodes: [],
      version: 0,
      ...over,
    }
  }

  static completeUser(adminRole: AdminRole = 'ADMIN'): MockUser {
    return {
      id: 'u1',
      phone: '9848012345',
      name: 'Asha Field',
      email: 'asha@example.com',
      emailVerified: true,
      admin: adminRole !== 'NONE',
      adminRole,
    }
  }

  /** Makes this person's role on the backend change now (their token keeps the old one until refreshed). */
  setRole(role: AdminRole) {
    this.user = { ...this.user, adminRole: role, admin: role !== 'NONE' }
    // The signed-in person comes first in the default team when a super admin (the default one steps aside)
    this.team = this.team.filter((m) => m.userId !== this.user.id && !(role === 'SUPER_ADMIN' && m.userId === 'u0'))
    if (role !== 'NONE') this.team.unshift(this.member())
  }

  private member(): Json {
    return MockApi.teamMember({
      userId: this.user.id,
      name: this.user.name,
      phone: this.user.phone,
      email: this.user.email,
      adminRole: this.user.adminRole,
      pincodes: this.user.adminRole === 'ADMIN' ? ['201309'] : [],
      since: '2026-10-02T05:00:00Z',
    })
  }

  /** The signed-in person is a field agent who may see this shop (or a super admin, who sees all). */
  private sees(shop: Json): boolean {
    return this.user.adminRole === 'SUPER_ADMIN' || (shop.assignedTo as Json | null)?.id === this.user.id
  }

  /** Waiting businesses assigned to each member, as pendingVisits. */
  private withPending(m: Json): Json {
    const pendingVisits = this.shops.filter((s) => this.waits(s) && (s.assignedTo as Json | null)?.id === m.userId).length
    return { ...m, pendingVisits }
  }

  /** Adds a shop; `over` sets AdminShop fields, `extra` the page's other parts. */
  addShop(over: Json = {}, extra: Partial<ShopExtra> = {}): Json {
    const i = ++this.n
    const shop: Json = {
      id: `shop${i}`,
      shopCode: 10230 + i,
      name: `Shop ${i}`,
      ownerName: 'Ravi Kumar',
      addressLine: 'Shop 12, Ithum Tower',
      area: 'Sector 62',
      city: 'Noida',
      pincode: '201309',
      latitude: 28.627,
      longitude: 77.372,
      type: 'KIRANA',
      status: 'PENDING_VISIT',
      statusReason: null,
      ownerPhotoUrl: `${PHOTOS}/owner-${i}.png`,
      shopPhotoUrl: `${PHOTOS}/shop-${i}.png`,
      version: 3,
      createdAt: '2026-11-01T04:30:00Z',
      ownerPhone: '9811122233',
      gstin: null,
      udyamNumber: null,
      assignedTo: { id: 'u5', name: 'Ravi Field' },
      ...over,
    }
    this.shops.push(shop)
    this.extra.set(shop.id as string, {
      approvedBefore: false,
      rechecking: false,
      statusSince: ago(3 * 24 * 60),
      salon: shop.type === 'SALON' ? {
        barbers: 2,
        services: 5,
        serviceList: [
          { name: 'Haircut', durationMinutes: 30, pricePaise: 15000, priceIsFrom: false, returnAfterDays: 21 },
          { name: 'Hair colour', durationMinutes: 60, pricePaise: 80000, priceIsFrom: true, returnAfterDays: 30 },
        ],
        hours: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: '10:00', close: '21:00' })),
        ratings: 7,
        ratingAverage: 4.4,
      } : null,
      registrationDoc: shop.type === 'SALON'
        ? { type: 'TRADE_LICENCE', label: 'Trade licence', url: `${PHOTOS}/doc-${shop.id as string}.pdf`, checkedAt: shop.status === 'APPROVED' ? ago(60 * 24) : null }
        : null,
      changes: [],
      pinMovedMetres: null,
      previousOwnerPhotoUrl: null,
      previousShopPhotoUrl: null,
      videoUrl: shop.type === 'SALON' ? `${PHOTOS}/salon-${shop.id as string}.mp4` : null,
      timeline: [{ at: ago(3 * 24 * 60), event: 'SUBMITTED', byName: 'Ravi Kumar', byAdmin: false, reason: null, note: null, checklist: [] }],
      ...extra,
    })
    return shop
  }

  /** The owner edits the shop on their phone: a new version (and whatever fields change). */
  ownerEdits(id: string, over: Json = {}) {
    const shop = this.shops.find((s) => s.id === id)!
    Object.assign(shop, over, { version: (shop.version as number) + 1 })
  }

  /** The contract's groups. DRAFT without a reason (registration not finished) is in none. */
  groupOf(shop: Json): string | null {
    const x = this.extra.get(shop.id as string)!
    switch (shop.status) {
      case 'PENDING_VISIT':
        return x.approvedBefore ? 'RECHECK' : 'FIRST_VISIT'
      case 'DRAFT':
        return shop.statusReason ? 'SENT_BACK' : null
      case 'APPROVED':
        return x.rechecking ? 'RECHECK' : 'LIVE'
      case 'SUSPENDED':
        return 'SUSPENDED'
      case 'CLOSED':
        return 'CLOSED'
      default:
        return null
    }
  }

  private view(shop: Json): Json {
    const x = this.extra.get(shop.id as string)!
    return { ...shop, group: this.groupOf(shop), statusSince: x.statusSince, waitingForVisit: this.waits(shop), addressRequested: Boolean(x.addressRequest) }
  }

  /** Waiting for a visit (Shop.waitingForVisit): its first, a reinstated one's, or a live shop's re-check. */
  waits(shop: Json): boolean {
    return shop.status === 'PENDING_VISIT' || Boolean(this.extra.get(shop.id as string)?.rechecking)
  }

  /**
   * Taken off the team as the backend really does it: the access token stops working (401), the refresh then
   * succeeds with adminRole NONE, and /admin/me answers 403 to the new token. With `redisDown` the old access token
   * keeps working (the revocation list can't be read), so /admin/me answers 404 NOT_FOUND instead.
   */
  removeFromTeam(opts: { redisDown?: boolean } = {}) {
    this.setRole('NONE')
    if (!opts.redisDown) this.expireAccess()
  }

  /** A status change made elsewhere (another admin): the version moves on with it, as on the backend. */
  /**
   * The owner closes the shop (ShopOwnershipService.close, Shop.close): CLOSED with statusReason = their reason
   * (or null), and a timeline entry CLOSED by the owner with the same reason.
   */
  closeShop(id: string, reason: string | null) {
    const shop = this.shops.find((s) => s.id === id)!
    Object.assign(shop, { status: 'CLOSED', statusReason: reason, version: (shop.version as number) + 1 })
    const x = this.extra.get(id)!
    x.statusSince = new Date().toISOString()
    x.timeline.unshift({ at: x.statusSince, event: 'CLOSED', byName: shop.ownerName, byAdmin: false, reason, note: null, checklist: [] })
  }

  setStatus(id: string, status: Status, reason: string | null = null) {
    const shop = this.shops.find((s) => s.id === id)!
    Object.assign(shop, { status, statusReason: reason, version: (shop.version as number) + 1 })
    this.extra.get(id)!.statusSince = new Date().toISOString()
  }

  private tokens() {
    const access = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: this.user.id, adminRole: this.user.adminRole })).toString('base64url')}.sig${++this.n}`
    const refresh = `refresh-${++this.n}`
    this.access.set(access, this.user.adminRole)
    this.refreshTokens.set(refresh, 'live')
    return {
      accessToken: access,
      accessExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      refreshToken: refresh,
      refreshExpiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      user: this.user,
      newUser: this.user.name === null,
    }
  }

  /** A saved session for the app to pick up (as if the person signed in earlier). */
  savedSession(): string {
    const refresh = `refresh-saved-${++this.n}`
    this.refreshTokens.set(refresh, 'live')
    return JSON.stringify({ refreshToken: refresh, user: this.user })
  }

  /** Ends every access token now (as if they expired): the next call must refresh. */
  expireAccess() {
    this.access.clear()
  }

  calledTimes(method: string, pathStart: string): number {
    return this.calls.filter((c) => c.method === method && c.path.startsWith(pathStart)).length
  }

  async attach(context: BrowserContext) {
    await context.route(`${PHOTOS}/**`, (route) => {
      // A 1×1 PNG, so photos load without the internet; a salon video is a real little one (or a few bytes that
      // aren't a video, for a link that can't play)
      const path = new URL(route.request().url()).pathname
      if (!path.endsWith('.mp4')) {
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png' }, body: Buffer.from(PNG, 'base64') })
      }
      return path.includes('broken')
        ? route.fulfill({ status: 200, headers: { 'Content-Type': 'video/mp4' }, body: Buffer.from('not a video') })
        : route.fulfill({ status: 200, headers: { 'Content-Type': 'video/mp4' }, body: VIDEO })
    })
    await context.route(`${API}/**`, async (route) => {
      if (this.offline) return route.abort('internetdisconnected')
      try {
        await this.handle(route)
      } catch (e) {
        console.error('mock api failed on', route.request().method(), route.request().url(), e)
        await route.fulfill({ status: 500, body: JSON.stringify({ code: 'MOCK_FAILED', message: String(e) }) })
      }
    })
  }

  private testModeOn(): boolean {
    if (this.testMode.on && this.testMode.until && Date.parse(this.testMode.until) <= Date.now()) {
      this.testMode = { on: false, until: null, turnedOnByName: null }
    }
    return this.testMode.on
  }

  private testState(): Json {
    this.testModeOn()
    if (this.testEmailsMissing) return { ...this.testMode, phones: this.testPhones }
    return { ...this.testMode, phones: this.testPhones, emails: this.testEmails }
  }

  private async handle(route: Route) {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: this.cors() })
    const raw = req.postData()
    const body = raw ? JSON.parse(raw) : undefined
    const auth = req.headers()['authorization'] ?? null
    this.calls.push({ method, path: url.pathname + url.search, body, auth, at: Date.now() })
    const p = url.pathname.replace(P, '')
    for (const [suffix, ms] of this.slow) if (p.endsWith(suffix)) await new Promise((r) => setTimeout(r, ms))
    const lost = [...this.loseAnswer].find((suffix) => p.endsWith(suffix))
    if (lost) this.loseAnswer.delete(lost)
    const ok = (status: number, json?: unknown, extra: Record<string, string> = {}) => {
      if (lost) return route.abort('timedout')
      const text = json === undefined ? '' : JSON.stringify(json)
      // Every successful GET carries an ETag; sent back unchanged as If-None-Match, the answer is 304 with no body
      const etag = method === 'GET' && status >= 200 && status < 300 ? etagOf(text) : null
      if (etag && matches(req.headers()['if-none-match'], etag)) {
        this.notModified.push(url.pathname + url.search)
        return route.fulfill({ status: 304, headers: { ...this.cors(), ETag: etag }, body: '' })
      }
      return route.fulfill({
        status,
        headers: { ...this.cors(), 'Content-Type': 'application/json', ...(etag ? { ETag: etag } : {}), ...extra },
        body: text,
      })
    }
    const fail = (status: number, code: string, message: string, details: Json = {}) => ok(status, { code, message, details })
    const invalid = (details: Json) => fail(400, 'VALIDATION_FAILED', 'Some fields are not valid', details)

    // ---------- sign-in (public) ----------
    if (p === '/auth/otp/send') return ok(202)
    if (p === '/auth/otp/verify') return body.code === '123456' ? ok(200, this.tokens()) : fail(400, 'WRONG_CODE', 'That code is not right. 4 tries left.')
    if (p === '/auth/recover/start') return ok(202)
    if (p === '/auth/recover/complete') {
      if (body.emailCode !== '654321' || body.phoneCode !== '123456') return fail(400, 'WRONG_CODE', 'A code is not right.')
      this.user = { ...this.user, phone: body.newPhone }
      return ok(200, this.tokens())
    }
    if (p === '/auth/refresh') {
      const state = this.refreshTokens.get(body.refreshToken)
      if (state === 'rotated') return fail(401, 'REFRESH_TOKEN_REUSED', 'For your safety you were signed out everywhere. Sign in again.')
      if (state !== 'live') return fail(401, 'INVALID_REFRESH_TOKEN', 'Sign in again.')
      // A test account stays signed in only while test mode covers its number: on, and the number still listed.
      const covered = this.testModeOn() && this.testPhones.some((t) => t.phone === this.user.phone)
      if (this.signedInAsTestAccount && !covered) return fail(401, 'TEST_MODE_OFF', 'Test mode is off for this number. Sign in again.')
      this.refreshTokens.set(body.refreshToken, 'rotated')
      return ok(200, this.tokens())
    }
    if (p === '/auth/logout') {
      this.refreshTokens.set(body.refreshToken, 'rotated')
      return ok(204)
    }

    const token = auth?.replace('Bearer ', '') ?? ''
    const tokenRole = this.access.get(token)
    if (tokenRole === undefined) return fail(401, 'TOKEN_EXPIRED', 'Your session has expired. Refresh it.')

    // 503 SERVICE_BUSY with Retry-After, as GlobalExceptionHandler answers a statement past its time limit
    for (const [suffix, b] of this.busy) {
      if (p.endsWith(suffix) && b.times > 0) {
        b.times -= 1
        return ok(503, { code: 'SERVICE_BUSY', message: "We're having a short problem. Try again in a few seconds.", details: {} }, { 'Retry-After': String(b.retryAfter) })
      }
    }
    for (const [suffix, f] of this.failOnce) {
      if (p.endsWith(suffix)) {
        this.failOnce.delete(suffix)
        return fail(f.status, f.code, f.message, f.details ?? {})
      }
    }

    if (p === '/auth/me' && method === 'PATCH') {
      this.user = { ...this.user, name: body.name }
      return ok(200, this.user)
    }
    if (p === '/auth/email/send-code') return ok(202)
    if (p === '/auth/email/verify') {
      if (body.code !== '654321') return fail(400, 'WRONG_CODE', 'That code is not right.')
      this.user = { ...this.user, email: body.email, emailVerified: true }
      return ok(200, this.user)
    }

    if (!p.startsWith('/admin/')) return fail(404, 'NOT_FOUND', 'Not found.')

    // ---------- admin: who may call ----------
    // A token without an admin role: the security config's 403. A token issued while an admin, for someone who
    // isn't one any more: 404 NOT_FOUND (as the contract says).
    if (tokenRole === 'NONE') return fail(403, 'FORBIDDEN', "You can't do this.")
    if (this.user.adminRole === 'NONE') return fail(404, 'NOT_FOUND', 'Not found.')
    const superOnly = () => fail(403, 'SUPER_ADMIN_ONLY', 'Only the super admin can do this.')
    const isSuper = this.user.adminRole === 'SUPER_ADMIN'

    if (p === '/admin/me') {
      const on = this.testModeOn()
      return ok(200, {
        userId: this.user.id,
        name: this.user.name,
        phone: this.user.phone,
        adminRole: this.user.adminRole,
        designation: this.user.adminRole === 'ADMIN' ? (this.user.designation ?? 'FIELD_AGENT') : null,
        testMode: { on, until: on ? this.testMode.until : null },
      })
    }

    // ---------- support tickets (TicketService) ----------
    const support = this.user.adminRole === 'ADMIN' && this.user.designation === 'SUPPORT'
    if (p.startsWith('/admin/tickets')) {
      if (!support && !isSuper) return fail(404, 'NOT_FOUND', 'Not found.')
      const names = (id: string | null) => (id === null ? null : (this.team.find((m) => m.userId === id)?.name as string | undefined) ?? 'Someone')
      const summary = (t: MockTicket) => ({
        id: t.id, number: t.number, subject: t.subject, status: t.status, source: t.source, requester: t.requester,
        assigneeId: t.assigneeId, assigneeName: names(t.assigneeId), createdAt: t.createdAt, lastMessageAt: t.lastMessageAt,
      })
      const detail = (t: MockTicket) => ({
        ticket: summary(t), requesterId: t.requesterId, requesterEmail: t.requesterEmail, messages: t.messages,
        events: t.events, profile: t.profile, earlierTickets: t.requesterId ? this.tickets.filter((x) => x.requesterId === t.requesterId).length - 1 : 0, emailsWaiting: t.emailsWaiting, emailsFailed: t.emailsFailed,
        lastIncomingSeq: Math.max(0, ...t.messages.filter((m) => m.direction === 'IN').map((m) => m.seq as number)),
        version: t.version,
        senderVerified: t.senderVerified ?? true,
      })
      if (p === '/admin/tickets' && method === 'GET') {
        const view = url.searchParams.get('view') ?? 'ACTIVE'
        if (view === 'UNASSIGNED' && !isSuper) return superOnly()
        const statuses = view === 'OPEN' ? ['OPEN'] : view === 'WAITING' ? ['WAITING'] : view === 'RESOLVED' ? ['RESOLVED'] : ['OPEN', 'WAITING']
        const assignee = support ? this.user.id : url.searchParams.get('assignee')
        const rows = this.tickets
          .filter((t) => statuses.includes(t.status))
          .filter((t) => (view === 'UNASSIGNED' ? t.assigneeId === null : assignee ? t.assigneeId === assignee : true))
          .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || a.id.localeCompare(b.id))
        const before = url.searchParams.get('before')
        const beforeId = url.searchParams.get('beforeId')
        // As TicketStore.list: after the cursor by time, then by id among equal times (a row that moved doesn't matter)
        const after = before ? rows.filter((t) => t.lastMessageAt < before || (t.lastMessageAt === before && t.id > String(beforeId))) : rows
        return ok(200, after.slice(0, 50).map(summary))
      }
      if (p === '/admin/tickets/search') {
        const q = (url.searchParams.get('q') ?? '').trim()
        const requester = url.searchParams.get('requester')
        // TicketService.search: a bare number, or "CLZ" and digits anywhere ("Re: [CLZ-1042] …"), else an email or a phone
        const num = /^(?:CLZ\s*-?\s*)?(\d{1,9})$/i.exec(q) ?? (q.includes('@') ? null : /\bCLZ\s*-?\s*(\d{1,9})\b/i.exec(q))
        let rows: MockTicket[]
        if (requester) rows = this.tickets.filter((t) => t.requesterId === requester)
        else if (num) rows = this.tickets.filter((t) => t.number === `CLZ-${Number(num[1])}`)
        else if (q.includes('@')) rows = this.tickets.filter((t) => (t.requesterEmail ?? '').toLowerCase() === q.toLowerCase())
        else if (/^\+?[\d\s-]{10,}$/.test(q)) rows = this.tickets.filter((t) => t.profile.some((s) => (s.lines as string[]).includes(`Phone: ${q.replace(/\D/g, '').slice(-10)}`)))
        else return fail(400, 'VALIDATION_FAILED', 'Some fields are not valid', { q: 'type a ticket number (CLZ-1042), a mobile number or an email' })
        if (support) rows = rows.filter((t) => t.assigneeId === this.user.id)
        return ok(200, rows.slice(0, 50).map(summary))
      }
      if (p === '/admin/tickets/away' && method === 'GET') {
        const all = [...this.away].map(([userId, since]) => ({ userId, since }))
        return ok(200, support ? all.filter((a) => a.userId === this.user.id) : all)
      }
      const awayMatch = p.match(/^\/admin\/tickets\/away\/([^/]+)$/)
      if (awayMatch && method === 'PUT') {
        const id = awayMatch[1]
        if (!isSuper && id !== this.user.id) return fail(404, 'NOT_FOUND', 'Page not found')
        if (!this.team.some((x) => x.userId === id && x.designation === 'SUPPORT')) return fail(400, 'NOT_SUPPORT', 'Only a support person can be away.')
        const recount = () => {
          this.team = this.team.map((x) => ({ ...x, openTickets: this.tickets.filter((t) => t.assigneeId === x.userId && t.status !== 'RESOLVED').length }))
        }
        if (body.away) {
          if (!this.away.has(id)) this.away.set(id, new Date().toISOString())
          const others = this.team.filter((x) => x.designation === 'SUPPORT' && x.userId !== id && !this.away.has(x.userId as string))
          let moved = 0
          for (const t of this.tickets.filter((x) => x.assigneeId === id && x.status !== 'RESOLVED')) {
            const free = others.filter((o) => o.userId !== t.requesterId)
            const target = free[moved % Math.max(1, free.length)]?.userId as string | undefined
            if (!target) continue
            t.assigneeId = target
            t.version += 1
            moved++
          }
          recount()
          return ok(200, { away: true, moved, stayed: this.tickets.filter((x) => x.assigneeId === id && x.status !== 'RESOLVED').length })
        }
        this.away.delete(id)
        // Back: they take their share of Unassigned (TicketAssigner.joinedSupport; here, all of it)
        for (const t of this.tickets.filter((x) => x.assigneeId === null && x.status !== 'RESOLVED' && x.requesterId !== id)) {
          t.assigneeId = id
          t.version += 1
        }
        recount()
        return ok(200, { away: false, moved: 0, stayed: this.tickets.filter((x) => x.assigneeId === id && x.status !== 'RESOLVED').length })
      }
      if (p === '/admin/tickets/move' && method === 'POST') {
        if (!isSuper) return superOnly()
        const to = (body.toUserId as string | null) ?? null
        if (to !== null && (to === body.fromUserId || !this.team.some((x) => x.userId === to && x.designation === 'SUPPORT'))) {
          return fail(400, 'NOT_SUPPORT', 'Choose another support person.')
        }
        const others = this.team.filter((x) => x.designation === 'SUPPORT' && x.userId !== body.fromUserId)
        let moved = 0
        for (const t of this.tickets.filter((x) => x.assigneeId === body.fromUserId && x.status !== 'RESOLVED')) {
          // Never to the person who asked it (TicketAssigner.moveAll): then by the rule, or it stays
          const free = others.filter((o) => o.userId !== t.requesterId)
          const target = (to && to !== t.requesterId ? to : null) ?? (free[moved % Math.max(1, free.length)]?.userId as string | undefined) ?? null
          if (!target) continue
          t.assigneeId = target
          t.version += 1
          moved++
        }
        this.team = this.team.map((x) => ({ ...x, openTickets: this.tickets.filter((t) => t.assigneeId === x.userId && t.status !== 'RESOLVED').length }))
        const stayed = this.tickets.filter((t) => t.assigneeId === body.fromUserId && t.status !== 'RESOLVED').length
        return ok(200, { moved, stayed })
      }
      if (p === '/admin/tickets/counts') {
        const mineOpen = this.tickets.filter((t) => t.assigneeId === this.user.id && t.status === 'OPEN').length
        const unassigned = isSuper ? this.tickets.filter((t) => t.assigneeId === null && t.status !== 'RESOLVED').length : 0
        return ok(200, { mineOpen, unassigned })
      }
      if (p === '/admin/tickets/stats') {
        if (!isSuper) return superOnly()
        const people = this.team
          .filter((m) => m.designation === 'SUPPORT' || this.tickets.some((t) => t.assigneeId === m.userId))
          .map((m) => {
            const mine = this.tickets.filter((t) => t.assigneeId === m.userId)
            return { userId: m.userId, name: m.name, support: m.designation === 'SUPPORT', open: mine.filter((t) => t.status === 'OPEN').length,
              waiting: mine.filter((t) => t.status === 'WAITING').length, resolved: mine.filter((t) => t.status === 'RESOLVED').length }
          })
        return ok(200, { people, unassigned: this.tickets.filter((t) => t.assigneeId === null && t.status !== 'RESOLVED').length })
      }
      const m = p.match(/^\/admin\/tickets\/([^/]+)(\/reply|\/close|\/assign|\/reopen)?$/)
      // The backend's ids are UUIDs (the fake's are t1001…): anything else is a 400 from the path's conversion
      if (m && !/^(t\d+|[0-9a-f-]{36})$/.test(decodeURIComponent(m[1]))) return fail(400, 'VALIDATION_FAILED', 'Some fields are not valid', { id: 'not valid' })
      const t = m ? this.tickets.find((x) => x.id === decodeURIComponent(m[1])) : undefined
      if (!m || !t) return fail(404, 'NOT_FOUND', 'Ticket not found.')
      // TicketService.assign: super admins only, checked first
      if (m[2] === '/assign' && !isSuper) return superOnly()
      if (m[2] === '/assign' && body.assigneeId && this.away.has(body.assigneeId as string)) {
        return fail(400, 'AWAY', 'That person is away. Choose someone who is here.')
      }
      if (support && t.assigneeId !== this.user.id) {
        return m[2] ? fail(409, 'NOT_YOURS', 'This ticket was given to someone else meanwhile.') : fail(404, 'NOT_FOUND', 'Ticket not found.')
      }
      const now = new Date().toISOString()
      if (!m[2]) return ok(200, detail(t))
      if (m[2] === '/reply') {
        const text = String(body.body ?? '').trim()
        if (!text || text.length > 5000) return invalid({ body: 'write 1 to 5000 characters' })
        if (t.requesterEmail === null) return fail(409, 'REQUESTER_GONE', 'They deleted their account, so there is no address to send a reply to. Close the ticket instead.')
        if (detail(t).lastIncomingSeq > Number(body.seenSeq)) return fail(409, 'NEW_MESSAGE', 'They wrote again while you were typing. Read their new message, then send your reply.')
        if (t.assigneeId === null) {
          t.assigneeId = this.user.id
          t.events.push({ event: 'ASSIGNED', actor: this.user.name, detail: `Taken by ${this.user.name}`, at: now })
        }
        t.messages.push({ seq: t.messages.length + 1, direction: 'OUT', author: this.user.name, body: text, attachments: 0, senderVerified: true, at: now })
        t.status = body.resolve ? 'RESOLVED' : 'WAITING'
        t.lastMessageAt = now
        t.emailsWaiting += 1
        t.version += 1
        t.events.push({ event: body.resolve ? 'RESOLVED' : 'REPLIED', actor: this.user.name, detail: null, at: now })
        this.replies.push({ id: t.id, body: text, resolve: !!body.resolve })
        return ok(200, detail(t))
      }
      if (m[2] === '/reopen') {
        if (Number(body.version) !== t.version) return fail(409, 'TICKET_CHANGED', 'This ticket changed meanwhile. Check it again, then choose.')
        if (t.status === 'RESOLVED') {
          t.status = 'OPEN'
          t.version += 1
          t.events.push({ event: 'REOPENED', actor: this.user.name, detail: 'Opened again (nobody was emailed)', at: now })
        }
        return ok(200, detail(t))
      }
      if (m[2] === '/close') {
        if (detail(t).lastIncomingSeq > Number(body.seenSeq)) return fail(409, 'NEW_MESSAGE', 'They wrote again. Read their new message before closing the ticket.')
        if (t.status !== 'RESOLVED') {
          if (t.assigneeId === null) t.assigneeId = this.user.id
          t.status = 'RESOLVED'
          t.version += 1
          t.events.push({ event: 'RESOLVED', actor: this.user.name, detail: 'Closed without a reply', at: now })
        }
        return ok(200, detail(t))
      }
      const to = (body.assigneeId as string | null) ?? null
      const holder = to === null ? null : this.team.find((x) => x.userId === to)
      if (to !== null && !(holder && (holder.designation === 'SUPPORT' || holder.adminRole === 'SUPER_ADMIN'))) {
        return fail(400, 'NOT_SUPPORT', "That person isn't in support. Choose a support person.")
      }
      if (to !== null && to === t.requesterId) return fail(400, 'OWN_TICKET', "That's their own question: give it to someone else.")
      if (Number(body.version) !== t.version) return fail(409, 'TICKET_CHANGED', 'This ticket changed meanwhile. Check it again, then choose.')
      if (t.assigneeId !== to) {
        t.assigneeId = to
        t.version += 1
        t.events.push({ event: to === null ? 'UNASSIGNED' : 'REASSIGNED', actor: this.user.name, detail: null, at: now })
      }
      return ok(200, detail(t))
    }
    // The businesses are the field team's: a support person gets 404 (TeamRole.onTeam is false for them)
    if (support && (p === '/admin/dashboard' || p.startsWith('/admin/shops') || p.startsWith('/admin/assignments'))) {
      return fail(404, 'NOT_FOUND', 'Not found.')
    }

    if (p === '/admin/dashboard') {
      const counts = (type: string) => {
        const c: Json = { FIRST_VISIT: 0, RECHECK: 0, SENT_BACK: 0, LIVE: 0, SUSPENDED: 0, CLOSED: 0 }
        for (const s of this.shops) {
          const g = this.groupOf(s)
          if (s.type === type && g && this.sees(s)) c[g] = (c[g] as number) + 1
        }
        return c
      }
      return ok(200, { KIRANA: counts('KIRANA'), SALON: counts('SALON') })
    }

    if (p === '/admin/shops' && method === 'GET') {
      // Spring reads every value first: a type or group it doesn't know is 400 BAD_REQUEST with the allowed values
      // (handleTypeMismatch); then the controller wants both (VALIDATION_FAILED naming each missing one)
      const type = url.searchParams.get('type') || null
      const group = url.searchParams.get('group') || null
      const TYPES = ['KIRANA', 'SALON']
      const GROUPS = ['FIRST_VISIT', 'RECHECK', 'SENT_BACK', 'LIVE', 'SUSPENDED', 'CLOSED']
      if (type !== null && !TYPES.includes(type)) return fail(400, 'BAD_REQUEST', `'${type}' is not a valid value for 'type'`, { allowed: TYPES })
      if (group !== null && !GROUPS.includes(group)) return fail(400, 'BAD_REQUEST', `'${group}' is not a valid value for 'group'`, { allowed: GROUPS })
      // The next page: after the last shop's statusSince and id (ShopAdminController). Spring reads the values first:
      // one that isn't an instant or an id (this fake's ids stand in for the backend's UUIDs) is 400 BAD_REQUEST from
      // GlobalExceptionHandler.handleTypeMismatch; an empty one counts as not sent. Then half a cursor is
      // 400 VALIDATION_FAILED.
      const afterSince = url.searchParams.get('afterSince') || null
      const afterId = url.searchParams.get('afterId') || null
      const unreadable = (value: string, name: string) => fail(400, 'BAD_REQUEST', `'${value}' is not a valid value for '${name}'`)
      if (afterSince !== null && (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(afterSince) || Number.isNaN(Date.parse(afterSince)))) {
        return unreadable(afterSince, 'afterSince')
      }
      if (afterId !== null && !/^shop\d+$/.test(afterId)) return unreadable(afterId, 'afterId')
      const missing: Json = {}
      if (type === null) missing.type = 'is required'
      if (group === null) missing.group = 'is required'
      if (Object.keys(missing).length) return invalid(missing)
      if ((afterSince === null) !== (afterId === null)) return invalid({ afterId: 'send afterSince and afterId together' })
      // A field agent always gets their own; a super admin may narrow to one agent's or to the unassigned ones
      const assignedTo = url.searchParams.get('assignedTo') || null
      const unassigned = url.searchParams.get('unassigned') === 'true'
      if (assignedTo !== null && unassigned) return invalid({ unassigned: 'send assignedTo or unassigned, not both' })
      if (unassigned && group !== 'FIRST_VISIT' && group !== 'RECHECK') return invalid({ unassigned: 'only for FIRST_VISIT and RECHECK' })
      // ShopAdminService.requireSearchable: 1 or 2 characters (code points) that aren't a shop number are refused
      const typed = (url.searchParams.get('q') ?? '').trim()
      if (typed && [...typed].length < 3 && !/^#?\d+$/.test(typed)) return invalid({ q: 'type at least 3 letters' })
      if (afterId !== null && this.failShopPages > 0) {
        this.failShopPages -= 1
        return fail(500, 'INTERNAL_ERROR', 'Something went wrong on our side.')
      }
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      // Shop number exactly ("1042" or "#1042"); owner phone in part (spaces, "+91", dashes ignored); name or owner name.
      const number = q.replace(/^#/, '')
      const digits = q.replace(/^\+91/, '').replace(/[\s-]/g, '')
      const list = this.shops
        .filter((s) => s.type === type && this.groupOf(s) === group && this.sees(s))
        .filter((s) => {
          if (!isSuper) return true
          const who = (s.assignedTo as Json | null)?.id ?? null
          return unassigned ? who === null : assignedTo === null || who === assignedTo
        })
        .filter((s) => {
          if (!q) return true
          if (/^\d+$/.test(number) && String(s.shopCode) === number) return true
          if (/^\d+$/.test(digits) && typeof s.ownerPhone === 'string' && s.ownerPhone.includes(digits)) return true
          return [s.name, s.ownerName].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
        })
        // Longest waiting first, ties by id; a page is everything after the cursor (keyset), 50 at most
        .map((s) => ({ s, since: Date.parse(this.extra.get(s.id as string)!.statusSince), id: s.id as string }))
        .sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .filter((x) => afterId === null || x.since > Date.parse(afterSince!) || (x.since === Date.parse(afterSince!) && x.id > afterId))
        .slice(0, SHOPS_PAGE)
      return ok(200, list.map((x) => this.view(x.s)))
    }

    const timelinePath = p.match(/^\/admin\/shops\/([^/]+)\/timeline$/)
    if (timelinePath && method === 'GET') {
      // Spring reads the values first: a time that isn't an instant or a seq that isn't a number is 400 BAD_REQUEST
      // (handleTypeMismatch; an empty one counts as not sent); then one without the other is VALIDATION_FAILED naming
      // afterSeq; then 404 for a shop that doesn't exist
      const afterAt = url.searchParams.get('afterAt') || null
      const afterSeq = url.searchParams.get('afterSeq') || null
      const unreadable = (value: string, name: string) => fail(400, 'BAD_REQUEST', `'${value}' is not a valid value for '${name}'`)
      if (afterAt !== null && (!INSTANT.test(afterAt) || Number.isNaN(Date.parse(afterAt)))) return unreadable(afterAt, 'afterAt')
      if (afterSeq !== null && !/^-?\d+$/.test(afterSeq)) return unreadable(afterSeq, 'afterSeq')
      if ((afterAt === null) !== (afterSeq === null)) return invalid({ afterSeq: 'send afterAt and afterSeq together' })
      const shop = this.shops.find((s) => s.id === timelinePath[1])
      if (!shop || !this.sees(shop)) return fail(404, 'NOT_FOUND', 'No such shop.')
      if (afterAt !== null && this.failTimelinePages > 0) {
        this.failTimelinePages -= 1
        return fail(500, 'INTERNAL_ERROR', 'Something went wrong on our side.')
      }
      return ok(200, this.timelinePage(shop.id as string, afterAt === null ? null : { at: micros(afterAt), seq: Number(afterSeq) }))
    }

    const assignPath = p.match(/^\/admin\/shops\/([^/]+)\/assign$/)
    if (assignPath && method === 'POST') {
      // ShopAssignments.assign: super admins; the shop (404), waiting (409 WRONG_STATUS), a field agent (400), not
      // one who works in it (409 OWN_SHOP); the same agent again changes nothing
      if (!isSuper) return superOnly()
      const shop = this.shops.find((s) => s.id === assignPath[1])
      if (!shop) return fail(404, 'NOT_FOUND', 'No such shop.')
      if (!this.waits(shop)) return fail(409, 'WRONG_STATUS', `The shop is ${shop.status}.`, { status: shop.status })
      const agent = this.team.find((m) => m.userId === body?.adminId && m.adminRole === 'ADMIN')
      if (!agent) return fail(400, 'NOT_A_FIELD_AGENT', "That person isn't a field agent on the team.")
      if (this.agentWorksIn.has(`${agent.userId as string}:${shop.id as string}`)) {
        return fail(409, 'OWN_SHOP', 'That field agent works in this business, so they can\'t visit it. Choose someone else.')
      }
      shop.assignedTo = { id: agent.userId, name: agent.name }
      return ok(204)
    }
    if (p === '/admin/assignments/move' && method === 'POST') {
      if (!isSuper) return superOnly()
      if (body?.fromAdminId === body?.toAdminId) return invalid({ toAdminId: 'choose someone else' })
      const agent = this.team.find((m) => m.userId === body?.toAdminId && m.adminRole === 'ADMIN')
      if (!agent) return fail(400, 'NOT_A_FIELD_AGENT', "That person isn't a field agent on the team.")
      let moved = 0
      let stayed = 0
      for (const s of this.shops) {
        if (!this.waits(s) || (s.assignedTo as Json | null)?.id !== body.fromAdminId) continue
        if (this.agentWorksIn.has(`${agent.userId as string}:${s.id as string}`)) stayed++
        else {
          s.assignedTo = { id: agent.userId, name: agent.name }
          moved++
        }
      }
      return ok(200, { moved, stayed })
    }

    if (p === '/admin/shops/documents-to-check' && method === 'GET') {
      // ShopAdminService.documentsToCheck: super admins; live salons with a document not checked yet
      if (!isSuper) return superOnly()
      return ok(200, this.shops
        .filter((s) => s.type === 'SALON' && s.status === 'APPROVED')
        .filter((s) => { const d = this.extra.get(s.id as string)!.registrationDoc; return d !== null && !d.checkedAt })
        .map((s) => this.view(s)))
    }
    const docPath = p.match(/^\/admin\/shops\/([^/]+)\/registration-document\/(check|remove)$/)
    if (docPath && method === 'POST') {
      const shop = this.shops.find((s) => s.id === docPath[1])
      if (!shop || !this.sees(shop)) return fail(404, 'NOT_FOUND', 'No such shop.')
      if (this.memberOf.has(shop.id as string)) return fail(403, 'OWN_SHOP', "You can't decide on a shop you belong to. Ask another admin.")
      if (shop.status === 'CLOSED') return fail(409, 'WRONG_STATUS', `A shop that is CLOSED can't be changed. Someone may have decided already; reload.`, { status: 'CLOSED' })
      if (body.version !== shop.version) return fail(409, 'SHOP_CHANGED', 'The shop changed after you loaded it. Reload and check the new details first.')
      const x = this.extra.get(shop.id as string)!
      if (!x.registrationDoc) return fail(409, 'NO_DOCUMENT', 'This salon has no registration document.')
      if (docPath[2] === 'remove') {
        const problem = textProblem(body.reason, 2, 200)
        if (problem) return invalid({ reason: problem })
        x.registrationDoc = null
      } else {
        x.registrationDoc = { ...x.registrationDoc, checkedAt: new Date().toISOString() }
      }
      shop.version = (shop.version as number) + 1
      return ok(200, this.view(shop))
    }
    // ---- The address: the owner's request declined, or set by the field team (ShopAdminService) ----
    const addressPath = p.match(/^\/admin\/shops\/([^/]+)\/(address|address-request\/decline)$/)
    if (addressPath && ((addressPath[2] === 'address' && method === 'PATCH') || (addressPath[2] !== 'address' && method === 'POST'))) {
      const shop = this.shops.find((s) => s.id === addressPath[1])
      if (!shop || !this.sees(shop)) return fail(404, 'NOT_FOUND', 'No such shop.')
      if (this.memberOf.has(shop.id as string)) return fail(403, 'OWN_SHOP', "You can't decide on a shop you belong to. Ask another admin.")
      // The request body (@Valid) first, then the status, then the version, as the backend
      if (typeof body.version !== 'number') return invalid({ version: 'is required' })
      const bad: Json = {}
      if (addressPath[2] !== 'address') {
        const problem = textProblem(body.reason, 2, 200)
        if (problem) bad.reason = problem
      } else {
        for (const [k, min, max] of [['addressLine', 5, 200], ['area', 2, 100], ['city', 2, 60]] as const) {
          const problem = textProblem(body[k], min, max)
          if (problem) bad[k] = problem
        }
        if (!/^[1-9]\d{5}$/.test(body.pincode ?? '')) bad.pincode = 'must be a 6-digit pincode'
        if (!(body.latitude >= 6 && body.latitude <= 37.6)) bad.latitude = 'must be between 6.0 and 37.6'
        if (!(body.longitude >= 68 && body.longitude <= 97.5)) bad.longitude = 'must be between 68.0 and 97.5'
      }
      if (Object.keys(bad).length) return invalid(bad)
      if (shop.status === 'CLOSED') return fail(409, 'WRONG_STATUS', `A shop that is CLOSED can't be changed. Someone may have decided already; reload.`, { status: 'CLOSED' })
      if (body.version !== shop.version) return fail(409, 'SHOP_CHANGED', 'The shop changed after you loaded it. Reload and check the new details first.')
      const x = this.extra.get(shop.id as string)!
      if (addressPath[2] !== 'address') {
        if (!x.addressRequest) return fail(409, 'NO_ADDRESS_REQUEST', 'No address change waits for this shop any more. Reload.')
        x.addressRequest = null
        x.timeline.unshift({ at: new Date().toISOString(), event: 'NOTE', byName: this.user.name, byAdmin: true, reason: null, note: `Address change declined: ${cleanText(body.reason)}`, checklist: [] })
        shop.version = (shop.version as number) + 1
        return ok(200, this.view(shop))
      }
      // ShopService.moveByFieldTeam: the same place changes nothing (no version, no note, a waiting request stays)
      const same = cleanText(body.addressLine) === shop.addressLine && cleanText(body.area) === shop.area
        && cleanText(body.city) === shop.city && body.pincode === shop.pincode && body.latitude === shop.latitude && body.longitude === shop.longitude
      if (same) return ok(200, this.view(shop))
      const old = `${shop.addressLine as string}, ${shop.area as string}, ${shop.city as string} ${shop.pincode as string}`
      Object.assign(shop, { addressLine: cleanText(body.addressLine), area: cleanText(body.area), city: cleanText(body.city), pincode: body.pincode, latitude: body.latitude, longitude: body.longitude })
      x.addressRequest = null   // the owner's waiting request is answered by this
      x.timeline.unshift({ at: new Date().toISOString(), event: 'NOTE', byName: this.user.name, byAdmin: true, reason: null, note: `Address changed by the field team: ${old} → ${shop.addressLine as string}, ${shop.area as string}, ${shop.city as string} ${shop.pincode as string}`, checklist: [] })
      shop.version = (shop.version as number) + 1
      return ok(200, this.view(shop))
    }
    const shopPath = p.match(/^\/admin\/shops\/([^/]+)(?:\/(approve|reject|suspend|reinstate|ask-to-fix|notes))?$/)
    if (shopPath) {
      const action = shopPath[2]
      // ShopAdminService: suspending and reinstating are for super admins (checked first), then a field agent sees
      // only their own (404 for any other, as if it didn't exist)
      if ((action === 'suspend' || action === 'reinstate') && method === 'POST' && !isSuper) return superOnly()
      const shop = this.shops.find((s) => s.id === shopPath[1])
      if (!shop || !this.sees(shop)) return fail(404, 'NOT_FOUND', 'No such shop.')
      const x = this.extra.get(shop.id as string)!
      if (!action && method === 'GET') {
        // The first 50, and where the next 50 start (null when there are no more)
        const first = this.timelinePage(shop.id as string, null)
        return ok(200, {
          shop: this.view(shop),
          salon: x.salon,
          changes: x.changes,
          pinMovedMetres: x.pinMovedMetres,
          previousOwnerPhotoUrl: x.previousOwnerPhotoUrl,
          previousShopPhotoUrl: x.previousShopPhotoUrl,
          // Signed again on each read, as the backend does (a new query each time)
          videoUrl: x.videoUrl ? `${x.videoUrl}?sig=${++this.videoSigs}` : null,
          registrationDoc: x.registrationDoc,
          addressRequest: x.addressRequest ?? null,
          timeline: first.items,
          timelineNext: first.next,
        })
      }
      // ShopAdminService.requireNotOwnShop: an admin who works in the shop, before anything else
      if (action && method === 'POST' && this.memberOf.has(shop.id as string)) {
        return fail(403, 'OWN_SHOP', "You can't decide on a shop you belong to. Ask another admin.")
      }
      const note = typeof body?.note === 'string' ? cleanText(body.note) : ''
      if (action === 'notes' && method === 'POST') {
        const problem = textProblem(body.note, 2, 500)
        if (problem) return invalid({ note: problem })
        const entry = { at: new Date().toISOString(), event: 'NOTE', byName: this.user.name, byAdmin: true, reason: null, note, checklist: [] }
        x.timeline.unshift(entry)
        return ok(201, entry)
      }
      if (action && method === 'POST') {
        // Order of checks, as the backend: status (409 WRONG_STATUS with the status now), then version (409
        // SHOP_CHANGED), then the text fields (400 VALIDATION_FAILED). A missing version is a malformed request (400).
        if (typeof body.version !== 'number') return invalid({ version: 'is required' })
        const needsReason = action === 'reject' || action === 'suspend' || action === 'ask-to-fix'
        // Approve: a shop waiting for a visit, also a live one waiting for its re-check (it stays APPROVED). Send back:
        // PENDING_VISIT only. Ask the owner to fix: a live one waiting for its re-check only
        const from: Record<string, Status[]> = {
          approve: ['PENDING_VISIT', 'APPROVED'],
          reject: ['PENDING_VISIT'],
          'ask-to-fix': ['APPROVED'],
          suspend: ['APPROVED', 'PENDING_VISIT'],
          reinstate: ['SUSPENDED'],
        }
        const forWaiting = action === 'approve' || action === 'ask-to-fix'
        if (!from[action].includes(shop.status as Status) || (forWaiting && !this.waits(shop))) {
          return fail(409, 'WRONG_STATUS', `The shop is ${shop.status}.`, { status: shop.status })
        }
        if (body.version !== shop.version) return fail(409, 'SHOP_CHANGED', 'The shop was changed. Reload and check again.')
        const reason = typeof body.reason === 'string' ? cleanText(body.reason) : ''
        const details: Json = {}
        const reasonProblem = needsReason ? textProblem(body.reason, 2, 200) : null
        if (reasonProblem) details.reason = reasonProblem
        // A note is optional: empty means none; given, it follows the text rule (2–500).
        const noteProblem = note ? textProblem(body.note, 2, 500) : null
        if (noteProblem) details.note = noteProblem
        const known = ['NAME_BOARD_NOT_VISIBLE', 'OWNER_PHOTO_UNCLEAR', 'PIN_WRONG', 'ADDRESS_MISMATCH', 'GST_UDYAM_MISMATCH', 'SHOP_SHUT', 'OTHER']
        if (body.checklist !== undefined && (!Array.isArray(body.checklist) || body.checklist.some((c: unknown) => !known.includes(c as string)))) {
          details.checklist = 'has an unknown item'
        }
        if (Object.keys(details).length) return invalid(details)
        const to: Record<string, Status> = { approve: 'APPROVED', reject: 'DRAFT', suspend: 'SUSPENDED', reinstate: 'PENDING_VISIT', 'ask-to-fix': 'APPROVED' }
        const event: Record<string, string> = { approve: 'APPROVED', reject: 'SENT_BACK', suspend: 'SUSPENDED', reinstate: 'REINSTATED', 'ask-to-fix': 'FIX_ASKED' }
        shop.status = to[action]
        // Asked for a fix: still waiting, in the same place in the queue (FIX_ASKED doesn't move statusSince)
        if (action !== 'ask-to-fix') {
          x.rechecking = false
          x.statusSince = new Date().toISOString()
        }
        shop.statusReason = needsReason ? reason : null
        shop.version = (shop.version as number) + 1
        if (action === 'approve') {
          // The owner's waiting address change request is applied with it
          const r = x.addressRequest
          if (r) {
            Object.assign(shop, { addressLine: r.addressLine, area: r.area, city: r.city, pincode: r.pincode, latitude: r.latitude, longitude: r.longitude })
            x.addressRequest = null
          }
          x.approvedBefore = true
          x.changes = []
          x.pinMovedMetres = null
          x.previousOwnerPhotoUrl = null
          x.previousShopPhotoUrl = null
        }
        if (action === 'reinstate') x.approvedBefore = true
        x.timeline.unshift({
          at: new Date().toISOString(),
          event: event[action],
          byName: this.user.name,
          byAdmin: true,
          reason: needsReason ? reason : null,
          note: note || null,
          checklist: needsReason && Array.isArray(body.checklist) ? body.checklist : [],
        })
        return ok(200, this.view(shop))
      }
    }

    // ---------- support ----------
    if (p.startsWith('/admin/salon/strikes') && !isSuper) return superOnly()
    if (p === '/admin/salon/strikes/lookup' && method === 'POST') {
      if (!PHONE.test(body.phone ?? '')) return fail(400, 'INVALID_PHONE', 'That is not a valid mobile number.')
      const c = this.customers.get(body.phone)
      if (!c) return fail(404, 'CUSTOMER_NOT_FOUND', 'No customer with this number.')
      return ok(200, c)
    }
    const strike = p.match(/^\/admin\/salon\/strikes\/([^/]+)\/remove$/)
    if (strike && method === 'POST') {
      const problem = textProblem(body.reason, 2, 200)
      if (problem) return invalid({ reason: problem })
      for (const c of this.customers.values()) {
        const before = c.strikes.length
        c.strikes = c.strikes.filter((s) => s.appointmentId !== strike[1])
        if (c.strikes.length < before) {
          if (c.strikes.length < 2) c.blockedUntil = null
          return ok(204)
        }
      }
      return fail(404, 'STRIKE_NOT_FOUND', 'This strike was already removed.')
    }

    // ---------- super admin only ----------
    if (p === '/admin/team' && method === 'GET') {
      if (!isSuper) return superOnly()
      return ok(200, [...this.team].sort((a, b) => Number(b.adminRole === 'SUPER_ADMIN') - Number(a.adminRole === 'SUPER_ADMIN')).map((m) => this.withPending(m)))
    }
    if (p === '/admin/team/coverage' && method === 'GET') {
      if (!isSuper) return superOnly()
      const by = new Map<string, Json[]>()
      for (const m of this.team) for (const pin of m.pincodes as string[]) by.set(pin, [...(by.get(pin) ?? []), { userId: m.userId, name: m.name, phone: m.phone }])
      return ok(200, [...by.keys()].sort().map((pincode) => ({ pincode, agents: by.get(pincode) })))
    }
    if (p === '/admin/team' && method === 'POST') {
      // AdminTeamService.add, in its order: the fields; a listed test number; a test email; another account's email;
      // already on the team; an account made in test mode
      if (!isSuper) return superOnly()
      const checked = this.checkMember(body)
      if (checked.error) return fail(checked.error.status, checked.error.code, checked.error.message, checked.error.details)
      const email = checked.member.email as string
      if (this.testPhones.some((t) => t.phone === checked.phone)) return fail(409, 'TEST_PHONE', 'That is a test number. Remove it from the test numbers first.')
      if (this.testEmails.some((t) => t.email === email)) return fail(409, 'TEST_EMAIL', 'That is a test email.')
      const existing = this.team.find((m) => m.phone === checked.phone)
      if (this.emailOfAnother(email, existing ? (existing.userId as string) : null)) {
        return fail(409, 'EMAIL_IN_USE', 'This email is already used by another account')
      }
      if (existing) return fail(409, 'ALREADY_ADMIN', 'That person is an admin already.')
      if (this.testAccounts.has(checked.phone)) return fail(409, 'TEST_PHONE', "That number's account was made in test mode.")
      const m = MockApi.teamMember({ userId: `u${++this.n}`, ...checked.member, emailVerified: false, since: new Date().toISOString() })
      this.team.push(m)
      this.pickUpUnassigned(m, m.pincodes as string[])
      return ok(201, this.withPending(m))
    }
    const member = p.match(/^\/admin\/team\/([^/]+)$/)
    if (member && method === 'PUT') {
      // AdminTeamService.edit, in its order: the fields; on the team (404); the version; a new phone (test number,
      // another account's); a new email (test email, another account's)
      if (!isSuper) return superOnly()
      const checked = this.checkMember(body)
      if (checked.error) return fail(checked.error.status, checked.error.code, checked.error.message, checked.error.details)
      const m = this.team.find((t) => t.userId === member[1])
      if (!m) return fail(404, 'NOT_FOUND', 'No such admin.')
      if (body.version !== m.version) return fail(409, 'MEMBER_CHANGED', 'Someone changed this member after you opened it. Reload and try again.')
      const newPhone = checked.phone !== m.phone
      if (newPhone && this.testPhones.some((t) => t.phone === checked.phone)) return fail(409, 'TEST_PHONE', 'That is a test number. Use another number.')
      if (newPhone && (this.otherPhones.has(checked.phone) || this.team.some((t) => t !== m && t.phone === checked.phone))) {
        return fail(409, 'PHONE_IN_USE', 'Another Clozest account already uses this phone number.')
      }
      const email = checked.member.email as string
      const newEmail = email !== String(m.email ?? '').toLowerCase()
      if (newEmail && this.testEmails.some((t) => t.email === email)) return fail(409, 'TEST_EMAIL', 'That is a test email.')
      if (newEmail && this.emailOfAnother(email, m.userId as string)) return fail(409, 'EMAIL_IN_USE', 'This email is already used by another account')
      const removed = (m.pincodes as string[]).filter((pin) => !(checked.member.pincodes as string[]).includes(pin))
      const added = (checked.member.pincodes as string[]).filter((pin) => !(m.pincodes as string[]).includes(pin))
      const wasAgent = m.adminRole === 'ADMIN'
      Object.assign(m, checked.member, { version: (m.version as number) + 1, emailVerified: newEmail ? false : m.emailVerified })
      // The pending businesses they no longer cover: to another agent covering the pincode, else Unassigned
      if (wasAgent && (m.adminRole !== 'ADMIN' || removed.length)) this.reassignFrom(m, m.adminRole === 'ADMIN' ? removed : null)
      if (m.adminRole === 'ADMIN') this.pickUpUnassigned(m, added)
      if (m.userId === this.user.id) {
        // The signed-in person: /admin/me answers the new role at once; a new phone or email ends every session
        this.user = { ...this.user, adminRole: m.adminRole as AdminRole, admin: true, phone: m.phone as string, email: m.email as string }
        if (newPhone || newEmail) {
          this.expireAccess()
          for (const k of this.refreshTokens.keys()) this.refreshTokens.set(k, 'rotated')
        }
      }
      return ok(200, this.withPending(m))
    }
    if (member && method === 'DELETE') {
      if (!isSuper) return superOnly()
      const m = this.team.find((t) => t.userId === member[1])
      if (!m) return fail(404, 'NOT_FOUND', 'No such admin.')
      if (m.userId === this.user.id) return fail(409, 'CANT_REMOVE_YOURSELF', "You can't remove yourself. Ask another super admin.")
      this.team = this.team.filter((t) => t !== m)
      m.adminRole = 'NONE'
      this.reassignFrom(m)
      return ok(204)
    }
    if (p === '/admin/test-mode') {
      if (!isSuper) return superOnly()
      if (method === 'GET') return ok(200, this.testState())
      if (method === 'PUT') {
        if (!Number.isInteger(body.hours) || body.hours < 1 || body.hours > 8) return invalid({ hours: 'must be 1 to 8' })
        this.testMode = { on: true, until: new Date(Date.now() + body.hours * 3600_000).toISOString(), turnedOnByName: this.user.name }
        return ok(200, this.testState())
      }
      if (method === 'DELETE') {
        this.testMode = { on: false, until: null, turnedOnByName: null }
        return ok(200, this.testState())
      }
    }
    if (p === '/admin/test-mode/phones' && method === 'POST') {
      if (!isSuper) return superOnly()
      const details: Json = {}
      if (!PHONE.test(body.phone ?? '')) return fail(400, 'INVALID_PHONE', 'That is not a valid mobile number.')
      const labelProblem = textProblem(body.label, 2, 60)
      if (labelProblem) details.label = labelProblem
      if (Object.keys(details).length) return invalid(details)
      if (this.team.some((m) => m.phone === body.phone)) return fail(409, 'ADMIN_PHONE', "An admin's number can't be a test number.")
      if (this.realAccounts.has(body.phone)) return fail(409, 'REAL_ACCOUNT', 'This number already has a real account.')
      if (this.testPhones.some((t) => t.phone === body.phone)) return fail(409, 'ALREADY_TEST_PHONE', 'Already a test number.')
      this.testPhones.push({ phone: body.phone, label: cleanText(body.label), addedAt: new Date().toISOString(), hasAccount: false })
      return ok(201, this.testState())
    }
    if (p === '/admin/test-mode/emails' && method === 'POST') {
      if (!isSuper) return superOnly()
      const email = String(body.email ?? '').trim().toLowerCase()
      if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email)) {
        return fail(400, 'INVALID_EMAIL', 'Enter a valid email address')
      }
      const labelProblem = textProblem(body.label, 2, 60)
      if (labelProblem) return invalid({ label: labelProblem })
      if (this.realEmails.has(email) || email === String(this.user.email ?? '').toLowerCase()) {
        return fail(409, 'REAL_ACCOUNT_EMAIL', 'That email belongs to a real account. Use an email nobody has verified on Clozest.')
      }
      if (this.testEmails.some((t) => t.email === email)) return fail(409, 'ALREADY_TEST_EMAIL', 'That email is a test email already.')
      this.testEmails.push({ email, label: cleanText(body.label), addedAt: new Date().toISOString(), inUse: false })
      return ok(201, this.testState())
    }
    const testEmail = p.match(/^\/admin\/test-mode\/emails\/([^/]+)$/)
    if (testEmail && method === 'DELETE') {
      if (!isSuper) return superOnly()
      this.testEmails = this.testEmails.filter((t) => t.email !== decodeURIComponent(testEmail[1]).toLowerCase())
      return ok(200, this.testState())
    }
    const testPhone = p.match(/^\/admin\/test-mode\/phones\/([^/]+)$/)
    if (testPhone && method === 'DELETE') {
      if (!isSuper) return superOnly()
      this.testPhones = this.testPhones.filter((t) => t.phone !== decodeURIComponent(testPhone[1]))
      return ok(200, this.testState())
    }

    return fail(404, 'NOT_FOUND', `No route ${method} ${p}`)
  }

  /** Support tickets (TicketService), newest last added. */
  tickets: MockTicket[] = []
  /** Support people marked away (TicketService.setAway): userId → since. */
  away = new Map<string, string>()
  /** Every reply sent, in order (one per tap that reached the backend). */
  replies: Array<{ id: string; body: string; resolve: boolean }> = []

  /** A ticket with one message from the person; open, given to `assigneeId` (default: the signed-in person). */
  addTicket(over: Partial<MockTicket> & { message?: string } = {}): MockTicket {
    const n = 1001 + this.tickets.length
    const at = over.createdAt ?? new Date(Date.now() - 3600_000).toISOString()
    const t: MockTicket = {
      id: `t${n}`,
      number: `CLZ-${n}`,
      subject: 'My booking shows cancelled',
      status: 'OPEN',
      source: 'CUSTOMER',
      requester: 'Ravi Customer',
      requesterId: 'c1',
      requesterEmail: 'ravi@gmail.com',
      assigneeId: this.user.id,
      createdAt: at,
      lastMessageAt: at,
      messages: [{ seq: 1, direction: 'IN', author: over.requester ?? 'Ravi Customer', body: over.message ?? 'The salon says it is fine but the app shows cancelled.', attachments: 0, senderVerified: true, at }],
      events: [{ event: 'CREATED', actor: null, detail: 'From the customer app', at }],
      profile: [{ order: 10, title: 'Account', lines: ['Name: Ravi Customer', 'Phone: 9811122233', 'Email: ravi@gmail.com (verified)'] }],
      emailsWaiting: 0,
      emailsFailed: 0,
      version: 0,
      ...over,
    }
    this.tickets.push(t)
    return t
  }

  /** The person wrote again (a reply to our email): the ticket waits on us again. */
  incoming(id: string, text: string) {
    const t = this.tickets.find((x) => x.id === id)!
    const at = new Date().toISOString()
    t.messages.push({ seq: t.messages.length + 1, direction: 'IN', author: t.requester, body: text, attachments: 0, senderVerified: true, at })
    t.status = 'OPEN'
    t.lastMessageAt = at
    t.version += 1
  }

  /** Field agents who work in a shop ("agentId:shopId"): never assigned it (409 OWN_SHOP). */
  agentWorksIn = new Set<string>()

  /** AdminTeamService.clean: the add/edit form's checks, field by field (a super admin's pincodes are ignored). */
  private checkMember(body: Json): { error?: Refusal; phone: string; member: Json } {
    const errors: Json = {}
    const digits = String(body.phone ?? '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '')
    if (!PHONE.test(digits)) errors.phone = 'enter a 10-digit Indian mobile number'
    // Emails.normalize: trimmed, lower case; local part, dot-separated labels, a 2+ letter top level
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!EMAIL.test(email) || email.length > 254) errors.email = 'enter a valid email address'
    if (textProblem(body.name, 2, 60)) errors.name = 'enter a name of 2 to 60 letters'
    const role = body.role
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') errors.role = 'choose Admin or Super admin'
    let pincodes: string[] = []
    if (role === 'ADMIN' && body.designation !== 'FIELD_AGENT' && body.designation !== 'SUPPORT') errors.designation = 'choose a designation'
    if (role === 'ADMIN' && body.designation === 'FIELD_AGENT') {
      const list = Array.isArray(body.pincodes) ? (body.pincodes as unknown[]).map((x) => String(x ?? '').trim()) : []
      const bad = list.filter((x) => !/^[1-9]\d{5}$/.test(x))
      pincodes = [...new Set(list)].sort()
      if (bad.length) errors.pincodes = `not valid pincodes: ${bad.slice(0, 10).join(', ')}`
      else if (!list.length) errors.pincodes = 'add at least one pincode'
      else if (pincodes.length > 300) errors.pincodes = 'at most 300 pincodes'
    }
    if (Object.keys(errors).length) {
      return { error: { status: 400, code: 'VALIDATION_FAILED', message: 'Some fields are not valid', details: errors }, phone: digits, member: {} }
    }
    return {
      phone: digits,
      member: { phone: digits, email, name: cleanText(String(body.name)), adminRole: role, designation: role === 'ADMIN' ? body.designation : null, pincodes, openTickets: 0 },
    }
  }

  /** Someone else's verified email (a customer's, another member's): 409 EMAIL_IN_USE. */
  private emailOfAnother(email: string, self: string | null): boolean {
    const holder = this.team.find((m) => String(m.email ?? '').toLowerCase() === email && m.emailVerified)
    return this.otherEmails.has(email) || (holder !== undefined && holder.userId !== self)
  }

  /** ShopAssignments.coverageAdded: businesses waiting with nobody in these pincodes go to this agent. */
  private pickUpUnassigned(m: Json, pincodes: string[]) {
    if (m.adminRole !== 'ADMIN') return
    for (const s of this.shops) {
      if (this.waits(s) && !s.assignedTo && pincodes.includes(s.pincode as string)) {
        const next = this.pick(s, null)
        if (next) s.assignedTo = { id: next.userId, name: next.name }
      }
    }
  }

  /**
   * ShopAssignments.coverageChanged: this member's waiting businesses in the pincodes taken away (all, when `removed`
   * is null) go by the rule; one a super admin sent them elsewhere stays.
   */
  private reassignFrom(m: Json, removed: string[] | null = null) {
    for (const s of this.shops) {
      if (!this.waits(s) || (s.assignedTo as Json | null)?.id !== m.userId) continue
      if (removed !== null && !removed.includes(s.pincode as string)) continue
      if (m.adminRole === 'ADMIN' && (m.pincodes as string[]).includes(s.pincode as string)) continue
      const next = this.pick(s, m)
      s.assignedTo = next ? { id: next.userId, name: next.name } : null
    }
  }

  /**
   * ShopAssignmentStore.pick: a field agent covering the business's pincode (not `except`, never one who works in it),
   * the fewest waiting (this business not counted), the longest on the team on a tie.
   */
  private pick(shop: Json, except: Json | null): Json | undefined {
    const waiting = (a: Json) => this.shops.filter((x) => x !== shop && this.waits(x) && (x.assignedTo as Json | null)?.id === a.userId).length
    return this.team
      .filter((a) => a !== except && a.adminRole === 'ADMIN' && (a.pincodes as string[]).includes(shop.pincode as string))
      .filter((a) => !this.agentWorksIn.has(`${a.userId as string}:${shop.id as string}`))
      .sort((a, b) => waiting(a) - waiting(b) || String(a.since).localeCompare(String(b.since)))[0]
  }

  /**
   * A page of a shop's timeline as ShopReviewStore.timeline: `at` descending, then seq descending (the newest made
   * first), everything before the cursor, 50 at most; `next` is the last entry's at and seq when there are more.
   */
  private timelinePage(shopId: string, after: { at: number; seq: number } | null): { items: Json[]; next: Json | null } {
    const timeline = this.extra.get(shopId)!.timeline
    // Entries get their seq in the order they were made: the list is newest first, so from its end
    for (let i = timeline.length - 1; i >= 0; i--) if (!this.seqOf.has(timeline[i])) this.seqOf.set(timeline[i], ++this.lastSeq)
    const seq = (e: Json) => this.seqOf.get(e)!
    const at = (e: Json) => micros(e.at as string)
    const rest = [...timeline]
      .sort((x, y) => at(y) - at(x) || seq(y) - seq(x))
      .filter((e) => after === null || at(e) < after.at || (at(e) === after.at && seq(e) < after.seq))
    const items = rest.slice(0, TIMELINE_PAGE)
    const last = items[items.length - 1]
    return { items, next: rest.length > TIMELINE_PAGE ? { afterAt: last.at, afterSeq: seq(last) } : null }
  }

  private cors() {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
      'Access-Control-Expose-Headers': 'Retry-After, ETag',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    }
  }
}
