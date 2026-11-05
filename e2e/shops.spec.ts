import { atDashboard, expect, signedIn, test } from './helpers'

test('the dashboard shows the five counts for kirana and salon, each opening its list', async ({ page, context, api }) => {
  api.addShop({ name: 'Gupta General Store' })
  api.addShop({ name: 'Sharma Kirana' }, { approvedBefore: true })
  api.addShop({ status: 'APPROVED' })
  api.addShop({ status: 'APPROVED' })
  api.addShop({ status: 'DRAFT', statusReason: 'Name board not visible' })
  api.addShop({ status: 'DRAFT' }) // registration not finished: in no group
  api.addShop({ type: 'SALON', name: 'Shine Salon' })
  api.addShop({ type: 'SALON', status: 'SUSPENDED', statusReason: 'Closed down' })
  await atDashboard(page, context, api)
  const counts = page.getByRole('list', { name: 'Kirana shops by group' })
  await expect(counts.getByRole('link', { name: 'Waiting for first visit: 1' })).toBeVisible()
  await expect(counts.getByRole('link', { name: 'Re-check after edit: 1' })).toBeVisible()
  await expect(counts.getByRole('link', { name: 'Sent back: 1' })).toBeVisible()
  await expect(counts.getByRole('link', { name: 'Live: 2' })).toBeVisible()
  await expect(counts.getByRole('link', { name: 'Suspended: 0' })).toBeVisible()

  await page.getByRole('tab', { name: 'Salon' }).click()
  await expect(page).toHaveURL(/type=SALON/)
  const salon = page.getByRole('list', { name: 'Salon shops by group' })
  await expect(salon.getByRole('link', { name: 'Waiting for first visit: 1' })).toBeVisible()
  await expect(salon.getByRole('link', { name: 'Suspended: 1' })).toBeVisible()
  await salon.getByRole('link', { name: 'Suspended: 1' }).click()
  await expect(page.getByRole('heading', { name: 'Salon: Suspended' })).toBeVisible()
  await expect.poll(() => api.calls.some((c) => c.path === '/api/v1/admin/shops?type=SALON&group=SUSPENDED')).toBe(true)
  // Back keeps the Salon tab
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('tab', { name: 'Salon' })).toHaveAttribute('aria-selected', 'true')
})

test('dashboard: loading, then an error with Try again, and offline', async ({ page, context, api }) => {
  await signedIn(context, api)
  api.slow.set('/admin/dashboard', 800)
  await page.goto('/')
  await expect(page.getByText('Loading…')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Live: 0' })).toBeVisible()
  api.slow.clear()

  // 4xx answers are not retried: shown at once
  api.failOnce.set('/admin/dashboard', { status: 400, code: 'BAD', message: 'The dashboard could not be read.' })
  await page.reload()
  await expect(page.getByText('The dashboard could not be read.')).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('link', { name: 'Live: 0' })).toBeVisible()

})

test("dashboard's own offline state, after the app has loaded", async ({ page, context, api }) => {
  await signedIn(context, api)
  await page.goto('/more')
  await expect(page.getByRole('heading', { name: 'More' })).toBeVisible()
  // The app is open; now the network goes, and the dashboard is opened for the first time
  api.offline = true
  await page.getByRole('link', { name: 'Shops' }).click()
  await expect(page.getByText("You're offline or the server can't be reached. Try again.")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('link', { name: /Live/ })).toBeHidden()
  api.offline = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('link', { name: 'Live: 0' })).toBeVisible()
})

test('the list: oldest first, shop number, name, area, how long, Re-check badge', async ({ page, context, api }) => {
  api.addShop({ name: 'Newer Store', area: 'Sector 18' }, { statusSince: new Date(Date.now() - 2 * 3600_000).toISOString() })
  const older = api.addShop({ name: 'Older Store', area: 'Sector 62' }, { statusSince: new Date(Date.now() - 3 * 86400_000).toISOString() })
  api.addShop({ name: 'Edited Store' }, { approvedBefore: true })
  await signedIn(context, api)
  await page.goto('/shops?type=KIRANA&group=FIRST_VISIT')
  const cards = page.getByRole('list', { name: 'Shops' }).getByRole('listitem')
  await expect(cards).toHaveCount(2)
  await expect(cards.nth(0)).toContainText('Older Store')
  await expect(cards.nth(0)).toContainText(`#${older.shopCode}`)
  await expect(cards.nth(0)).toContainText('Sector 62, Noida')
  // From statusSince (sent by the backend), not from when the shop was registered
  await expect(cards.nth(0)).toContainText('Waiting 3 days')
  await expect(cards.nth(1)).toContainText('Newer Store')
  await expect(cards.nth(1)).toContainText('Waiting 2 h')
  await expect(page.getByText('Re-check')).toBeHidden()

  await page.goto('/shops?type=KIRANA&group=RECHECK')
  await expect(page.getByRole('list', { name: 'Shops' })).toContainText('Edited Store')
  await expect(page.getByText('Re-check', { exact: true })).toBeVisible()
})

