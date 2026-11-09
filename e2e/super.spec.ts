import { atDashboard, expect, istTime, signedIn, test } from './helpers'
import { MockApi } from './mockApi'

test('a field agent has no Support, Team or Test mode, and their addresses go to the dashboard', async ({ page, context, api }) => {
  await atDashboard(page, context, api, 'ADMIN')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveText(['Businesses', 'More'].map((t) => new RegExp(t)))
  for (const path of ['/team', '/team/new', '/team/u5', '/test-mode', '/support']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Businesses' })).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
  }
  expect(
    api.calls.some((c) => ['/api/v1/admin/team', '/api/v1/admin/test-mode', '/api/v1/admin/salon'].some((p) => c.path.startsWith(p))),
  ).toBe(false)
})

test('a super admin made an ordinary admin meanwhile is sent out of Team (403 SUPER_ADMIN_ONLY)', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/more')
  await expect(page.getByRole('link', { name: 'Team' })).toBeVisible()
  api.setRole('ADMIN')
  await page.getByRole('link', { name: 'Team' }).click()
  await expect(page.getByRole('heading', { name: 'Businesses' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Team' })).toBeHidden()
})

test('a write refused with 403 SUPER_ADMIN_ONLY re-reads /admin/me at once and the guard moves them out', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team/new')
  await page.getByLabel('Name').fill('New Agent')
  await page.getByLabel('Mobile number').fill('9000000055')
  await page.getByLabel('Email').fill('new@example.com')
  await page.getByLabel('Pincodes they cover').fill('500072')
  await page.getByRole('button', { name: 'Add pincode' }).click()
  api.setRole('ADMIN')
  const meBefore = api.calledTimes('GET', '/api/v1/admin/me')
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.getByRole('heading', { name: 'Businesses' })).toBeVisible()
  expect(api.calledTimes('GET', '/api/v1/admin/me')).toBeGreaterThan(meBefore)
  await expect(page.getByRole('link', { name: 'Team' })).toBeHidden()
})

