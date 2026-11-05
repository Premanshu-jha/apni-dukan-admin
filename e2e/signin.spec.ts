import type { Page } from '@playwright/test'
import { MockApi } from './mockApi'
import { atDashboard, expect, signedIn, test } from './helpers'

test('an admin signs in with phone and code and lands on the dashboard', async ({ page, api }) => {
  api.user = MockApi.completeUser('ADMIN')
  api.setRole('ADMIN')
  await page.goto('/')
  await expect(page).toHaveURL(/\/signin$/)
  const send = page.getByRole('button', { name: 'Send code' })
  await expect(send).toBeDisabled()
  await page.getByLabel('Mobile number').fill('98480 12345')
  await send.click()
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible()
  await page.getByLabel('Code').fill('111111')
  await expect(page.getByText('That code is not right. 4 tries left.')).toBeVisible()
  // The wrong code is really cleared, so the next one is typed into an empty box
  await expect(page.getByLabel('Code')).toHaveValue('')
  await page.getByLabel('Code').pressSequentially('123456')
  await expect(page.getByRole('heading', { name: 'Shops' })).toBeVisible()
  expect(api.calls.find((c) => c.path === '/api/v1/auth/otp/send')?.body).toMatchObject({ phone: '9848012345' })
  expect(api.calledTimes('GET', '/api/v1/admin/me')).toBeGreaterThan(0)
})

test('someone not on the team sees "This is for the Apni Dukan team" and can only sign out; no admin call is made', async ({ page, api }) => {
  // A brand-new account (no email, no name) that isn't an admin: no email or name steps either.
  api.user = { ...MockApi.completeUser('NONE'), name: null, email: null, emailVerified: false }
  await page.goto('/signin')
  await page.getByLabel('Mobile number').fill('9848012345')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Code').fill('123456')
  await expect(page.getByRole('heading', { name: 'This is for the Apni Dukan team' })).toBeVisible()
  for (const path of ['/team', '/shops?type=KIRANA&group=LIVE', '/welcome/email', '/more']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'This is for the Apni Dukan team' })).toBeVisible()
  }
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  expect(api.calls.some((c) => c.path.startsWith('/api/v1/admin'))).toBe(false)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/signin$/)
  await expect(page.getByLabel('Mobile number')).toBeVisible()
})

test('someone added to the team while on the "not for you" screen gets in with Check again', async ({ page, context, api }) => {
  await signedIn(context, api, 'NONE')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'This is for the Apni Dukan team' })).toBeVisible()
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByText('This number is still not on the team.')).toBeVisible()
  api.setRole('ADMIN')
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('heading', { name: 'Shops' })).toBeVisible()
})

test('a new admin without a verified email does the email and name steps first', async ({ page, api }) => {
  api.user = { ...MockApi.completeUser('ADMIN'), name: null, email: null, emailVerified: false }
  await page.goto('/signin')
  await page.getByLabel('Mobile number').fill('9848012345')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Code').fill('123456')
  await expect(page.getByRole('heading', { name: 'Your email' })).toBeVisible()
  await page.getByLabel('Email').fill('asha@example.com')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Code').fill('654321')
  await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible()
  await page.getByLabel('Your name').fill('Asha')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'Shops' })).toBeVisible()
})

test('recovery with email: codes to the email and the new number, then in', async ({ page, api }) => {
  api.user = MockApi.completeUser('ADMIN')
  await page.goto('/signin')
  await page.getByRole('link', { name: 'Recover with your email' }).click()
  await page.getByLabel('Email on your account').fill('asha@example.com')
  await page.getByLabel('New mobile number').fill('9848012345')
  await page.getByRole('button', { name: 'Send codes' }).click()
  await page.getByLabel('Email code').fill('111111')
  await page.getByLabel('SMS code').fill('123456')
  await page.getByRole('button', { name: 'Recover account' }).click()
  await expect(page.getByText('A code is not right.')).toBeVisible()
  await page.getByLabel('Email code').fill('654321')
  await page.getByRole('button', { name: 'Recover account' }).click()
  await expect(page.getByRole('heading', { name: 'Shops' })).toBeVisible()
  expect(api.calls.find((c) => c.path === '/api/v1/auth/recover/complete')?.body).toMatchObject({ email: 'asha@example.com', newPhone: '9848012345' })
})

