import { atDashboard, expect, istTime, signedIn, test } from './helpers'

test('an ordinary admin has no Team or Test mode, and their addresses go to the dashboard', async ({ page, context, api }) => {
  await atDashboard(page, context, api, 'ADMIN')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveText(['Shops', 'Support', 'More'].map((t) => new RegExp(t)))
  for (const path of ['/team', '/test-mode']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Shops' })).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
  }
  expect(api.calls.some((c) => c.path.startsWith('/api/v1/admin/team') || c.path.startsWith('/api/v1/admin/test-mode'))).toBe(false)
})

test('a super admin made an ordinary admin meanwhile is sent out of Team (403 SUPER_ADMIN_ONLY)', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/more')
  await expect(page.getByRole('link', { name: 'Team' })).toBeVisible()
  api.setRole('ADMIN')
  await page.getByRole('link', { name: 'Team' }).click()
  await expect(page.getByRole('heading', { name: 'Shops' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Team' })).toBeHidden()
})

test('team: list with the super admin first, add an admin, the refusals in words, remove with a confirm', async ({ page, context, api }) => {
  api.team.push({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', adminRole: 'ADMIN', since: '2026-10-05T05:00:00Z' })
  api.testPhones.push({ phone: '9000000099', label: 'Play review', addedAt: '2026-11-01T05:00:00Z', hasAccount: true })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team')
  const team = page.getByRole('list', { name: 'Team' }).getByRole('listitem')
  await expect(team.first()).toContainText('Asha Field (you)')
  await expect(team.first()).toContainText('Super admin')
  await expect(team.first().getByRole('button', { name: /Remove/ })).toBeHidden()

  const phone = page.getByLabel('Add an admin by mobile number')
  await phone.fill('9000000007')
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.getByText('This number is already on the team.')).toBeVisible()
  await phone.fill('9000000099')
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.getByText("This is a test number, and a test number can't be an admin. Remove it in Test mode first.")).toBeVisible()
  await phone.fill('90000 00055')
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.getByText('+91 90000 00055 is an admin now.')).toBeVisible()
  await expect(team).toHaveCount(3)
  expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/admin/team').map((c) => c.body)).toEqual([
    { phone: '9000000007' },
    { phone: '9000000099' },
    { phone: '9000000055' },
  ])

  await page.getByRole('button', { name: 'Remove Kiran Field' }).click()
  const sheet = page.getByRole('dialog', { name: 'Remove Kiran Field?' })
  await expect(sheet).toContainText('signed out at once')
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  expect(api.calledTimes('DELETE', '/api/v1/admin/team/')).toBe(0)
  await page.getByRole('button', { name: 'Remove Kiran Field' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('Kiran Field is off the team and was signed out.')).toBeVisible()
  await expect(team).toHaveCount(2)
})

test('team: removing someone who became the super admin meanwhile is refused (409 CANT_REMOVE_SUPER_ADMIN)', async ({ page, context, api }) => {
  api.team.push({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', adminRole: 'ADMIN', since: '2026-10-05T05:00:00Z' })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team')
  await page.getByRole('button', { name: 'Remove Kiran Field' }).click()
  api.team.find((m) => m.userId === 'u7')!.adminRole = 'SUPER_ADMIN'
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText("The super admin can't be removed from the team.")).toBeVisible()
})

test('test mode: switch on for 1–8 hours, the red banner appears everywhere, then off and it goes', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/test-mode')
  await expect(page.getByText(/signs in with any 6-digit code/)).toBeVisible()
  await expect(page.getByText('Off', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'OTP test mode is on' })).toBeHidden()
  await expect(page.getByLabel('Switch on for').locator('option')).toHaveCount(8)
  await page.getByLabel('Switch on for').selectOption('3')
  await page.getByRole('button', { name: 'Switch on for 3 hours' }).click()
  await expect(page.getByText('Test mode is on for 3 hours.')).toBeVisible()
  expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ hours: 3 })
  const banner = page.getByRole('alert').filter({ hasText: 'OTP test mode is on until' })
  await expect(banner).toContainText(istTime(api.testMode.until!))
  await expect(page.getByText('switched on by Asha Field')).toBeVisible()
  for (const path of ['/', '/shops?type=KIRANA&group=LIVE', '/support', '/team', '/more']) {
    await page.goto(path)
    await expect(banner).toBeVisible()
  }
  await page.goto('/test-mode')
  await page.getByRole('button', { name: 'Switch off now' }).click()
  await expect(page.getByText('Test mode is off.')).toBeVisible()
  await expect(banner).toBeHidden()
  expect(api.calledTimes('DELETE', '/api/v1/admin/test-mode')).toBe(1)
})

