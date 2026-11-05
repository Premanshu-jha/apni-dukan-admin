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
  await page.getByLabel('Code').fill('123456')
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

test('an admin taken off the team meanwhile sees "not for the team" (404 NOT_FOUND on /admin/me)', async ({ page, context, api }) => {
  await atDashboard(page, context, api)
  api.setRole('NONE')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'This is for the Apni Dukan team' })).toBeVisible()
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

test('a refused refresh signs out to the sign-in screen', async ({ page, context, api }) => {
  await atDashboard(page, context, api)
  api.expireAccess()
  api.refreshTokens.clear()
  await page.getByRole('link', { name: /Live/ }).click()
  await expect(page).toHaveURL(/\/signin$/)
})

test('More shows the name, phone and role, and signs out', async ({ page, context, api }) => {
  await atDashboard(page, context, api)
  await page.getByRole('link', { name: 'More' }).click()
  await expect(page.getByText('Asha Field')).toBeVisible()
  await expect(page.getByText('+91 98480 12345')).toBeVisible()
  await expect(page.getByText('Admin', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/signin$/)
  expect(api.calledTimes('POST', '/api/v1/auth/logout')).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('ada.session'))).toBeNull()
})

test('a page that does not exist says so', async ({ page, context, api }) => {
  await atDashboard(page, context, api)
  await page.goto('/nowhere')
  await expect(page.getByText('Page not found')).toBeVisible()
})