test('taken off the team: the old token gets 401, the refresh says NONE, /admin/me answers 403; the screen follows', async ({ page, context, api }) => {
  await atDashboard(page, context, api)
  api.removeFromTeam()
  await page.getByRole('link', { name: 'Support' }).click()
  await page.getByLabel("Customer's mobile number").fill('9811122233')
  await page.getByRole('button', { name: 'Look up' }).click()
  await expect(page.getByRole('heading', { name: 'This is for the Apni Dukan team' })).toBeVisible()
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('ada.session')))!)
  expect(saved.user.adminRole).toBe('NONE')
})

test('an open session whose next /admin/me answers 404 (revocation list down) moves to "not for the team" by itself', async ({ page, context, api }) => {
  await page.clock.install()
  await atDashboard(page, context, api)
  api.removeFromTeam({ redisDown: true })
  // No reload, no click: /admin/me is re-read every minute
  await page.clock.runFor(61_000)
  await expect(page.getByRole('heading', { name: 'This is for the Apni Dukan team' })).toBeVisible()
  expect(api.calls.filter((c) => c.path === '/api/v1/admin/me').length).toBeGreaterThanOrEqual(2)
})

test('a test account is signed out when test mode ends (refresh 401 TEST_MODE_OFF)', async ({ page, context, api }) => {
  api.testMode = { on: true, until: new Date(Date.now() + 3600_000).toISOString(), turnedOnByName: 'Meera Super' }
  api.signedInAsTestAccount = true
  api.testPhones.push({ phone: '9848012345', label: 'Play review', addedAt: '2026-11-01T05:00:00Z', hasAccount: true })
  await signedIn(context, api, 'NONE')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'This is for the Apni Dukan team' })).toBeVisible()
  api.testMode = { on: false, until: null, turnedOnByName: null }
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page).toHaveURL(/\/signin$/)
  expect(await page.evaluate(() => localStorage.getItem('ada.session'))).toBeNull()
})

test('an expired session refreshes once and carries on, in two tabs too', async ({ page, context, api }) => {
  await atDashboard(page, context, api)
  const second = await context.newPage()
  await second.goto('/more')
  await expect(second.getByRole('heading', { name: 'More' })).toBeVisible()
  api.expireAccess()
  await page.getByRole('link', { name: /Waiting for first visit/ }).click()
  await expect(page.getByRole('heading', { name: 'Kirana: Waiting for first visit' })).toBeVisible()
  await second.reload()
  await expect(second.getByText('Asha Field')).toBeVisible()
  const sent = api.calls.filter((c) => c.path === '/api/v1/auth/refresh').map((c) => (c.body as { refreshToken: string }).refreshToken)
  expect(sent.length).toBeGreaterThanOrEqual(2)
  expect(new Set(sent).size).toBe(sent.length)
})

test("a refused refresh signs out, and the next sign-in sees none of the old data", async ({ page, context, api }) => {
  api.addShop({ name: 'Gupta General Store' })
  await atDashboard(page, context, api)
  await page.getByRole('link', { name: 'Waiting for first visit: 1' }).click()
  await expect(page.getByText('Gupta General Store')).toBeVisible()
  api.expireAccess()
  api.refreshTokens.clear()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('link', { name: /Re-check after edit/ }).click()
  await expect(page).toHaveURL(/\/signin$/)
  await signInAgainWithListFailing(page, api)
})