test('search asks once typing stops, by number, name, owner or phone; no match and empty say so', async ({ page, context, api }) => {
  const gupta = api.addShop({ name: 'Gupta General Store', ownerName: 'Ramesh Gupta', ownerPhone: '9811100001' })
  api.addShop({ name: 'Raju Provisions', ownerName: 'Raju', ownerPhone: '9811100002' })
  await signedIn(context, api)
  await page.goto('/shops?type=KIRANA&group=FIRST_VISIT')
  await expect(page.getByRole('list', { name: 'Shops' }).getByRole('listitem')).toHaveCount(2)
  const before = api.calledTimes('GET', '/api/v1/admin/shops?')
  await page.getByLabel('Search').pressSequentially('raju', { delay: 30 })
  await expect(page.getByRole('list', { name: 'Shops' }).getByRole('listitem')).toHaveCount(1)
  await expect(page).toHaveURL(/q=raju/)
  // One request for the whole word, not one per letter
  expect(api.calledTimes('GET', '/api/v1/admin/shops?') - before).toBe(1)
  await page.getByLabel('Search').fill(String(gupta.shopCode))
  await expect(page.getByRole('list', { name: 'Shops' })).toContainText('Gupta General Store')
  await page.getByLabel('Search').fill('00001')
  await expect(page.getByRole('list', { name: 'Shops' })).toContainText('Gupta General Store')
  await page.getByLabel('Search').fill('nobody')
  await expect(page.getByText('No shop matches')).toBeVisible()
  await page.goto('/shops?type=SALON&group=LIVE')
  await expect(page.getByText('Nothing here')).toBeVisible()
})

test('the list: error with Try again, offline, and a wrong address goes to the dashboard', async ({ page, context, api }) => {
  api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  api.failOnce.set('/admin/shops', { status: 400, code: 'VALIDATION_FAILED', message: 'Some fields are not valid', details: { group: 'is required' } })
  await page.goto('/shops?type=KIRANA&group=FIRST_VISIT')
  await expect(page.getByText('group is required.')).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Gupta General Store')).toBeVisible()
  // Offline while searching: says so, and Try again works once back online
  api.offline = true
  await page.getByLabel('Search').fill('gupta')
  await expect(page.getByText("You're offline or the server can't be reached. Try again.")).toBeVisible({ timeout: 15_000 })
  api.offline = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Gupta General Store')).toBeVisible()
  await page.goto('/shops?type=SHOES&group=LIVE')
  await expect(page.getByRole('heading', { name: 'Shops' })).toBeVisible()
})

test('search by "#1042", by a phone typed with +91 and spaces, and the 100-row cap', async ({ page, context, api }) => {
  const gupta = api.addShop({ name: 'Gupta General Store', ownerPhone: '9811100001' })
  api.addShop({ name: 'Raju Provisions', ownerPhone: '9822200002' })
  await signedIn(context, api)
  await page.goto('/shops?type=KIRANA&group=FIRST_VISIT')
  await page.getByLabel('Search').fill(`#${gupta.shopCode}`)
  await expect(page.getByRole('list', { name: 'Shops' }).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'Shops' })).toContainText('Gupta General Store')
  expect(api.calls.some((c) => c.path.includes(`q=%23${gupta.shopCode}`))).toBe(true)
  await page.getByLabel('Search').fill('+91 98222 00')
  await expect(page.getByRole('list', { name: 'Shops' })).toContainText('Raju Provisions')
  await expect(page.getByRole('list', { name: 'Shops' }).getByRole('listitem')).toHaveCount(1)

  for (let i = 0; i < 101; i++) api.addShop({ type: 'SALON', status: 'APPROVED', name: `Salon ${i}` })
  await page.goto('/shops?type=SALON&group=LIVE')
  await expect(page.getByRole('list', { name: 'Shops' }).getByRole('listitem')).toHaveCount(100)
  await expect(page.getByText('Showing the oldest 100. Search to find a shop further down.')).toBeVisible()
})
