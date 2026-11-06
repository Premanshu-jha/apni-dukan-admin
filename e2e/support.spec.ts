import { expect, signedIn, test } from './helpers'

const strikes = () => [
  { appointmentId: 'a1', bookingNo: 'K7M1QX', salonName: 'Shine Salon', kind: 'NO_SHOW', struckAt: '2026-11-01T06:00:00Z' },
  { appointmentId: 'a2', bookingNo: 'K7M2QX', salonName: 'Style Hub', kind: 'LATE_CANCEL', struckAt: '2026-11-03T09:30:00Z' },
]

test("support looks up a customer's strikes and removes one with a reason (a double tap removes once)", async ({ page, context, api }) => {
  api.customers.set('9811122233', { customerId: 'c1', blockedUntil: new Date(Date.now() + 3 * 86400_000).toISOString(), strikes: strikes() })
  await signedIn(context, api)
  await page.goto('/')
  await page.getByRole('link', { name: 'Support' }).click()
  const look = page.getByRole('button', { name: 'Look up' })
  await expect(look).toBeDisabled()
  await page.getByLabel("Customer's mobile number").fill('+91 98111 22233')
  await look.click()
  await expect(page.getByText(/Can't book until/)).toBeVisible()
  const list = page.getByRole('list', { name: 'Strikes' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list).toContainText('No-show')
  await expect(list).toContainText('Late cancel')
  await expect(list).toContainText('Shine Salon')
  expect(api.calls.find((c) => c.path.endsWith('/strikes/lookup'))?.body).toEqual({ phone: '9811122233' })

  api.slow.set('/remove', 500)
  await page.getByRole('button', { name: 'Remove strike K7M1QX' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Remove strike' }).click()
  await expect(sheet.getByText('Write why')).toBeVisible()
  await sheet.getByLabel('Why remove it').fill('Salon marked it by mistake')
  await sheet.getByRole('button', { name: 'Remove strike' }).dblclick()
  await expect(page.getByText('Strike K7M1QX removed.')).toBeVisible()
  expect(api.calledTimes('POST', '/api/v1/admin/salon/strikes/a1/remove')).toBe(1)
  expect(api.calls.find((c) => c.path.endsWith('/a1/remove'))?.body).toEqual({ reason: 'Salon marked it by mistake' })
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByText('Not blocked from booking.')).toBeVisible()
})

test('support: a number with no customer account (404 CUSTOMER_NOT_FOUND), no strikes, and offline', async ({ page, context, api }) => {
  api.customers.set('9811122233', { customerId: 'c1', blockedUntil: null, strikes: [] })
  await signedIn(context, api)
  await page.goto('/support')
  await page.getByLabel("Customer's mobile number").fill('9000011111')
  await page.getByRole('button', { name: 'Look up' }).click()
  await expect(page.getByText('No customer has an account with this number.')).toBeVisible()
  await page.getByLabel("Customer's mobile number").fill('9811122233')
  await page.getByRole('button', { name: 'Look up' }).click()
  await expect(page.getByText('No strikes.')).toBeVisible()
  api.offline = true
  await page.getByRole('button', { name: 'Look up' }).click()
  await expect(page.getByText("You're offline or the server can't be reached. Try again.")).toBeVisible()
})

test('support: a double submit sends one lookup; INVALID_PHONE on the field; a strike removed meanwhile', async ({ page, context, api }) => {
  api.customers.set('9811122233', { customerId: 'c1', blockedUntil: null, strikes: strikes() })
  await signedIn(context, api)
  await page.goto('/support')
  api.slow.set('/strikes/lookup', 600)
  await page.getByLabel("Customer's mobile number").fill('9811122233')
  await page.getByRole('button', { name: 'Look up' }).dblclick()
  await page.getByLabel("Customer's mobile number").press('Enter')
  await expect(page.getByRole('list', { name: 'Strikes' }).getByRole('listitem')).toHaveCount(2)
  expect(api.calledTimes('POST', '/api/v1/admin/salon/strikes/lookup')).toBe(1)
  api.slow.clear()

  // Removed by someone else while this sheet was open
  await page.getByRole('button', { name: 'Remove strike K7M1QX' }).click()
  await page.getByRole('dialog').getByLabel('Why remove it').fill('Salon mistake')
  api.customers.get('9811122233')!.strikes = api.customers.get('9811122233')!.strikes.filter((x) => x.appointmentId !== 'a1')
  await page.getByRole('dialog').getByRole('button', { name: 'Remove strike' }).click()
  await expect(page.getByText('This strike was already removed, maybe by someone else.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Strikes' }).getByRole('listitem')).toHaveCount(1)

  // The backend's own phone check (stricter than the screen's)
  api.failOnce.set('/strikes/lookup', { status: 400, code: 'INVALID_PHONE', message: 'Not a valid number.' })
  await page.getByRole('button', { name: 'Look up' }).click()
  const field = page.getByLabel("Customer's mobile number")
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('#customer-phone-error')).toHaveText("That isn't a valid mobile number. Check the 10 digits.")
})
