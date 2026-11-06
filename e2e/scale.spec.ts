import type { Page } from '@playwright/test'
import { expect, signedIn, test } from './helpers'
import type { MockApi } from './mockApi'

/**
 * A shop with n notes on its timeline, newest first, three at each minute (so ties sit across page ends), each time
 * with microseconds as the backend sends them. The fake gives ties their seq in the order made (the list's end
 * first), so this list is also the backend's order.
 */
function longTimeline(api: MockApi, n: number) {
  const base = Date.parse('2026-11-01T04:30:00Z')
  const timeline = Array.from({ length: n }, (_, i) => ({
    at: new Date(base + Math.floor((n - 1 - i) / 3) * 60_000).toISOString().replace('.000Z', '.000123Z'),
    event: 'NOTE',
    byName: 'Asha Field',
    byAdmin: true,
    reason: null,
    note: `Note ${n - i}`,
    checklist: [],
  }))
  return api.addShop({ status: 'APPROVED' }, { timeline })
}

const entries = (page: Page) => page.getByRole('list', { name: 'Timeline, newest first' }).locator(':scope > li')
const notes = (page: Page) => entries(page).evaluateAll((els) => els.map((e) => e.textContent?.match(/Note \d+/)?.[0] ?? ''))
const timelineCalls = (api: MockApi, id: string) => api.calls.filter((c) => c.path.startsWith(`/api/v1/admin/shops/${id}/timeline`))

test('a long timeline: the first 50, then 50 earlier at a time from timelineNext; ties across the edge neither lost nor repeated; focus moves', async ({ page, context, api }) => {
  const shop = longTimeline(api, 120)
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await expect(entries(page)).toHaveCount(50)
  await page.getByRole('button', { name: 'Show earlier entries' }).click()
  await expect(entries(page)).toHaveCount(100)
  await expect(entries(page).nth(50)).toBeFocused()
  // The cursor is the shop page's timelineNext, sent back exactly as received
  const first = timelineCalls(api, shop.id as string)[0]
  expect(first.path).toMatch(/\?afterAt=2026-11-01T\d\d%3A\d\d%3A00\.000123Z&afterSeq=\d+$/)
  await page.getByRole('button', { name: 'Show earlier entries' }).click()
  await expect(entries(page)).toHaveCount(120)
  await expect(page.getByRole('button', { name: 'Show earlier entries' })).toBeHidden()
  expect(await notes(page)).toEqual(Array.from({ length: 120 }, (_, i) => `Note ${120 - i}`))
})

test('exactly 50 entries: no button (timelineNext is null); 51: one more page, then none', async ({ page, context, api }) => {
  const fifty = longTimeline(api, 50)
  const more = longTimeline(api, 51)
  await signedIn(context, api)
  await page.goto(`/shops/${fifty.id}`)
  await expect(entries(page)).toHaveCount(50)
  await expect(page.getByRole('button', { name: 'Show earlier entries' })).toHaveCount(0)
  await page.goto(`/shops/${more.id}`)
  await page.getByRole('button', { name: 'Show earlier entries' }).click()
  await expect(entries(page)).toHaveCount(51)
  await expect(entries(page).nth(50)).toBeFocused()
  await expect(page.getByRole('button', { name: 'Show earlier entries' })).toBeHidden()
})

test('a failed earlier page keeps the timeline and says so; offline says so at once; tapping again works', async ({ page, context, api }) => {
  const shop = longTimeline(api, 80)
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  api.failTimelinePages = 3 // the first try and both automatic retries
  await page.getByRole('button', { name: 'Show earlier entries' }).click()
  await expect(page.getByRole('button', { name: 'Loading earlier entries…' })).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('alert')).toContainText("Couldn't load earlier entries. Tap Show earlier entries to try again.")
  await expect(entries(page)).toHaveCount(50)
  await expect(page.getByRole('button', { name: 'Show earlier entries' })).toBeFocused()

  await context.setOffline(true)
  const before = timelineCalls(api, shop.id as string).length
  await page.getByRole('button', { name: 'Show earlier entries' }).click()
  await expect(page.getByRole('alert')).toContainText("You're offline")
  expect(timelineCalls(api, shop.id as string).length).toBe(before)
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Show earlier entries' }).click()
  await expect(entries(page)).toHaveCount(80)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a note added with several earlier pages loaded: they stay on screen while the new cursor catches up; each entry once, none missing', async ({ page, context, api }) => {
  const shop = longTimeline(api, 230)
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  for (const n of [100, 150, 200]) {
    await page.getByRole('button', { name: 'Show earlier entries' }).click()
    await expect(entries(page)).toHaveCount(n)
  }
  // Watch the timeline's length from here on: it must never drop
  await page.evaluate(() => {
    const list = document.querySelector('ol[aria-label="Timeline, newest first"]')!
    const w = window as unknown as { fewest: number }
    w.fewest = list.children.length
    new MutationObserver(() => {
      w.fewest = Math.min(w.fewest, list.children.length)
    }).observe(list, { childList: true })
  })
  const before = timelineCalls(api, shop.id as string).length
  api.slow.set('/timeline', 300) // the catch-up takes a moment
  await page.getByRole('button', { name: 'Add note' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Note').fill('Board is up now')
  await sheet.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByText('Note added.')).toBeVisible()
  await expect(entries(page).first()).toContainText('Board is up now')
  // The same three earlier pages again, after the new first 50: still 200 entries, the note first, then in order
  await expect.poll(() => timelineCalls(api, shop.id as string).length - before).toBe(3)
  await expect(page.getByRole('button', { name: 'Show earlier entries' })).toBeVisible()
  await expect(entries(page)).toHaveCount(200)
  expect(await notes(page)).toEqual(['', ...Array.from({ length: 199 }, (_, i) => `Note ${230 - i}`)])
  expect(await page.evaluate(() => (window as unknown as { fewest: number }).fewest)).toBeGreaterThanOrEqual(200)
  expect(timelineCalls(api, shop.id as string).length - before).toBe(3)
  await page.getByRole('button', { name: 'Show earlier entries' }).click()
  await expect(entries(page)).toHaveCount(231)
})

