import { expect, signedIn, test } from './helpers'

const DAY = 86_400_000

test('a salon’s page shows its subscription; an ordinary admin gets no end-trial button', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Shine Salon', type: 'SALON', status: 'APPROVED', assignedTo: { id: 'u1', name: 'Asha Field' } })
  api.subscriptions.set(shop.id as string, { trialEndsAt: new Date(Date.now() + 20 * DAY).toISOString(), paidUntil: null, status: null })
  await signedIn(context, api, 'ADMIN')
  await page.goto(`/shops/${shop.id}`)
  const section = page.getByRole('region', { name: 'Subscription' })
  await expect(section).toContainText('Free trial · ₹500 a month')
  await expect(section).toContainText(/Free trial until \d+ \w{3} \d{4}/)
  await expect(section.getByRole('button')).toHaveCount(0)
})

test('an unpaid salon says when it is (or would be) hidden, and a failed AutoPay in words', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Shine Salon', type: 'SALON', status: 'APPROVED' })
  api.subscriptions.set(shop.id as string, { trialEndsAt: new Date(Date.now() - 20 * DAY).toISOString(), paidUntil: null, status: 'HALTED' })
  api.subscriptionsEnforced = true
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  const section = page.getByRole('region', { name: 'Subscription' })
  await expect(section).toContainText('Not paid: hidden from customers · ₹500 a month')
  await expect(section).toContainText("The last AutoPay payment didn't go through.")
  await expect(section).toContainText('Razorpay: AutoPay stopped after failed charges')
})

test('a shop that isn’t a salon has no subscription section', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Kirana One', type: 'KIRANA', status: 'APPROVED' })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await expect(page.getByRole('heading', { name: /Kirana One/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Subscription' })).toHaveCount(0)
})

test('a super admin ends a test salon’s trial for the payment review; a real salon is refused', async ({ page, context, api }) => {
  const test1 = api.addShop({ name: 'Review Salon', type: 'SALON', status: 'APPROVED' })
  const real = api.addShop({ name: 'Real Salon', type: 'SALON', status: 'APPROVED' })
  for (const s of [test1, real]) api.subscriptions.set(s.id as string, { trialEndsAt: new Date(Date.now() + 20 * DAY).toISOString(), paidUntil: null, status: null })
  api.testSalons.add(test1.id as string)
  await signedIn(context, api, 'SUPER_ADMIN')
  page.on('dialog', (d) => void d.accept())

  await page.goto(`/shops/${test1.id}`)
  const section = page.getByRole('region', { name: 'Subscription' })
  await section.getByRole('button', { name: 'End trial now (test salon)' }).click()
  await expect(section).toContainText('Trial ended: the test number now sees the payment screen.')
  await expect(section).toContainText(/Not paid: would be hidden after \d{1,2} [A-Z][a-z]{2} \d{4}/)
  await expect(section.getByRole('button', { name: 'End trial now (test salon)' })).toHaveCount(0)

  // A real salon: no such button at all
  await page.goto(`/shops/${real.id}`)
  await expect(section).toContainText('Free trial · ₹500 a month')
  await expect(section.getByRole('button', { name: 'End trial now (test salon)' })).toHaveCount(0)
})

test('the subscription failing to load says so, with Try again', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Shine Salon', type: 'SALON', status: 'APPROVED' })
  api.subscriptions.set(shop.id as string, { trialEndsAt: new Date(Date.now() + 20 * DAY).toISOString(), paidUntil: null, status: null })
  await signedIn(context, api)
  await page.route('**/subscription', (route) => route.abort('internetdisconnected'))
  await page.goto(`/shops/${shop.id}`)
  const section = page.getByRole('region', { name: 'Subscription' })
  await expect(section).toContainText("Couldn't load the subscription")
  await page.unroute('**/subscription')
  await section.getByRole('button', { name: 'Try again' }).click()
  await expect(section).toContainText('Free trial · ₹500 a month')
})
