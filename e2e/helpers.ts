import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { MockApi, type AdminRole } from './mockApi'

/**
 * Every test gets its own fake backend, attached to the browser context, and fails if the page's
 * Content-Security-Policy blocked anything (the built site carries it, so the tests run under it).
 */
export const test = base.extend<{ api: MockApi; cspClean: void }>({
  api: async ({ context }, use) => {
    const api = new MockApi()
    await api.attach(context)
    await use(api)
  },
  cspClean: [
    async ({ context }, use) => {
      const blocked: string[] = []
      context.on('console', (m) => {
        if (/Content Security Policy/i.test(m.text())) blocked.push(m.text())
      })
      await use()
      expect(blocked, 'blocked by the Content-Security-Policy').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

/**
 * Starts the test already signed in (complete profile) with this admin role. A super admin by default: they see every
 * business (a field agent, ADMIN, sees only those assigned to them; see fieldagent.spec.ts).
 */
export async function signedIn(context: BrowserContext, api: MockApi, role: AdminRole = 'SUPER_ADMIN') {
  api.user = MockApi.completeUser(role)
  api.setRole(role)
  const session = api.savedSession()
  await context.addInitScript((s) => {
    // Once per test (shared by all its tabs), so a reload or a second tab doesn't put the old token back.
    if (localStorage.getItem('e2e.seeded')) return
    localStorage.setItem('e2e.seeded', '1')
    localStorage.setItem('ada.session', s)
  }, session)
}

/** Signed in and on the dashboard. */
export async function atDashboard(page: Page, context: BrowserContext, api: MockApi, role: AdminRole = 'SUPER_ADMIN') {
  await signedIn(context, api, role)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Businesses' })).toBeVisible()
}

/** "6:30 PM" for an instant in India time, as the app writes it. */
export function istTime(instant: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(instant)).replace(/\s/g, ' ')
}