test('the fake backend refuses half or unreadable timeline cursors as the backend does', async ({ page, context, api }) => {
  const shop = longTimeline(api, 3)
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await expect(entries(page)).toHaveCount(3)
  const auth = api.calls.filter((c) => c.auth).at(-1)!.auth!
  const ask = (path: string) =>
    page.evaluate(
      async ([p, a]) => {
        const res = await fetch(`http://api.test/api/v1/admin${p}`, { headers: { Authorization: a } })
        return { status: res.status, body: await res.json() }
      },
      [path, auth] as const,
    )
  const t = `/shops/${shop.id}/timeline`
  expect(await ask(`${t}?afterAt=2026-11-01T04:30:00Z`)).toMatchObject({
    status: 400,
    body: { code: 'VALIDATION_FAILED', details: { afterSeq: 'send afterAt and afterSeq together' } },
  })
  expect(await ask(`${t}?afterAt=yesterday&afterSeq=3`)).toMatchObject({ status: 400, body: { code: 'BAD_REQUEST' } })
  expect(await ask(`${t}?afterAt=2026-11-01T04:30:00Z&afterSeq=x`)).toMatchObject({ status: 400, body: { code: 'BAD_REQUEST' } })
  expect(await ask(`${t}`)).toMatchObject({ status: 200, body: { next: null } })
  expect(await ask('/shops/nope/timeline')).toMatchObject({ status: 404 })
  // The shop list needs type and group, and a search of 3 letters (or a shop number)
  expect(await ask('/shops')).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED', details: { type: 'is required', group: 'is required' } } })
  expect(await ask('/shops?type=SALON&group=LIVE&q=ab')).toMatchObject({
    status: 400,
    body: { code: 'VALIDATION_FAILED', details: { q: 'type at least 3 letters' } },
  })
  expect(await ask('/shops?type=SALON&group=LIVE&q=%237')).toMatchObject({ status: 200 })
  expect(await ask('/shops?type=SALON&group=LIVE&q=42')).toMatchObject({ status: 200 })
})

test('search: 1 or 2 letters are not sent, with a hint; a shop number of any length is; 3 letters are', async ({ page, context, api }) => {
  api.addShop({ name: 'Gupta General Store' })
  const seven = api.addShop({ name: 'Raju Provisions' })
  await signedIn(context, api)
  await page.goto('/shops?type=KIRANA&group=FIRST_VISIT')
  await expect(page.getByRole('list', { name: 'Shops' }).getByRole('listitem')).toHaveCount(2)
  const search = page.getByLabel('Search')
  await search.fill('gu')
  await expect(page.getByText('Type at least 3 letters (or a shop number like #42).')).toBeVisible()
  await expect(search).toHaveAccessibleDescription('Type at least 3 letters (or a shop number like #42).')
  await page.waitForTimeout(600)
  expect(api.calls.some((c) => /[?&]q=/.test(c.path))).toBe(false)
  await expect(page.getByRole('list', { name: 'Shops' }).getByRole('listitem')).toHaveCount(2)
  await search.fill('gup')
  await expect(page.getByRole('list', { name: 'Shops' }).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByText('Type at least 3 letters (or a shop number like #42).')).toBeHidden()
  await search.fill(`#${seven.shopCode}`)
  await expect(page.getByRole('list', { name: 'Shops' })).toContainText('Raju Provisions')
})

test('a search the backend still refuses (400 q) says to type 3 letters, not "try again"', async ({ page, context, api }) => {
  api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  await page.goto('/shops?type=KIRANA&group=FIRST_VISIT')
  await expect(page.getByRole('list', { name: 'Shops' }).getByRole('listitem')).toHaveCount(1)
  api.failOnce.set('/admin/shops', { status: 400, code: 'VALIDATION_FAILED', message: 'Some fields are not valid', details: { q: 'type at least 3 letters' } })
  await page.getByLabel('Search').fill('ǵu')
  await expect(page.getByText('Type at least 3 letters', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
})

test('a busy backend (503 SERVICE_BUSY, Retry-After): the client waits and tries once, then the query waits Retry-After too', async ({ page, context, api }) => {
  api.addShop({ name: 'Gupta General Store' })
  api.busy.set('/admin/dashboard', { times: 2, retryAfter: 2 })
  await signedIn(context, api)
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Waiting for first visit: 1' })).toBeVisible({ timeout: 15_000 })
  const at = api.calls.filter((c) => c.path === '/api/v1/admin/dashboard').map((c) => c.at)
  expect(at).toHaveLength(3)
  expect(at[1] - at[0]).toBeGreaterThanOrEqual(1900) // the client's own wait
  expect(at[2] - at[1]).toBeGreaterThanOrEqual(1900) // the query's retry, after Retry-After (not 1 s)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
