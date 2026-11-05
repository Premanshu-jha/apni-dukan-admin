import type { BrowserContext, Route } from '@playwright/test'

/**
 * A fake backend for the end-to-end tests, answering exactly as the admin API contract says (paths, fields, status
 * codes and error codes; errors are {code, message, details}). Sign-in follows the partner app's fake. State lives
 * per test. Where the contract leaves something open, the choice is written next to it and listed in the README.
 */
export const API = 'http://api.test'
/** Photo links are https, like the real signed links (the site's CSP allows images from https only). */
export const PHOTOS = 'https://photos.test'
const P = '/api/v1'

export type AdminRole = 'NONE' | 'ADMIN' | 'SUPER_ADMIN'
export type Status = 'DRAFT' | 'PENDING_VISIT' | 'APPROVED' | 'SUSPENDED'
type Json = Record<string, unknown>

export interface MockUser {
  id: string
  phone: string
  name: string | null
  email: string | null
  emailVerified: boolean
  admin: boolean
  adminRole: AdminRole
}

export interface Call {
  method: string
  path: string
  body: unknown
  auth: string | null
}

/** The parts of a shop's page that are not the AdminShop itself. */
export interface ShopExtra {
  approvedBefore: boolean
  statusSince: string
  salon: { barbers: number; services: number } | null
  changes: Json[]
  pinMovedMetres: number | null
  previousOwnerPhotoUrl: string | null
  previousShopPhotoUrl: string | null
  timeline: Json[]
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

/** The backend's text rule: cleaned (trimmed, spaces collapsed), within the limits, at least 2 letters or digits. */
export function textProblem(value: unknown, min: number, max: number): string | null {
  const t = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (t.length < min || t.length > max) return `must be ${min} to ${max} characters`
  if ((t.match(/[\p{L}\p{N}]/gu) ?? []).length < 2) return 'must have at least 2 letters or digits'
  return null
}

const PHONE = /^[6-9]\d{9}$/

export class MockApi {
  user: MockUser = MockApi.completeUser('ADMIN')
  calls: Call[] = []
  shops: Json[] = []
  extra = new Map<string, ShopExtra>()
  team: Json[] = [
    { userId: 'u0', name: 'Meera Super', phone: '9000000001', adminRole: 'SUPER_ADMIN', since: '2026-10-01T05:00:00Z' },
  ]
  testMode: { on: boolean; until: string | null; turnedOnByName: string | null } = { on: false, until: null, turnedOnByName: null }
  testPhones: Json[] = []
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
  /** This person signed in as a test account: when test mode ends their refresh answers 401 TEST_MODE_OFF. */
  signedInAsTestAccount = false
  /** Next answer of a path (by suffix): a code + status, once. */
  failOnce = new Map<string, { status: number; code: string; message: string; details?: Json }>()
  private n = 0
  /** Access token → the adminRole it was issued with (as the real token's claim). */
  private access = new Map<string, AdminRole>()
  refreshTokens = new Map<string, 'live' | 'rotated'>()

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
    // One super admin: when this person is it, the default one steps aside.
    this.team = this.team.filter((m) => m.userId !== this.user.id && !(role === 'SUPER_ADMIN' && m.adminRole === 'SUPER_ADMIN'))
    if (role !== 'NONE') this.team.push(this.member())
  }

  private member(): Json {
    return { userId: this.user.id, name: this.user.name, phone: this.user.phone, adminRole: this.user.adminRole, since: '2026-10-02T05:00:00Z' }
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
      ...over,
    }
    this.shops.push(shop)
    this.extra.set(shop.id as string, {
      approvedBefore: false,
      statusSince: ago(3 * 24 * 60),
      salon: shop.type === 'SALON' ? { barbers: 2, services: 5 } : null,
      changes: [],
      pinMovedMetres: null,
      previousOwnerPhotoUrl: null,
      previousShopPhotoUrl: null,
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
        return 'LIVE'
      case 'SUSPENDED':
        return 'SUSPENDED'
      default:
        return null
    }
  }

  private view(shop: Json): Json {
    return { ...shop, group: this.groupOf(shop), statusSince: this.extra.get(shop.id as string)!.statusSince }
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
    await context.route(`${PHOTOS}/**`, (route) =>
      // A 1×1 PNG, so photos load without the internet.
      route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png' }, body: Buffer.from(PNG, 'base64') }),
    )
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
    return { ...this.testMode, phones: this.testPhones }
  }

