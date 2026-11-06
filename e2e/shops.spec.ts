import { atDashboard, expect, signedIn, test } from './helpers'
import type { MockApi } from './mockApi'

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

test('search by "#1042" and by a phone typed with +91 and spaces', async ({ page, context, api }) => {
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
})

/** n live salons; every 7 share a statusSince, so pages end inside a tie and the id decides. */
function liveSalons(api: MockApi, n: number, name = (i: number) => `Salon ${i + 1}`) {
  const base = Date.now() - 10 * 86400_000
  for (let i = 0; i < n; i++) {
    api.addShop({ type: 'SALON', status: 'APPROVED', name: name(i) }, { statusSince: new Date(base + Math.floor(i / 7) * 60_000).toISOString() })
  }
}

const LIVE = '/shops?type=SALON&group=LIVE'

test('120 shops come 50 at a time over 3 pages, longest waiting first, none twice', async ({ page, context, api }) => {
  liveSalons(api, 120)
  await signedIn(context, api)
  await page.goto(LIVE)
  const cards = page.getByRole('list', { name: 'Shops' }).getByRole('listitem')
  await expect(cards).toHaveCount(50)
  await expect(page.getByText('First 50 shops, longest waiting first')).toBeVisible()
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(cards).toHaveCount(100)
  await expect(cards.nth(50).getByRole('link')).toBeFocused()   // keyboard users land on the new ones
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(cards).toHaveCount(120)
  await expect(page.getByText('120 shops, longest waiting first')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show more shops' })).toBeHidden()
  // Every shop once, in the backend's order (statusSince, then id)
  const codes = (await cards.allTextContents()).map((t) => t.match(/#(\d+)/)![1])
  expect(new Set(codes).size).toBe(120)
  const sorted = [...api.shops].sort((a, b) =>
    Date.parse(api.extra.get(a.id as string)!.statusSince) - Date.parse(api.extra.get(b.id as string)!.statusSince) || (String(a.id) < String(b.id) ? -1 : 1))
  expect(codes).toEqual(sorted.map((s) => String(s.shopCode)))
  // The next page asked from where the last one ended, statusSince exactly as received
  const pages = api.calls.filter((c) => c.path.startsWith('/api/v1/admin/shops?')).map((c) => new URL(c.path, 'http://x').searchParams)
  const fiftieth = sorted[49]
  expect(pages[1].get('afterId')).toBe(fiftieth.id)
  expect(pages[1].get('afterSince')).toBe(api.extra.get(fiftieth.id as string)!.statusSince)
})

test('a failed "Show more shops" keeps the list and says so; offline says so; tapping again works', async ({ page, context, api }) => {
  liveSalons(api, 110)
  await signedIn(context, api)
  await page.goto(LIVE)
  const cards = page.getByRole('list', { name: 'Shops' }).getByRole('listitem')
  await expect(cards).toHaveCount(50)
  api.failShopPages = 3   // the first try and both automatic retries
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(page.getByRole('alert')).toContainText("Couldn't load more shops")
  await expect(cards).toHaveCount(50)   // still there, no error screen
  await expect(page.getByRole('button', { name: 'Show more shops' })).toBeFocused()   // focus stays to tap again
  await expect(page.getByRole('button', { name: 'Try again' })).toBeHidden()
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(cards).toHaveCount(100)
  await expect(page.getByRole('alert')).toBeHidden()

  api.offline = true
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(page.getByRole('button', { name: 'Loading more shops…' })).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('alert')).toContainText("You're offline", { timeout: 15_000 })
  await expect(cards).toHaveCount(100)
  api.offline = false
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(cards).toHaveCount(110)
})

test('"Show more shops" while the phone says it is offline says so at once; the note goes with a new search and stays gone', async ({ page, context, api }) => {
  liveSalons(api, 60, (i) => (i < 5 ? `Gupta Salon ${i + 1}` : `Salon ${i + 1}`))
  await signedIn(context, api)
  await page.goto(LIVE)
  const cards = page.getByRole('list', { name: 'Shops' }).getByRole('listitem')
  await expect(cards).toHaveCount(50)
  const before = api.calledTimes('GET', '/api/v1/admin/shops?')
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(page.getByRole('alert')).toContainText("You're offline")
  expect(api.calledTimes('GET', '/api/v1/admin/shops?')).toBe(before)   // nothing sent
  await context.setOffline(false)
  await page.getByLabel('Search').fill('gupta')
  await expect(cards).toHaveCount(5)
  await expect(page.getByRole('alert')).toHaveCount(0)
  // And once a page loads after coming back online
  await page.getByLabel('Search').fill('')
  await expect(cards).toHaveCount(50)
  await expect(page.getByRole('alert')).toHaveCount(0)   // back to the first list (cached, same count): no old note
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(page.getByRole('alert')).toContainText("You're offline")
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(cards).toHaveCount(60)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('the fake backend refuses half or unreadable cursors as the backend does', async ({ page, context, api }) => {
  liveSalons(api, 3)
  await signedIn(context, api)
  await page.goto(LIVE)
  await expect(page.getByRole('list', { name: 'Shops' }).getByRole('listitem')).toHaveCount(3)
  const auth = api.calls.find((c) => c.path.startsWith('/api/v1/admin/shops?'))!.auth!
  const ask = (query: string) =>
    page.evaluate(async ([q, a]) => {
      const res = await fetch(`http://api.test/api/v1/admin/shops?type=SALON&group=LIVE&${q}`, { headers: { Authorization: a } })
      return { status: res.status, body: await res.json() }
    }, [query, auth] as const)
  expect(await ask('afterId=shop1')).toEqual({ status: 400, body: { code: 'VALIDATION_FAILED', message: 'Some fields are not valid', details: { afterId: 'send afterSince and afterId together' } } })
  expect(await ask('afterSince=yesterday&afterId=shop1')).toEqual({ status: 400, body: { code: 'BAD_REQUEST', message: "'yesterday' is not a valid value for 'afterSince'", details: {} } })
  expect(await ask('afterSince=yesterday')).toEqual({ status: 400, body: { code: 'BAD_REQUEST', message: "'yesterday' is not a valid value for 'afterSince'", details: {} } })
  expect(await ask('afterSince=2026-11-01T04:30:00Z&afterId=not-an-id')).toEqual({ status: 400, body: { code: 'BAD_REQUEST', message: "'not-an-id' is not a valid value for 'afterId'", details: {} } })
})

test('exactly 50 shops: one more (empty) page, then the count and no button', async ({ page, context, api }) => {
  liveSalons(api, 50)
  await signedIn(context, api)
  await page.goto(LIVE)
  await expect(page.getByRole('list', { name: 'Shops' }).getByRole('listitem')).toHaveCount(50)
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(page.getByText('50 shops, longest waiting first')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show more shops' })).toBeHidden()
  // The button went with the empty page: focus moves to the count, not lost to the page
  await expect(page.getByText('50 shops, longest waiting first')).toBeFocused()
  expect(api.calledTimes('GET', '/api/v1/admin/shops?')).toBe(2)
})

test('a search starts again from the first page', async ({ page, context, api }) => {
  liveSalons(api, 130, (i) => (i % 2 ? `Gupta Salon ${i + 1}` : `Salon ${i + 1}`))
  await signedIn(context, api)
  await page.goto(LIVE)
  const cards = page.getByRole('list', { name: 'Shops' }).getByRole('listitem')
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(cards).toHaveCount(100)
  await page.getByLabel('Search').fill('gupta')
  // 65 match: the first 50 of them, asked without a cursor
  await expect(cards).toHaveCount(50)
  await expect(cards.first()).toContainText('Gupta Salon 2')
  const search = api.calls.filter((c) => c.path.includes('q=gupta'))
  expect(search).toHaveLength(1)
  expect(search[0].path).not.toContain('after')
  await page.getByRole('button', { name: 'Show more shops' }).click()
  await expect(cards).toHaveCount(65)
  await expect(page.getByText('65 shops, longest waiting first')).toBeVisible()
  // Another group starts from its own first page too
  await page.goto('/shops?type=SALON&group=SUSPENDED')
  await expect(page.getByText('Nothing here')).toBeVisible()
  expect(api.calls.filter((c) => c.path.includes('group=SUSPENDED')).every((c) => !c.path.includes('after'))).toBe(true)
})

test('a refresh answered 304 (nothing changed) keeps the shop on screen', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await expect(page.getByRole('heading', { name: 'Gupta General Store' })).toBeVisible()
  // Coming back to the app re-reads the shop, sending the ETag it got: the backend answers 304 with no body
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => api.notModified).toContain(`/api/v1/admin/shops/${shop.id}`)
  await expect(page.getByRole('heading', { name: 'Gupta General Store' })).toBeVisible()
  await expect(page.getByText(/Couldn't|Something went wrong/)).toBeHidden()
  // A change is a new fingerprint: the next read gets the whole shop again
  api.ownerEdits(shop.id as string, { name: 'Gupta Store' })
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('heading', { name: 'Gupta Store' })).toBeVisible()
})