test('team: members with role, pincodes and waiting visits; remove with a confirm; never yourself', async ({ page, context, api }) => {
  api.team.push(MockApi.teamMember({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', pincodes: ['500072', '500085'], emailVerified: false, since: '2026-10-05T05:00:00Z' }))
  api.addShop({ assignedTo: { id: 'u7', name: 'Kiran Field' }, pincode: '500072' })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team')
  const team = page.getByRole('list', { name: 'Team' }).getByRole('listitem')
  await expect(team.first()).toContainText('Asha Field (you)')
  await expect(team.first()).toContainText('Super admin')
  await expect(team.first().getByRole('button', { name: /Remove/ })).toBeHidden()
  const kiran = team.filter({ hasText: 'Kiran Field' })
  await expect(kiran).toContainText('Field agent')
  await expect(kiran).toContainText('on the team since 5 Oct 2026')
  await expect(kiran).toContainText('2 pincodes: 500072, 500085')
  await expect(kiran).toContainText('1 waiting')
  await expect(kiran).toContainText('not confirmed yet')

  await page.getByRole('button', { name: 'Remove Kiran Field' }).click()
  const sheet = page.getByRole('dialog', { name: 'Remove Kiran Field?' })
  await expect(sheet).toContainText('signed out at once')
  await expect(sheet).toContainText('Their waiting visits go to other field agents')
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  expect(api.calledTimes('DELETE', '/api/v1/admin/team/')).toBe(0)
  await page.getByRole('button', { name: 'Remove Kiran Field' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('Kiran Field is off the team and was signed out.')).toBeVisible()
  await expect(team.filter({ hasText: 'Kiran Field' })).toHaveCount(0)
  // Nobody else covers 500072: the waiting business is unassigned now
  expect(api.shops.at(-1)!.assignedTo).toBeNull()
})

test('team: add a field agent with pincodes like a to-do list; the refusals show on their fields and nothing typed is lost', async ({ page, context, api }) => {
  api.testPhones.push({ phone: '9000000099', label: 'Play review', addedAt: '2026-11-01T05:00:00Z', hasAccount: true })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team')
  await page.getByRole('link', { name: 'Add a member' }).click()
  await expect(page.getByRole('heading', { name: 'Add a member' })).toBeVisible()
  // Checked before sending: nothing goes to the backend
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.getByText('Enter their name (at least 2 letters).')).toBeVisible()
  await expect(page.getByText('Add at least one pincode.')).toBeVisible()
  expect(api.calledTimes('POST', '/api/v1/admin/team')).toBe(0)

  await page.getByLabel('Name').fill('Sita Rao')
  await page.getByLabel('Mobile number').fill('+91 90000 00099')
  await page.getByLabel('Email').fill('sita@example.com')
  const pin = page.getByLabel('Pincodes they cover')
  const add = page.getByRole('button', { name: 'Add pincode' })
  await pin.pressSequentially('50a00 72')   // letters and spaces aren't taken
  await expect(pin).toHaveValue('500072')
  await pin.fill('')
  await pin.pressSequentially('5000721')   // a 7th digit isn't taken
  await expect(pin).toHaveValue('500072')
  await pin.press('Enter')
  const chips = page.getByRole('list', { name: 'Pincodes added' })
  await expect(chips.getByRole('listitem')).toHaveCount(1)
  await expect(add).toBeDisabled()
  await pin.fill('20130')
  await expect(add).toBeDisabled()   // 5 digits: not yet
  await pin.fill('201309')
  await add.click()
  await expect(chips).toContainText('also covered by Ravi Field')
  await expect(page.getByText('2 pincodes')).toBeVisible()
  // Pasting several at once adds each valid one and names the rest; a duplicate isn't added twice
  await pin.focus()
  await page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement
    const data = new DataTransfer()
    data.setData('text', '500085, 500072\n012345 50004')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(chips.getByRole('listitem')).toHaveCount(3)
  await expect(page.getByText('"012345", "50004" aren\'t valid pincodes')).toBeVisible()
  await page.getByRole('button', { name: 'Remove 500085' }).click()
  await expect(chips.getByRole('listitem')).toHaveCount(2)

  // A test number: refused on the phone field; everything typed stays
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.locator('#member-phone-error')).toHaveText("This is a test number, or an account made in test mode, so it can't be on the team.")
  await expect(page.getByLabel('Name')).toHaveValue('Sita Rao')
  await expect(chips.getByRole('listitem')).toHaveCount(2)
  // Another account's email: on the email field
  await page.getByLabel('Mobile number').fill('90000 00055')
  await page.getByLabel('Email').fill('owner@gmail.com')
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.locator('#member-email-error')).toHaveText('Another account already uses this email.')
  // Offline: a banner, and the form stays
  await page.getByLabel('Email').fill('sita@example.com')
  api.offline = true
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.getByText("You're offline or the server can't be reached. Try again.")).toBeVisible()
  await expect(chips.getByRole('listitem')).toHaveCount(2)
  api.offline = false
  const posts = api.calledTimes('POST', '/api/v1/admin/team')
  await page.getByRole('button', { name: 'Add to the team' }).dblclick()
  await expect(page.getByText('Sita Rao can sign in now with +91 90000 00055.')).toBeVisible()
  expect(api.calledTimes('POST', '/api/v1/admin/team')).toBe(posts + 1)   // the double tap sent once
  expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/admin/team').at(-1)?.body).toEqual({
    phone: '9000000055',
    email: 'sita@example.com',
    name: 'Sita Rao',
    role: 'ADMIN',
    designation: 'FIELD_AGENT',
    pincodes: ['500072', '201309'],
  })
  await expect(page.getByRole('list', { name: 'Team' })).toContainText('Sita Rao')
})