test('test numbers: add with a label, the refusals in words, remove', async ({ page, context, api }) => {
  api.testPhones.push({ phone: '9000000099', label: 'Play review', addedAt: '2026-11-01T05:00:00Z', hasAccount: true })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/test-mode')
  const list = page.getByRole('list', { name: 'Test numbers' })
  await expect(list).toContainText('+91 90000 00099')
  await expect(list).toContainText('Play review')
  await expect(list).toContainText('Has an account')

  await page.getByRole('button', { name: 'Add test number' }).click()
  await expect(page.getByText('Enter a 10-digit Indian mobile number')).toBeVisible()
  await expect(page.getByText('Say whose number this is')).toBeVisible()
  await page.getByLabel('Test number', { exact: true }).fill('9848012345')
  await page.getByLabel('Whose number').fill('My own')
  await page.getByRole('button', { name: 'Add test number' }).click()
  await expect(page.getByText("This number belongs to someone on the team, and an admin's number can't be a test number.")).toBeVisible()
  await page.getByLabel('Test number', { exact: true }).fill('9000000099')
  await page.getByRole('button', { name: 'Add test number' }).click()
  await expect(page.getByText('This number is already a test number.')).toBeVisible()
  await page.getByLabel('Test number', { exact: true }).fill('9000000088')
  await page.getByLabel('Whose number').fill('QA phone')
  await page.getByRole('button', { name: 'Add test number' }).click()
  await expect(page.getByText('+91 90000 00088 is a test number now.')).toBeVisible()
  await expect(list).toContainText('QA phone')
  await expect(list).toContainText('No account yet')
  expect(api.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/test-mode/phones')).at(-1)?.body).toEqual({ phone: '9000000088', label: 'QA phone' })

  await page.getByRole('button', { name: 'Remove test number 90000 00099' }).click()
  await expect(page.getByText('+91 90000 00099 is no longer a test number.')).toBeVisible()
  await expect(list).not.toContainText('Play review')
  expect(api.calledTimes('DELETE', '/api/v1/admin/test-mode/phones/9000000099')).toBe(1)
})

test('an ordinary admin sees the banner while test mode is on, with its end time', async ({ page, context, api }) => {
  api.testMode = { on: true, until: new Date(Date.now() + 90 * 60_000).toISOString(), turnedOnByName: 'Meera Super' }
  await signedIn(context, api, 'ADMIN')
  await page.goto('/support')
  const banner = page.getByRole('alert').filter({ hasText: 'OTP test mode is on until' })
  await expect(banner).toContainText(istTime(api.testMode.until!))
  // Someone switches it off: the next /admin/me says so, and the banner goes
  api.testMode = { on: false, until: null, turnedOnByName: null }
  await page.reload()
  await expect(banner).toBeHidden()
})

test('team and test mode: loading errors show Try again', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  api.failOnce.set('/admin/team', { status: 400, code: 'BAD', message: 'Team could not be read.' })
  await page.goto('/team')
  await expect(page.getByText('Team could not be read.')).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Asha Field (you)')).toBeVisible()
  api.failOnce.set('/admin/test-mode', { status: 400, code: 'BAD', message: 'Test mode could not be read.' })
  await page.goto('/test-mode')
  await expect(page.getByText('Test mode could not be read.')).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Off', { exact: true })).toBeVisible()
})