test('More shows the name, phone and role; sign-out is immediate (even on a slow network) and leaves no cached data', async ({ page, context, api }) => {
  api.addShop({ name: 'Gupta General Store' })
  await atDashboard(page, context, api)
  await page.getByRole('link', { name: 'Waiting for first visit: 1' }).click()
  await expect(page.getByText('Gupta General Store')).toBeVisible()
  api.slow.set('/auth/logout', 10_000)
  await page.getByRole('link', { name: 'More' }).click()
  await expect(page.getByText('Asha Field')).toBeVisible()
  await expect(page.getByText('+91 98480 12345')).toBeVisible()
  await expect(page.getByText('Admin', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  // At once: not after the 10 s logout call
  await expect(page).toHaveURL(/\/signin$/, { timeout: 2000 })
  expect(await page.evaluate(() => localStorage.getItem('ada.session'))).toBeNull()
  await expect.poll(() => api.calledTimes('POST', '/api/v1/auth/logout')).toBe(1)
  await signInAgainWithListFailing(page, api)
})

/**
 * Signs in again in the same tab and opens the list the previous session had loaded, with the backend refusing it:
 * cached data would still show the old shop (with a "couldn't refresh" note); a cleared cache shows only the error.
 */
async function signInAgainWithListFailing(page: Page, api: MockApi) {
  await page.getByLabel('Mobile number').fill('9848012345')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Code').fill('123456')
  await expect(page.getByRole('heading', { name: 'Shops' })).toBeVisible()
  api.failOnce.set('/admin/shops', { status: 400, code: 'BAD', message: 'The list could not be read.' })
  await page.getByRole('link', { name: /Waiting for first visit/ }).click()
  await expect(page.getByText('The list could not be read.')).toBeVisible()
  await expect(page.getByText('Gupta General Store')).toBeHidden()
}

test('a page that does not exist says so', async ({ page, context, api }) => {
  await atDashboard(page, context, api)
  await page.goto('/nowhere')
  await expect(page.getByText('Page not found')).toBeVisible()
})

test('a shop link opened while signed out is kept by the guard and opened after sign-in', async ({ page, api }) => {
  const shop = api.addShop({ name: 'Gupta General Store' })
  api.user = MockApi.completeUser('ADMIN')
  api.setRole('ADMIN')
  await page.goto(`/shops/${shop.id}`)
  await expect(page).toHaveURL(/\/signin$/)
  expect(await page.evaluate(() => localStorage.getItem('ada.returnTo'))).toBe(`/shops/${shop.id}`)
  await page.getByLabel('Mobile number').fill('9848012345')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Code').fill('123456')
  await expect(page).toHaveURL(new RegExp(`/shops/${shop.id}$`))
  await expect(page.getByRole('heading', { name: /Gupta General Store/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('ada.returnTo'))).toBeNull()
})

test('a test account is signed out when its number is removed while it is signed in (refresh 401 TEST_MODE_OFF)', async ({ page, context, browser, api }) => {
  api.testMode = { on: true, until: new Date(Date.now() + 3600_000).toISOString(), turnedOnByName: 'Meera Super' }
  api.signedInAsTestAccount = true
  api.testPhones.push({ phone: '9848012345', label: 'Play review', addedAt: '2026-11-01T05:00:00Z', hasAccount: true })
  await signedIn(context, api, 'NONE')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'This is for the Apni Dukan team' })).toBeVisible()
  // Test mode stays on; still covered, so a fresh sign-in works
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByText('This number is still not on the team.')).toBeVisible()

  // The super admin removes the number on another phone, through the site
  const boss = await browser.newContext({ timezoneId: 'Asia/Kolkata' })
  await api.attach(boss)
  const bossUser = { id: 'u0', phone: '9000000001', name: 'Meera Super', email: 'm@example.com', emailVerified: true, admin: true, adminRole: 'SUPER_ADMIN' as const }
  const saved = JSON.stringify({ refreshToken: 'refresh-boss', user: bossUser })
  api.refreshTokens.set('refresh-boss', 'live')
  await boss.addInitScript((s) => localStorage.setItem('ada.session', s), saved)
  const bossPage = await boss.newPage()
  // The fake backend serves one person at a time: be the super admin while the other phone acts
  const testUser = api.user
  api.user = bossUser
  api.signedInAsTestAccount = false
  await bossPage.goto('/test-mode')
  await bossPage.getByRole('button', { name: 'Remove test number 98480 12345' }).click()
  await expect(bossPage.getByText('is no longer a test number; its test account was signed out.')).toBeVisible()
  await boss.close()
  api.user = testUser
  api.signedInAsTestAccount = true

  expect(api.testMode.on).toBe(true)
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page).toHaveURL(/\/signin$/)
  expect(await page.evaluate(() => localStorage.getItem('ada.session'))).toBeNull()
})