  private async handle(route: Route) {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: this.cors() })
    const raw = req.postData()
    const body = raw ? JSON.parse(raw) : undefined
    const auth = req.headers()['authorization'] ?? null
    this.calls.push({ method, path: url.pathname + url.search, body, auth })
    const p = url.pathname.replace(P, '')
    for (const [suffix, ms] of this.slow) if (p.endsWith(suffix)) await new Promise((r) => setTimeout(r, ms))
    const lost = [...this.loseAnswer].find((suffix) => p.endsWith(suffix))
    if (lost) this.loseAnswer.delete(lost)
    const ok = (status: number, json?: unknown) =>
      lost
        ? route.abort('timedout')
        : route.fulfill({ status, headers: { ...this.cors(), 'Content-Type': 'application/json' }, body: json === undefined ? '' : JSON.stringify(json) })
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
      if (this.signedInAsTestAccount && !this.testModeOn()) return fail(401, 'TEST_MODE_OFF', 'Test mode is off. Sign in again.')
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
        testMode: { on, until: on ? this.testMode.until : null },
      })
    }

    if (p === '/admin/dashboard') {
      const counts = (type: string) => {
        const c: Json = { FIRST_VISIT: 0, RECHECK: 0, SENT_BACK: 0, LIVE: 0, SUSPENDED: 0 }
        for (const s of this.shops) {
          const g = this.groupOf(s)
          if (s.type === type && g) c[g] = (c[g] as number) + 1
        }
        return c
      }
      return ok(200, { KIRANA: counts('KIRANA'), SALON: counts('SALON') })
    }

    if (p === '/admin/shops' && method === 'GET') {
      const type = url.searchParams.get('type')
      const group = url.searchParams.get('group')
      const details: Json = {}
      if (type !== 'KIRANA' && type !== 'SALON') details.type = 'must be KIRANA or SALON'
      if (!['FIRST_VISIT', 'RECHECK', 'SENT_BACK', 'LIVE', 'SUSPENDED'].includes(group ?? '')) details.group = 'is required'
      if (Object.keys(details).length) return invalid(details)
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      // Shop number exactly ("1042" or "#1042"); owner phone in part (spaces, "+91", dashes ignored); name or owner name.
      const number = q.replace(/^#/, '')
      const digits = q.replace(/^\+91/, '').replace(/[\s-]/g, '')
      const list = this.shops
        .filter((s) => s.type === type && this.groupOf(s) === group)
        .filter((s) => {
          if (!q) return true
          if (/^\d+$/.test(number) && String(s.shopCode) === number) return true
          if (/^\d+$/.test(digits) && typeof s.ownerPhone === 'string' && s.ownerPhone.includes(digits)) return true
          return [s.name, s.ownerName].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
        })
        .sort((a, b) => Date.parse(this.extra.get(a.id as string)!.statusSince) - Date.parse(this.extra.get(b.id as string)!.statusSince))
        .slice(0, 100)
      return ok(200, list.map((s) => this.view(s)))
    }

    const shopPath = p.match(/^\/admin\/shops\/([^/]+)(?:\/(approve|reject|suspend|reinstate|notes))?$/)
    if (shopPath) {
      const shop = this.shops.find((s) => s.id === shopPath[1])
      if (!shop) return fail(404, 'NOT_FOUND', 'No such shop.')
      const x = this.extra.get(shop.id as string)!
      const action = shopPath[2]
      if (!action && method === 'GET') {
        return ok(200, {
          shop: this.view(shop),
          salon: x.salon,
          changes: x.changes,
          pinMovedMetres: x.pinMovedMetres,
          previousOwnerPhotoUrl: x.previousOwnerPhotoUrl,
          previousShopPhotoUrl: x.previousShopPhotoUrl,
          timeline: x.timeline,
        })
      }
      const note = typeof body?.note === 'string' ? body.note.trim().replace(/\s+/g, ' ') : ''
      if (action === 'notes' && method === 'POST') {
        const problem = textProblem(body.note, 2, 500)
        if (problem) return invalid({ note: problem })
        const entry = { at: new Date().toISOString(), event: 'NOTE', byName: this.user.name, byAdmin: true, reason: null, note, checklist: [] }
        x.timeline.unshift(entry)
        return ok(201, entry)
      }
      if (action && method === 'POST') {
        // Order of checks (the contract doesn't fix it): fields first, then the status, then the version.
        const reason = typeof body.reason === 'string' ? body.reason.trim().replace(/\s+/g, ' ') : ''
        const needsReason = action === 'reject' || action === 'suspend'
        const details: Json = {}
        if (typeof body.version !== 'number') details.version = 'is required'
        const reasonProblem = needsReason ? textProblem(body.reason, 2, 200) : null
        if (reasonProblem) details.reason = reasonProblem
        // A note is optional: empty means none; given, it follows the text rule (2–500).
        const noteProblem = note ? textProblem(note, 2, 500) : null
        if (noteProblem) details.note = noteProblem
        if (Object.keys(details).length) return invalid(details)
        const from: Record<string, Status[]> = {
          approve: ['PENDING_VISIT'],
          reject: ['PENDING_VISIT'],
          suspend: ['APPROVED', 'PENDING_VISIT'],
          reinstate: ['SUSPENDED'],
        }
        if (!from[action].includes(shop.status as Status)) {
          return fail(409, 'WRONG_STATUS', `The shop is ${shop.status}.`, { status: shop.status })
        }
        if (body.version !== shop.version) return fail(409, 'SHOP_CHANGED', 'The shop was changed. Reload and check again.')
        const to: Record<string, Status> = { approve: 'APPROVED', reject: 'DRAFT', suspend: 'SUSPENDED', reinstate: 'PENDING_VISIT' }
        const event: Record<string, string> = { approve: 'APPROVED', reject: 'SENT_BACK', suspend: 'SUSPENDED', reinstate: 'REINSTATED' }
        shop.status = to[action]
        shop.statusReason = needsReason ? reason : null
        shop.version = (shop.version as number) + 1
        x.statusSince = new Date().toISOString()
        if (action === 'approve') {
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
      return ok(200, [...this.team].sort((a, b) => Number(b.adminRole === 'SUPER_ADMIN') - Number(a.adminRole === 'SUPER_ADMIN')))
    }
    if (p === '/admin/team' && method === 'POST') {
      if (!isSuper) return superOnly()
      if (!PHONE.test(body.phone ?? '')) return fail(400, 'INVALID_PHONE', 'That is not a valid mobile number.')
      if (this.team.some((m) => m.phone === body.phone)) return fail(409, 'ALREADY_ADMIN', 'This number is already an admin.')
      if (this.testPhones.some((t) => t.phone === body.phone) || this.testAccounts.has(body.phone)) {
        return fail(409, 'TEST_PHONE', "A test number, or an account made in test mode, can't be an admin.")
      }
      const m = { userId: `u${++this.n}`, name: null, phone: body.phone, adminRole: 'ADMIN', since: new Date().toISOString() }
      this.team.push(m)
      return ok(201, m)
    }
    const member = p.match(/^\/admin\/team\/([^/]+)$/)
    if (member && method === 'DELETE') {
      if (!isSuper) return superOnly()
      const m = this.team.find((t) => t.userId === member[1])
      if (!m) return fail(404, 'NOT_FOUND', 'No such admin.')
      if (m.adminRole === 'SUPER_ADMIN') return fail(409, 'CANT_REMOVE_SUPER_ADMIN', "The super admin can't be removed.")
      this.team = this.team.filter((t) => t !== m)
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
      this.testPhones.push({ phone: body.phone, label: body.label.trim().replace(/\s+/g, ' '), addedAt: new Date().toISOString(), hasAccount: false })
      return ok(201, this.testState())
    }
    const testPhone = p.match(/^\/admin\/test-mode\/phones\/([^/]+)$/)
    if (testPhone && method === 'DELETE') {
      if (!isSuper) return superOnly()
      this.testPhones = this.testPhones.filter((t) => t.phone !== decodeURIComponent(testPhone[1]))
      return ok(200, this.testState())
    }

    return fail(404, 'NOT_FOUND', `No route ${method} ${p}`)
  }

  private cors() {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    }
  }
}
