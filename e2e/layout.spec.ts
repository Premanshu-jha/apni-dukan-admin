import { expect, signedIn, test } from './helpers'

// The smallest common Android width
test.use({ viewport: { width: 360, height: 740 } })

const LONG = 'Shreeganeshkiranaandgeneralstoresnoida62' // 40 characters, no spaces
const URL_NOTE = 'See https://drive.example.com/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/visit-photos-for-this-shop'

async function noSidewaysScroll(page: import('@playwright/test').Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll).toBeLessThanOrEqual(client)
}

test('at 360px a 40-letter name with no spaces and a long URL in a note never scroll sideways', async ({ page, context, api }) => {
  const shop = api.addShop(
    { name: LONG, ownerName: LONG, area: LONG, addressLine: LONG, statusReason: URL_NOTE, status: 'DRAFT' },
    {
      changes: [{ field: 'name', label: 'Shop name', before: LONG, after: `${LONG}x` }],
      timeline: [{ at: new Date().toISOString(), event: 'NOTE', byName: LONG, byAdmin: true, reason: URL_NOTE, note: URL_NOTE, checklist: [] }],
    },
  )
  api.team.push({ userId: 'u7', name: LONG, phone: '9000000007', adminRole: 'ADMIN', since: '2026-10-05T05:00:00Z' })
  api.testPhones.push({ phone: '9000000099', label: LONG, addedAt: '2026-11-01T05:00:00Z', hasAccount: false })
  api.user = { ...api.user, name: LONG }
  await signedIn(context, api, 'SUPER_ADMIN')
  api.user = { ...api.user, name: LONG }

  await page.goto('/shops?type=KIRANA&group=SENT_BACK')
  await expect(page.getByText(LONG).first()).toBeVisible()
  await noSidewaysScroll(page)

  await page.goto(`/shops/${shop.id}`)
  await expect(page.getByRole('heading', { name: new RegExp(LONG) })).toBeVisible()
  await expect(page.getByText(URL_NOTE).first()).toBeVisible()
  await noSidewaysScroll(page)
  await page.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await noSidewaysScroll(page)
  await page.keyboard.press('Escape')

  for (const path of ['/team', '/test-mode', '/more']) {
    await page.goto(path)
    await expect(page.getByText(LONG).first()).toBeVisible()
    await noSidewaysScroll(page)
  }
  await page.goto('/team')
  await page.getByRole('button', { name: `Remove ${LONG}` }).click()
  await expect(page.getByRole('dialog', { name: `Remove ${LONG}?` })).toBeVisible()
  await noSidewaysScroll(page)
})
