import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { MockApi, type AdminRole } from './mockApi'

/** Every test gets its own fake backend, attached to the browser context. */
export const test = base.extend<{ api: MockApi }>({
  api: async ({ context }, use) => {
    const api = new MockApi()
    await api.attach(context)
    await use(api)
  },
})
export { expect }

/** Starts the test already signed in (complete profile) with this admin role. */
export async function signedIn(context: BrowserContext, api: MockApi, role: AdminRole = 'ADMIN') {
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
export async function atDashboard(page: Page, context: BrowserContext, api: MockApi, role: AdminRole = 'ADMIN') {
  await signedIn(context, api, role)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Shops' })).toBeVisible()
}

/** "6:30 PM" for an instant in India time, as the app writes it. */
export function istTime(instant: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(instant)).replace(/\s/g, ' ')
}
