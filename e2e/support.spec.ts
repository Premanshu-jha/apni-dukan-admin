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
  await expect(sheet.getByText('Write why (at least 2 letters)')).toBeVisible()
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