test('team: a super admin has no designation or pincodes; edit fixes a typo; a change made meanwhile is caught', async ({ page, context, api }) => {
  api.team.push(MockApi.teamMember({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', pincodes: ['500072'], since: '2026-10-05T05:00:00Z' }))
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team')
  await page.getByRole('link', { name: 'Edit Kiran Field' }).click()
  await expect(page.getByLabel('Mobile number')).toHaveValue('9000000007')
  await expect(page.getByRole('list', { name: 'Pincodes added' })).toContainText('500072')
  // Super admin: designation and pincodes go away from the form and aren't sent
  await page.getByRole('button', { name: 'Super admin' }).click()
  await expect(page.getByLabel('Pincodes they cover')).toBeHidden()
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Pincodes added' })).toContainText('500072')   // kept while switching
  await page.getByLabel('Mobile number').fill('9000000077')
  // Someone else saved a change meanwhile: 409 MEMBER_CHANGED, said plainly
  api.team.find((m) => m.userId === 'u7')!.version = 5
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Someone changed this member after you opened it.')).toBeVisible()
  await expect(page.getByLabel('Mobile number')).toHaveValue('9000000077')   // what was typed stays meanwhile
  await page.getByRole('button', { name: 'Load the latest' }).click()
  await expect(page.getByLabel('Mobile number')).toHaveValue('9000000007')
  await page.getByLabel('Mobile number').fill('9000000077')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved Kiran Field. They were signed out and confirm the new details at their next sign-in.')).toBeVisible()
  const sent = api.calls.filter((c) => c.method === 'PUT').at(-1)?.body as Record<string, unknown>
  expect(sent.version).toBe(5)
  expect(sent.phone).toBe('9000000077')
  // The phone of another account is refused on the field
  await page.goto('/team/u7')
  await page.getByLabel('Mobile number').fill('9811122233')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('#member-phone-error')).toHaveText('Another Clozest account already uses this number.')
})

test('team: move waiting visits to another agent; the coverage tab names who covers each pincode', async ({ page, context, api }) => {
  api.team.push(MockApi.teamMember({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', pincodes: ['500072'], since: '2026-10-05T05:00:00Z' }))
  api.team.push(MockApi.teamMember({ userId: 'u8', name: 'No Pins', phone: '9000000008', pincodes: [], since: '2026-10-06T05:00:00Z' }))
  api.addShop({ assignedTo: { id: 'u7', name: 'Kiran Field' }, pincode: '500072' })
  api.addShop({ assignedTo: { id: 'u7', name: 'Kiran Field' }, pincode: '500072' })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team')
  await page.getByRole('button', { name: "Move Kiran Field's waiting visits" }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('button', { name: 'Move' })).toBeDisabled()
  await sheet.getByRole('button', { name: /Ravi Field/ }).click()
  await sheet.getByRole('button', { name: 'Move' }).click()
  await expect(page.getByText('Moved 2 waiting visits to Ravi Field.')).toBeVisible()
  expect(api.calls.find((c) => c.path === '/api/v1/admin/assignments/move')?.body).toEqual({ fromAdminId: 'u7', toAdminId: 'u5' })

  await page.getByRole('tab', { name: 'Coverage' }).click()
  await expect(page).toHaveURL(/view=coverage/)
  await expect(page.getByText('No pincodes yet, so no businesses: No Pins.')).toBeVisible()
  const coverage = page.getByRole('list', { name: 'Coverage' })
  await expect(coverage.getByRole('listitem')).toHaveCount(2)
  await page.getByLabel('Find a pincode').fill('2013')
  await expect(coverage.getByRole('listitem')).toHaveCount(1)
  await expect(coverage).toContainText('Ravi Field')
  await page.getByLabel('Find a pincode').fill('99')
  await expect(page.getByText('Nobody covers it')).toBeVisible()
})

test('team: removing yourself is never offered, and refused if tried (409 CANT_REMOVE_YOURSELF)', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team')
  await expect(page.getByRole('button', { name: 'Remove Asha Field' })).toBeHidden()
  // The backend has the last word (a list from before an account merge, say)
  api.failOnce.set('/admin/team/u5', { status: 409, code: 'CANT_REMOVE_YOURSELF', message: "You can't remove yourself." })
  await page.getByRole('button', { name: 'Remove Ravi Field' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText("You can't remove yourself from the team. Ask another super admin.")).toBeVisible()
})

test('test mode: switch on for 1–8 hours, the red banner appears everywhere, then off and it goes', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/test-mode')
  for (const line of [
    /Test numbers and test emails take any 6-digit code while test mode is on\. No SMS or email\s+is sent\./,
    /Only numbers nobody has signed in with, and emails no real account has verified, can be added\. Recovery and\s+deleting an account always need real codes\./,
    'Test accounts are signed out when test mode ends or is switched off, or when their number is removed.',
  ]) {
    await expect(page.getByText(line)).toBeVisible()
  }
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
  // A number with a real account (a customer or a business)
  await page.getByLabel('Test number', { exact: true }).fill('9811122233')
  await page.getByRole('button', { name: 'Add test number' }).click()
  await expect(page.getByText('That number already has a real account (a customer or a business). Use a number nobody has signed in with.')).toBeVisible()
  // The label follows the text rule
  await page.getByLabel('Test number', { exact: true }).fill('9000000088')
  await page.getByLabel('Whose number').fill('#')
  await page.getByRole('button', { name: 'Add test number' }).click()
  await expect(page.getByText('Write at least 2 letters or digits')).toBeVisible()
  await page.getByLabel('Test number', { exact: true }).fill('9000000088')
  await page.getByLabel('Whose number').fill('QA phone')
  await page.getByRole('button', { name: 'Add test number' }).click()
  await expect(page.getByText('+91 90000 00088 is a test number now.')).toBeVisible()
  await expect(list).toContainText('QA phone')
  await expect(list).toContainText('No account yet')
  expect(api.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/test-mode/phones')).at(-1)?.body).toEqual({ phone: '9000000088', label: 'QA phone' })

  await page.getByRole('button', { name: 'Remove test number 90000 00099' }).click()
  await expect(page.getByText('+91 90000 00099 is no longer a test number; its test account was signed out.')).toBeVisible()
  await expect(list).not.toContainText('Play review')
  expect(api.calledTimes('DELETE', '/api/v1/admin/test-mode/phones/9000000099')).toBe(1)
})

test('test emails: add with a label, the refusals in words, remove', async ({ page, context, api }) => {
  api.testEmails.push({ email: 'qa@gmail.com', label: 'QA salon', addedAt: '2026-11-01T05:00:00Z', inUse: true })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/test-mode')
  const list = page.getByRole('list', { name: 'Test emails' })
  await expect(list).toContainText('qa@gmail.com')
  await expect(list).toContainText('QA salon')
  await expect(list).toContainText('In use')

  await page.getByRole('button', { name: 'Add test email' }).click()
  await expect(page.getByText('Enter an email address, like name@gmail.com')).toBeVisible()
  await expect(page.getByText('Say whose email this is')).toBeVisible()
  const email = page.getByLabel('Test email', { exact: true })
  await email.fill('owner@gmail.com')
  await page.getByLabel('Whose email').fill('Mine')
  await page.getByRole('button', { name: 'Add test email' }).click()
  await expect(page.getByText('That email belongs to a real account. Use an email nobody has verified on Clozest.')).toBeVisible()
  await email.fill('QA@gmail.com')
  await page.getByRole('button', { name: 'Add test email' }).click()
  await expect(page.getByText('This email is already a test email.')).toBeVisible()
  // The backend's own check of the address shows under the field
  await email.fill('tester@gmail.c')
  await page.getByRole('button', { name: 'Add test email' }).click()
  await expect(page.getByText('Enter an email address, like name@gmail.com')).toBeVisible()
  // A refusal for an email never shows under the test number's fields
  await expect(page.locator('#test-phone-error')).toHaveCount(0)
  await email.fill('  Tester.Two@Gmail.com ')
  await page.getByLabel('Whose email').fill('Play review')
  await page.getByRole('button', { name: 'Add test email' }).click()
  await expect(page.getByText('tester.two@gmail.com is a test email now.')).toBeVisible()
  await expect(list).toContainText('Play review')
  await expect(list).toContainText('Not used yet')
  await expect(email).toHaveValue('')
  expect(api.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/test-mode/emails')).at(-1)?.body)
    .toEqual({ email: 'tester.two@gmail.com', label: 'Play review' })

  await page.getByRole('button', { name: 'Remove test email qa@gmail.com' }).click()
  await expect(page.getByText('qa@gmail.com is no longer a test email.')).toBeVisible()
  await expect(list).not.toContainText('QA salon')
  expect(api.calledTimes('DELETE', '/api/v1/admin/test-mode/emails/qa%40gmail.com')).toBe(1)
})

test('test emails: a backend without the list shows none and the page still works', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  api.testEmailsMissing = true
  await page.goto('/test-mode')
  await expect(page.getByText('No test emails yet.')).toBeVisible()
  await expect(page.getByText('No test numbers yet.')).toBeVisible()
})

test('the banner follows /admin/me by itself: re-read every minute, and on coming back to the app', async ({ page, context, api }) => {
  await page.clock.install()
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/support')
  await expect(page.getByRole('heading', { name: 'Support' })).toBeVisible()
  const banner = page.getByRole('alert').filter({ hasText: 'OTP test mode is on until' })
  await expect(banner).toBeHidden()
  // Switched on elsewhere: the minute's re-read shows it, with no reload or click
  api.testMode = { on: true, until: new Date(Date.now() + 90 * 60_000).toISOString(), turnedOnByName: 'Meera Super' }
  await page.clock.runFor(61_000)
  await expect(banner).toContainText(istTime(api.testMode.until!))
  // Switched off elsewhere: coming back to the app (focus) re-reads it once it is 15 s old, before the next minute
  api.testMode = { on: false, until: null, turnedOnByName: null }
  const reads = api.calledTimes('GET', '/api/v1/admin/me')
  await page.clock.runFor(16_000)
  expect(api.calledTimes('GET', '/api/v1/admin/me')).toBe(reads)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(banner).toBeHidden()
  expect(api.calledTimes('GET', '/api/v1/admin/me')).toBe(reads + 1)
})

test('the banner goes by itself when the end time passes', async ({ page, context, api }) => {
  await page.clock.install()
  api.testMode = { on: true, until: new Date(Date.now() + 2 * 60_000).toISOString(), turnedOnByName: 'Meera Super' }
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/support')
  const banner = page.getByRole('alert').filter({ hasText: 'OTP test mode is on until' })
  await expect(banner).toBeVisible()
  await page.clock.fastForward(2 * 60_000 + 20_000)
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

test('team form: a pincode typed but not added is saved too; a half-typed one stops the save; Back never reopens a saved form', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team')
  await page.getByRole('link', { name: 'Add a member' }).click()
  await page.getByLabel('Name').fill('Sita Rao')
  await page.getByLabel('Mobile number').fill('9000000055')
  await page.getByLabel('Email').fill('sita@example.com')
  const pin = page.getByLabel('Pincodes they cover')
  await pin.fill('5000')
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.getByText('Finish the pincode "5000" (6 digits) and tap Add, or clear it.')).toBeVisible()
  expect(api.calledTimes('POST', '/api/v1/admin/team')).toBe(0)
  await pin.fill('500072')   // typed, Add not tapped
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.getByText('Sita Rao can sign in now')).toBeVisible()
  const sent = api.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/admin/team').at(-1)!.body as { pincodes: string[] }
  expect(sent.pincodes).toEqual(['500072'])
  // The form was replaced in the history, and the notice is shown once
  await page.goBack()
  await expect(page).not.toHaveURL(/\/team\/new$/)
  await page.goto('/team')
  await expect(page.getByText('Sita Rao can sign in now')).toBeHidden()
})

test('team form: a refusal about a field not on screen (designation) is said in the banner', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team/new')
  await page.getByLabel('Name').fill('Sita Rao')
  await page.getByLabel('Mobile number').fill('9000000055')
  await page.getByLabel('Email').fill('sita@example.com')
  await page.getByLabel('Pincodes they cover').fill('500072')
  api.failOnce.set('/admin/team', { status: 400, code: 'VALIDATION_FAILED', message: 'Some fields are not valid', details: { designation: 'choose a designation' } })
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.getByText('The designation: choose a designation.')).toBeVisible()
})

test('team form: "Load the latest" offline keeps what was typed and says why', async ({ page, context, api }) => {
  api.team.push(MockApi.teamMember({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', pincodes: ['500072'], since: '2026-10-05T05:00:00Z' }))
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team/u7')
  await page.getByLabel('Name').fill('Kiran F')
  api.team.find((m) => m.userId === 'u7')!.version = 3
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Someone changed this member after you opened it.')).toBeVisible()
  api.offline = true
  await page.getByRole('button', { name: 'Load the latest' }).click()
  await expect(page.getByText(/Couldn't load it:/)).toBeVisible()
  await expect(page.getByLabel('Name')).toHaveValue('Kiran F')
})

test('team: a super admin who makes themselves an admin is moved out of Team at once', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team/u1')
  await expect(page.getByText('This is you.')).toBeVisible()
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  await page.getByLabel('Pincodes they cover').fill('201309')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Only the businesses assigned to you')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Team' })).toBeHidden()
})

test('team: editing a test number in as the new phone is refused on the field (409 TEST_PHONE)', async ({ page, context, api }) => {
  api.testPhones.push({ phone: '9000000099', label: 'Play review', addedAt: '2026-11-01T05:00:00Z', hasAccount: false })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team/u5')
  await page.getByLabel('Mobile number').fill('9000000099')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('#member-phone-error')).toHaveText("This is a test number, or an account made in test mode, so it can't be on the team.")
})

test('team form: a member removed meanwhile keeps the form, and Save says they are off the team', async ({ page, context, api }) => {
  api.team.push(MockApi.teamMember({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', pincodes: ['500072'], since: '2026-10-05T05:00:00Z' }))
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team/u7')
  await page.getByLabel('Name').fill('Kiran F')
  api.team = api.team.filter((m) => m.userId !== 'u7')
  // A background re-read (coming back to the app) no longer lists them: the form and the typing stay
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByLabel('Name')).toHaveValue('Kiran F')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText("They're no longer on the team (another super admin removed them). Nothing was saved.")).toBeVisible()
  await expect(page.getByLabel('Name')).toHaveValue('Kiran F')
})

test('team form: switching a field agent with waiting visits to Super admin says where they go, and sends no pincodes', async ({ page, context, api }) => {
  api.team.push(MockApi.teamMember({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', pincodes: ['500072'], since: '2026-10-05T05:00:00Z' }))
  api.addShop({ assignedTo: { id: 'u7', name: 'Kiran Field' }, pincode: '500072' })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team/u7')
  await page.getByRole('button', { name: 'Super admin' }).click()
  await expect(page.getByText('Their 1 waiting visit goes to other field agents covering those pincodes, or to Unassigned.')).toBeVisible()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved Kiran Field.')).toBeVisible()
  const sent = api.calls.filter((c) => c.method === 'PUT').at(-1)!.body as { role: string; designation: unknown; pincodes: string[] }
  expect(sent).toMatchObject({ role: 'SUPER_ADMIN', designation: null, pincodes: [] })
})

test('team: move waiting visits says how many stayed, a retry with nothing left, and a removed target', async ({ page, context, api }) => {
  api.team.push(MockApi.teamMember({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', pincodes: ['500072'], since: '2026-10-05T05:00:00Z' }))
  const a = api.addShop({ assignedTo: { id: 'u7', name: 'Kiran Field' }, pincode: '500072' })
  api.addShop({ assignedTo: { id: 'u7', name: 'Kiran Field' }, pincode: '500072' })
  api.agentWorksIn.add(`u5:${a.id as string}`)
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team')
  await page.getByRole('button', { name: "Move Kiran Field's waiting visits" }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Ravi Field/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Move' }).click()
  await expect(page.getByText('Moved 1 waiting visit to Ravi Field. 1 stayed with Kiran Field: Ravi Field works there.')).toBeVisible()
  // The target was removed meanwhile: said in the sheet, and the list is read again
  await page.getByRole('button', { name: "Move Kiran Field's waiting visits" }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Ravi Field/ }).click()
  api.team = api.team.filter((m) => m.userId !== 'u5')
  await page.getByRole('dialog').getByRole('button', { name: 'Move' }).click()
  await expect(page.getByText("That person isn't a field agent on the team any more. Reload the team and choose again.")).toBeVisible()
})

test('team: an agent with no pincodes is flagged on their card', async ({ page, context, api }) => {
  api.team.push(MockApi.teamMember({ userId: 'u8', name: 'No Pins', phone: '9000000008', pincodes: [], since: '2026-10-06T05:00:00Z' }))
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team')
  await expect(page.getByRole('list', { name: 'Team' }).getByRole('listitem').filter({ hasText: 'No Pins' })).toContainText('No pincodes yet: gets no businesses')
})

test('team form: a pincode typed in the box past the 300 limit blocks Save', async ({ page, context, api }) => {
  const full = Array.from({ length: 300 }, (_, i) => String(400001 + i))
  api.team.push(MockApi.teamMember({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', pincodes: full, since: '2026-10-05T05:00:00Z' }))
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team/u7')
  await page.getByLabel('Pincodes they cover').fill('500072')
  const puts = api.calls.filter((c) => c.method === 'PUT').length
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('At most 300 pincodes: clear the one in the box or remove one first.')).toBeVisible()
  expect(api.calls.filter((c) => c.method === 'PUT').length).toBe(puts)
})
