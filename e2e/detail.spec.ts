import { expect, signedIn, test } from './helpers'
import { PHOTOS } from './mockApi'

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()

test('a re-check shows what changed first: old → new, how far the pin moved, old and new photos', async ({ page, context, api }) => {
  const shop = api.addShop(
    { name: 'Gupta General Store', addressLine: 'Shop 14, Ithum Tower', gstin: '09ABCDE1234F1Z5' },
    {
      approvedBefore: true,
      changes: [
        { field: 'addressLine', label: 'Address', before: 'Shop 12, Ithum Tower', after: 'Shop 14, Ithum Tower' },
        { field: 'gstin', label: 'GSTIN', before: null, after: '09ABCDE1234F1Z5' },
        { field: 'location', label: 'Location', before: null, after: null },
        { field: 'shopPhoto', label: 'Shop photo', before: null, after: null },
      ],
      pinMovedMetres: 350,
      previousShopPhotoUrl: `${PHOTOS}/old-shop.png`,
      timeline: [
        { at: at(60), event: 'EDITED', byName: 'Ravi Kumar', byAdmin: false, reason: null, note: null, checklist: [] },
        { at: at(3000), event: 'APPROVED', byName: 'Meera Super', byAdmin: true, reason: null, note: 'Board freshly painted', checklist: [] },
        { at: at(4000), event: 'SUBMITTED', byName: 'Ravi Kumar', byAdmin: false, reason: null, note: null, checklist: [] },
      ],
    },
  )
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await expect(page.getByRole('heading', { name: `#${shop.shopCode} Gupta General Store` })).toBeVisible()
  const changed = page.getByRole('region', { name: 'What changed' })
  await expect(changed).toContainText('Shop 12, Ithum Tower')
  await expect(changed).toContainText('changed to Shop 14, Ithum Tower')
  await expect(changed).toContainText('(empty)')
  await expect(changed).toContainText('Pin moved 350 m')
  await expect(changed.getByRole('img', { name: 'Old front photo' })).toHaveAttribute('src', `${PHOTOS}/old-shop.png`)
  await expect(changed.getByRole('img', { name: 'New front photo' })).toHaveAttribute('src', shop.shopPhotoUrl as string)
  // "What changed" comes before the photos
  const order = await page.locator('h2').allTextContents()
  expect(order.indexOf('What changed')).toBeLessThan(order.indexOf('Photos'))

  const timeline = page.getByRole('list', { name: 'Timeline, newest first' }).getByRole('listitem')
  await expect(timeline.nth(0)).toContainText('Owner changed it after approval')
  await expect(timeline.nth(1)).toContainText('Approved by Meera Super')
  await expect(timeline.nth(1)).toContainText('Only admins see this')
  await expect(timeline.nth(1)).toContainText('Board freshly painted')
  await expect(timeline.nth(2)).toContainText('Submitted by Ravi Kumar')
})

test('a first visit: photos enlarge, Navigate and Call owner links, details, no "What changed"', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Shine Salon', type: 'SALON', latitude: 28.6271, longitude: 77.3722, ownerPhone: '9811122233' })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await expect(page.getByRole('heading', { name: /Shine Salon/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'What changed' })).toBeHidden()
  const nav = page.getByRole('link', { name: 'Navigate' })
  await expect(nav).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=28.6271,77.3722')
  await expect(nav).toHaveAttribute('target', '_blank')
  await expect(page.getByRole('link', { name: 'Call owner' })).toHaveAttribute('href', 'tel:+919811122233')
  await expect(page.getByText('+91 98111 22233')).toBeVisible()
  // The salon: counts, hours, services with prices, ratings; and its registration document
  const salon = page.getByRole('region', { name: 'Salon', exact: true })
  await expect(salon).toContainText('2 barbers · 5 services · 4.4 ★ from 7 ratings')
  await expect(salon).toContainText('Sun')
  await expect(salon).toContainText('Closed')
  await expect(salon).toContainText('10:00 AM – 9:00 PM')
  await expect(salon).toContainText('Hair colour · 60 min')
  await expect(salon).toContainText('from ₹800')
  const doc = page.getByRole('region', { name: 'Registration document' })
  await expect(doc).toContainText('Trade licence')
  await expect(doc.getByRole('link', { name: 'Open' })).toHaveAttribute('target', '_blank')
  await page.getByRole('button', { name: 'Front photo, tap to enlarge' }).click()
  const big = page.getByRole('dialog', { name: 'Front photo' })
  await expect(big.getByRole('img', { name: 'Front photo, large' })).toBeVisible()
  await big.getByRole('button', { name: 'Close' }).click()
  await expect(big).toBeHidden()
  // Waiting for a visit: these three, and Add note
  for (const name of ['Approve', 'Send back', 'Suspend', 'Add note']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reinstate' })).toBeHidden()
})

test('approve with an optional note: it goes live, the timeline shows it, the list and counts follow without a reload', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  await page.goto('/')
  await page.getByRole('link', { name: 'Waiting for first visit: 1' }).click()
  await page.getByRole('link', { name: /Gupta General Store/ }).click()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Internal note (optional)').fill('Met the owner, all good')
  await sheet.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Approved. The business is live now.')).toBeVisible()
  const call = api.calls.find((c) => c.path === `/api/v1/admin/shops/${shop.id}/approve`)
  expect(call?.body).toEqual({ version: 3, note: 'Met the owner, all good' })
  await expect(page.getByText('Live', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeHidden()
  await expect(page.getByRole('list', { name: 'Timeline, newest first' }).getByRole('listitem').first()).toContainText('Approved by Asha Field')
  // Back through the app, within the lists' 10 s freshness: they were refreshed, not served from the cache
  await page.goBack()
  await expect(page.getByText('Nothing here')).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('link', { name: 'Live: 1' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Waiting for first visit: 0' })).toBeVisible()
})

test('send back: checklist, a reason started from the ticks, checks before sending, then a sent-back draft has no decisions', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Send back', exact: true }).click()
  const sheet = page.getByRole('dialog')
  const reason = sheet.getByLabel('Reason for the owner')
  await sheet.getByRole('button', { name: 'Send back' }).click()
  await expect(sheet.getByText('Write a reason for the owner')).toBeVisible()
  expect(api.calledTimes('POST', `/api/v1/admin/shops/${shop.id}/reject`)).toBe(0)

  await sheet.getByLabel("Photo doesn't show the name board").check()
  await sheet.getByLabel('Pin is in the wrong place').check()
  await expect(reason).toHaveValue("Photo doesn't show the name board. Pin is in the wrong place.")
  await reason.fill('Please retake the shop photo with the board, and move the pin to the door.')
  await sheet.getByLabel('Business was shut').check()
  // Typed by hand: ticking more no longer rewrites it
  await expect(reason).toHaveValue('Please retake the shop photo with the board, and move the pin to the door.')
  await sheet.getByLabel('Internal note (optional)').fill('x'.repeat(501))
  await sheet.getByRole('button', { name: 'Send back' }).click()
  await expect(sheet.getByText('Keep it under 500 characters (now 501)')).toBeVisible()
  await sheet.getByLabel('Internal note (optional)').fill('Owner was polite')
  await sheet.getByRole('button', { name: 'Send back' }).click()
  await expect(page.getByText('Sent back to the owner with your reason.')).toBeVisible()
  expect(api.calls.find((c) => c.path.endsWith('/reject'))?.body).toEqual({
    version: 3,
    reason: 'Please retake the shop photo with the board, and move the pin to the door.',
    checklist: ['NAME_BOARD_NOT_VISIBLE', 'PIN_WRONG', 'SHOP_SHUT'],
    note: 'Owner was polite',
  })
  await expect(page.getByText('The owner was told:')).toBeVisible()
  for (const name of ['Approve', 'Send back', 'Suspend', 'Reinstate']) await expect(page.getByRole('button', { name, exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Add note' })).toBeVisible()
  const first = page.getByRole('list', { name: 'Timeline, newest first' }).getByRole('listitem').first()
  await expect(first).toContainText('Sent back by Asha Field')
  await expect(first).toContainText('Business was shut')
  await expect(first).toContainText('Owner was polite')
})

test('a backend field refusal is spelled out (400 VALIDATION_FAILED)', async ({ page, context, api }) => {
  const shop = api.addShop({ status: 'APPROVED' })
  await signedIn(context, api)
  api.failOnce.set('/suspend', { status: 400, code: 'VALIDATION_FAILED', message: 'Some fields are not valid', details: { reason: 'must not contain links' } })
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Suspend', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Reason for the owner').fill('See www.example.com')
  await sheet.getByRole('button', { name: 'Suspend' }).click()
  await expect(sheet.getByText('The reason must not contain links.')).toBeVisible()
})

test('suspend a live shop, then reinstate it: it waits for a re-check', async ({ page, context, api }) => {
  const shop = api.addShop({ status: 'APPROVED', name: 'Gupta General Store' }, { approvedBefore: true })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Suspend', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Business was shut').check()
  await sheet.getByRole('button', { name: 'Suspend' }).click()
  await expect(page.getByText('Suspended. The owner sees your reason.')).toBeVisible()
  expect(api.calls.find((c) => c.path.endsWith('/suspend'))?.body).toEqual({ version: 3, reason: 'Business was shut.', checklist: ['SHOP_SHUT'] })
  await page.getByRole('button', { name: 'Reinstate', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reinstate' }).click()
  await expect(page.getByText('Reinstated. It now waits for a re-check visit.')).toBeVisible()
  expect(api.calls.find((c) => c.path.endsWith('/reinstate'))?.body).toEqual({ version: 4 })
  await expect(page.getByText('Re-check after edit')).toBeVisible()
})

test('409 SHOP_CHANGED: decisions stay off until Reload works; what was typed is kept and the new version is sent', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Send back', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Reason for the owner').fill('Pin is at the wrong building')
  api.ownerEdits(shop.id as string, { addressLine: 'Shop 14, Ithum Tower' })
  await page.getByRole('dialog').getByRole('button', { name: 'Send back' }).click()
  const banner = page.getByRole('alert').filter({ hasText: 'This business changed since you opened it (the owner or another admin). Reload and check again.' })
  await expect(banner).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()
  for (const name of ['Approve', 'Send back', 'Suspend']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  // A reload that fails keeps the banner, says why, and the buttons stay off
  api.failOnce.set(`/admin/shops/${shop.id}`, { status: 400, code: 'BAD', message: 'Could not read the shop.' })
  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(banner).toContainText("Couldn't reload: Could not read the shop.")
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(banner).toBeHidden()
  await expect(page.getByText('Shop 14, Ithum Tower')).toBeVisible()
  await page.getByRole('button', { name: 'Send back', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('Reason for the owner')).toHaveValue('Pin is at the wrong building')
  await page.getByRole('dialog').getByRole('button', { name: 'Send back' }).click()
  await expect(page.getByText('Sent back to the owner with your reason.')).toBeVisible()
  const sent = api.calls.filter((c) => c.path.endsWith('/reject')).map((c) => (c.body as { version: number }).version)
  expect(sent).toEqual([3, 4])
})

test('the version sent is the one on screen when the sheet opened, even after a background re-read', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  // The owner moves the pin while the sheet is open; the page re-reads in the background (back to the app)
  api.ownerEdits(shop.id as string, { latitude: 28.7 })
  const reads = api.calledTimes('GET', `/api/v1/admin/shops/${shop.id}`)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => api.calledTimes('GET', `/api/v1/admin/shops/${shop.id}`)).toBeGreaterThan(reads)
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  // Not approved blind: the backend refuses the old version and the admin is told to look again
  await expect(page.getByText('This business changed since you opened it')).toBeVisible()
  expect(api.calls.find((c) => c.path.endsWith('/approve'))?.body).toEqual({ version: 3 })
  expect(api.shops[0].status).toBe('PENDING_VISIT')
})

test('409 WRONG_STATUS: another admin decided first; the shop is re-read and says what it is now, and the counts follow', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  // Through the app (no reloads), so the dashboard and list are cached when the 409 comes
  await page.goto('/')
  await page.getByRole('link', { name: 'Waiting for first visit: 1' }).click()
  await page.getByRole('link', { name: /Gupta General Store/ }).click()
  await page.getByRole('button', { name: 'Send back', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Business was shut').check()
  // Another admin approved it a moment ago (the status, and with it the version, moved on)
  api.setStatus(shop.id as string, 'APPROVED')
  const reads = api.calledTimes('GET', `/api/v1/admin/shops/${shop.id}`)
  await page.getByRole('dialog').getByRole('button', { name: 'Send back' }).click()
  await expect(page.getByText('Someone else decided meanwhile: it is now Live.')).toBeVisible()
  await expect.poll(() => api.calledTimes('GET', `/api/v1/admin/shops/${shop.id}`)).toBeGreaterThan(reads)
  // Fields were fine, so the backend answered with the status (checked before the version)
  expect(api.calls.filter((c) => c.path.endsWith('/reject'))).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Send back', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeEnabled()
  // Back in the app (within the lists' 10 s freshness): the list and the counts were refreshed, not cached
  await page.goBack()
  await expect(page.getByText('Nothing here')).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('link', { name: 'Live: 1' })).toBeVisible()
})

test('WRONG_STATUS whose re-read fails keeps the banner and the buttons off until Reload works', async ({ page, context, api }) => {
  const shop = api.addShop()
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  api.setStatus(shop.id as string, 'SUSPENDED', 'Closed down')
  api.failOnce.set(`/admin/shops/${shop.id}`, { status: 400, code: 'BAD', message: 'Could not read the shop.' })
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  const banner = page.getByRole('alert').filter({ hasText: 'Someone else decided meanwhile: it is now Suspended.' })
  await expect(banner).toContainText("Couldn't reload")
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(banner).toBeHidden()
  await expect(page.getByRole('button', { name: 'Reinstate', exact: true })).toBeEnabled()
})

test('a double tap on Approve sends once', async ({ page, context, api }) => {
  const shop = api.addShop()
  await signedIn(context, api)
  api.slow.set('/approve', 600)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).dblclick()
  await expect(page.getByText('Approved. The business is live now.')).toBeVisible()
  expect(api.calledTimes('POST', `/api/v1/admin/shops/${shop.id}/approve`)).toBe(1)
})

test('add a note: needed, up to 500, shown as admins-only; a double tap adds one', async ({ page, context, api }) => {
  const shop = api.addShop({ status: 'DRAFT', statusReason: 'Board missing' })
  await signedIn(context, api)
  api.slow.set('/notes', 500)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Add note' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Add note' }).click()
  await expect(sheet.getByText('Write the note')).toBeVisible()
  await sheet.getByLabel('Note').fill('Owner says the board arrives Monday')
  await sheet.getByRole('button', { name: 'Add note' }).dblclick()
  await expect(page.getByText('Note added.')).toBeVisible()
  expect(api.calledTimes('POST', `/api/v1/admin/shops/${shop.id}/notes`)).toBe(1)
  const first = page.getByRole('list', { name: 'Timeline, newest first' }).getByRole('listitem').first()
  await expect(first).toContainText('Note by Asha Field')
  await expect(first).toContainText('Only admins see this')
})

test('a shop that does not exist, and a page that fails to load', async ({ page, context, api }) => {
  await signedIn(context, api)
  await page.goto('/shops/nope')
  await expect(page.getByText('No such business')).toBeVisible()
  const shop = api.addShop()
  api.failOnce.set(`/admin/shops/${shop.id}`, { status: 400, code: 'BAD', message: 'Could not read the shop.' })
  await page.goto(`/shops/${shop.id}`)
  await expect(page.getByText('Could not read the shop.')).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
})

test('weak network: the answer to Approve is lost but it went through; the re-read shows success', async ({ page, context, api }) => {
  const shop = api.addShop()
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  api.loseAnswer.add('/approve')
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Approved. The business is live now.')).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible()
  // Sent once: no blind retry of a write
  expect(api.calledTimes('POST', `/api/v1/admin/shops/${shop.id}/approve`)).toBe(1)
})

test('weak network: offline when sending, so nothing went through; the form stays with what was typed', async ({ page, context, api }) => {
  const shop = api.addShop()
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Send back', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Reason for the owner').fill('Board not visible')
  api.offline = true
  await sheet.getByRole('button', { name: 'Send back' }).click()
  await expect(sheet.getByText("You're offline or the server can't be reached. Try again.")).toBeVisible()
  await expect(sheet.getByLabel('Reason for the owner')).toHaveValue('Board not visible')
  api.offline = false
  await sheet.getByRole('button', { name: 'Send back' }).click()
  await expect(page.getByText('Sent back to the owner with your reason.')).toBeVisible()
})

test('an admin taken off the team mid-decision is moved out (old token 401, refresh says NONE, /admin/me 403)', async ({ page, context, api }) => {
  const shop = api.addShop()
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  api.removeFromTeam()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('heading', { name: 'This is for the Clozest team' })).toBeVisible()
  expect(api.shops[0].status).toBe('PENDING_VISIT')
  await expect(page.getByText(shop.name as string)).toBeHidden()
})

test('a write refused with 404 (removed while the revocation list is down) re-reads /admin/me at once', async ({ page, context, api }) => {
  const shop = api.addShop()
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Add note' }).click()
  await page.getByRole('dialog').getByLabel('Note').fill('Visited, owner away')
  api.removeFromTeam({ redisDown: true })
  const meBefore = api.calledTimes('GET', '/api/v1/admin/me')
  await page.getByRole('dialog').getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByRole('heading', { name: 'This is for the Clozest team' })).toBeVisible()
  expect(api.calledTimes('GET', '/api/v1/admin/me')).toBeGreaterThan(meBefore)
})

test('the text rule: a note or reason of only symbols is refused before sending, and by the backend', async ({ page, context, api }) => {
  const shop = api.addShop()
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Suspend', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Reason for the owner').fill(' !!   ?? ')
  await sheet.getByLabel('Internal note (optional)').fill('.')
  await sheet.getByRole('button', { name: 'Suspend' }).click()
  await expect(sheet.getByText('Write at least 2 letters or digits')).toHaveCount(2)
  expect(api.calledTimes('POST', `/api/v1/admin/shops/${shop.id}/suspend`)).toBe(0)
  // Spaces are collapsed before sending, as the backend reads them
  await sheet.getByLabel('Reason for the owner').fill('  Shop   was\n shut ')
  await sheet.getByLabel('Internal note (optional)').fill('')
  await sheet.getByRole('button', { name: 'Suspend' }).click()
  await expect(page.getByText('Suspended. The owner sees your reason.')).toBeVisible()
  expect(api.calls.find((c) => c.path.endsWith('/suspend'))?.body).toEqual({ version: 3, reason: 'Shop was shut', checklist: [] })
})

test('a shop with no photos says so instead of empty boxes', async ({ page, context, api }) => {
  const shop = api.addShop({ ownerPhotoUrl: null, shopPhotoUrl: null })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await expect(page.getByText('No front photo')).toBeVisible()
  await expect(page.getByText('No owner photo')).toBeVisible()
  await expect(page.getByRole('button', { name: /tap to enlarge/ })).toHaveCount(0)
})

test('the photo dialog keeps focus on Close, Escape closes it, and focus goes back to the thumbnail', async ({ page, context, api }) => {
  const shop = api.addShop()
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  const thumb = page.getByRole('button', { name: 'Owner photo, tap to enlarge' })
  await thumb.click()
  const close = page.getByRole('dialog', { name: 'Owner photo' }).getByRole('button', { name: 'Close' })
  await expect(close).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Owner photo' })).toBeHidden()
  await expect(thumb).toBeFocused()
})

test.describe('on a phone set to New York time', () => {
  test.use({ timezoneId: 'America/New_York' })
  test('times are shown in India time', async ({ page, context, api }) => {
    const shop = api.addShop({ createdAt: '2026-11-01T19:00:00Z' }, {
      timeline: [{ at: '2026-11-05T13:00:00Z', event: 'SUBMITTED', byName: 'Ravi Kumar', byAdmin: false, reason: null, note: null, checklist: [] }],
    })
    await signedIn(context, api)
    await page.goto(`/shops/${shop.id}`)
    await expect(page.getByText('Thu 5 Nov, 6:30 PM')).toBeVisible()
    // 19:00 UTC on 1 Nov is already 2 Nov in India
    await expect(page.getByText('2 Nov 2026')).toBeVisible()
  })
})

test('403 OWN_SHOP: an admin who works in the shop is told plainly on the decision and the note, and stays signed in', async ({ page, context, api }) => {
  const shop = api.addShop()
  api.memberOf.add(shop.id as string)
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  const meReads = api.calledTimes('GET', '/api/v1/admin/me')
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  const told = /You work in this business \(as its owner, a helper or a barber\), so you can't decide on it or write notes about it\. Ask another admin\./
  await expect(page.getByRole('dialog').getByText(told)).toBeVisible()
  // Not a doubt about this person's role: /admin/me isn't read again for it
  expect(api.calledTimes('GET', '/api/v1/admin/me')).toBe(meReads)
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: 'Add note' }).click()
  await page.getByRole('dialog').getByLabel('Note', { exact: true }).fill('Owner is my cousin')
  await page.getByRole('dialog').getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByRole('dialog').getByText(told)).toBeVisible()
  expect(shop.status).toBe('PENDING_VISIT')
})

test('a hand-over in the timeline names the new owner', async ({ page, context, api }) => {
  const shop = api.addShop({ status: 'APPROVED' })
  api.extra.get(shop.id as string)!.timeline.unshift({
    at: new Date().toISOString(), event: 'HANDED_OVER', byName: 'Kavita Rao', byAdmin: false, reason: null, note: null, checklist: [],
  })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await expect(page.getByText('Handed over to Kavita Rao')).toBeVisible()
})

test('a salon’s page plays the owner’s salon video for the field team; a new one is named in what changed', async ({ page, context, api }) => {
  const salon = api.addShop(
    { name: 'Shine Unisex Salon', type: 'SALON' },
    {
      approvedBefore: true,
      changes: [
        { field: 'shopVideo', label: 'Salon video', before: null, after: null },
        { field: 'registrationDoc', label: 'Registration document', before: 'Trade licence', after: 'Trade licence' },
      ],
    },
  )
  const noVideo = api.addShop({ name: 'Royal Cuts', type: 'SALON' }, { videoUrl: null })
  const kirana = api.addShop({ name: 'Gupta General Store', type: 'KIRANA' })
  await signedIn(context, api)

  await page.goto(`/shops/${salon.id}`)
  const video = page.getByRole('region', { name: 'Salon video' }).locator('video')
  await expect(video).toHaveAttribute('src', new RegExp(`^${PHOTOS}/salon-${salon.id as string}\\.mp4\\?sig=\\d+$`))
  await expect(video).toHaveAttribute('controls', '')
  await expect(video).toHaveAttribute('playsinline', '')
  await expect(video).toHaveAttribute('preload', 'metadata')
  await expect(page.getByRole('region', { name: 'What changed' })).toContainText('The owner sent a new video. Watch it below.')
  // The same kind of document, a new file: said so, not "Trade licence → Trade licence"
  await expect(page.getByRole('region', { name: 'What changed' })).toContainText('The owner sent a new Trade licence. Open it below.')

  await page.goto(`/shops/${noVideo.id}`)
  await expect(page.getByRole('region', { name: 'Salon video' })).toContainText('No video yet')

  await page.goto(`/shops/${kirana.id}`)
  await expect(page.getByRole('heading', { name: `#${kirana.shopCode} Gupta General Store` })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Salon video' })).toHaveCount(0)
})

test('the playing salon video keeps its link when the page refreshes every 4 minutes', async ({ page, context, api }) => {
  const salon = api.addShop({ name: 'Shine Unisex Salon', type: 'SALON' })
  await signedIn(context, api)
  await page.clock.install()
  await page.goto(`/shops/${salon.id}`)
  const video = page.getByRole('region', { name: 'Salon video' }).locator('video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0)
  const src = await video.getAttribute('src')
  const signed = api.videoSigs
  await page.clock.fastForward('04:05')
  await expect.poll(() => api.videoSigs).toBeGreaterThan(signed)   // the page was read again, with a new link
  expect(await video.getAttribute('src')).toBe(src)
})

test('a salon video that can’t play here offers to open it on its own', async ({ page, context, api }) => {
  const salon = api.addShop({ name: 'Shine Unisex Salon', type: 'SALON' }, { videoUrl: `${PHOTOS}/broken.mp4` })
  await signedIn(context, api)
  await page.goto(`/shops/${salon.id}`)
  const section = page.getByRole('region', { name: 'Salon video' })
  await expect(section).toContainText("This video can't play here.")
  const open = section.getByRole('link', { name: 'Open video' })
  await expect(open).toHaveAttribute('href', new RegExp(`^${PHOTOS}/broken\\.mp4\\?sig=`))
  await expect(open).toHaveAttribute('target', '_blank')
  await expect(open).toHaveAttribute('rel', /noopener/)
})

test('a live salon’s new registration document: listed to check, marked as checked, or removed with a reason', async ({ page, context, api }) => {
  const salon = api.addShop({ name: 'Shine Unisex Salon', type: 'SALON', status: 'APPROVED' }, {
    registrationDoc: { type: 'UDYAM', label: 'Udyam certificate', url: `${PHOTOS}/udyam.pdf`, checkedAt: null },
  })
  const version = salon.version
  await page.clock.install()
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/?type=SALON')
  const list = page.getByRole('region', { name: /Registration documents to check: 1/ })
  await expect(list.getByRole('link', { name: /Shine Unisex Salon/ })).toBeVisible()
  // A document uploaded while the dashboard is open shows up on the 30-second refresh
  api.addShop({ name: 'Style Studio', type: 'SALON', status: 'APPROVED' }, {
    registrationDoc: { type: 'TRADE_LICENCE', label: 'Trade licence', url: `${PHOTOS}/licence.pdf`, checkedAt: null },
  })
  await page.clock.runFor(31_000)
  await expect(page.getByRole('region', { name: /Registration documents to check: 2/ })).toBeVisible()
  await page.getByRole('link', { name: /Shine Unisex Salon/ }).click()

  const doc = page.getByRole('region', { name: 'Registration document' })
  await expect(doc).toContainText('Not checked yet: customers see "Unregistered" until it is.')
  await doc.getByRole('button', { name: 'Mark as checked' }).click()
  await expect(page.getByText('Document marked as checked.')).toBeVisible()
  await expect(doc).toContainText('customers see "Registered"')
  expect(api.calls.find((c) => c.path === `/api/v1/admin/shops/${salon.id as string}/registration-document/check`)!.body).toMatchObject({ version })

  await doc.getByRole('button', { name: 'Remove' }).click()
  await expect(doc.getByRole('button', { name: 'Remove the document' })).toBeDisabled()   // a reason first
  await doc.getByLabel('Why (the owner is told)').fill('The certificate is for another shop.')
  await doc.getByRole('button', { name: 'Remove the document' }).click()
  await expect(page.getByText('Document removed. The owner was told why.')).toBeVisible()
  await expect(doc).toContainText('None added')
})

test('a live salon waiting for its re-check stays live: approving checks its changes, and it is never listed twice', async ({ page, context, api }) => {
  const shop = api.addShop(
    { status: 'APPROVED', type: 'SALON', name: 'Shine Unisex Salon' },
    {
      approvedBefore: true,
      rechecking: true,
      changes: [{ field: 'gstin', label: 'GSTIN', before: null, after: '27AAPFU0939F1ZV' }],
    },
  )
  await signedIn(context, api)
  await page.goto('/shops?type=SALON&group=RECHECK')
  await expect(page.getByText('Shine Unisex Salon')).toBeVisible()
  await page.goto('/shops?type=SALON&group=LIVE')
  await expect(page.getByText('Shine Unisex Salon')).toHaveCount(0)

  await page.goto(`/shops/${shop.id as string}`)
  await expect(page.getByText('Live while you re-check it: customers can book.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask the owner to fix', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send back', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reassign' })).toBeVisible()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Checked. The business stays live; the owner is told.')).toBeVisible()
  expect(shop.status).toBe('APPROVED')
  expect(api.extra.get(shop.id as string)!.rechecking).toBe(false)
  // Nothing waits any more: only Suspend
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible()
})

test('a field agent asks the owner to fix a live salon’s re-check: it stays live and waits; it is never sent back', async ({ page, context, api }) => {
  const shop = api.addShop(
    { status: 'APPROVED', type: 'SALON', name: 'Shine Unisex Salon', assignedTo: { id: api.user.id, name: api.user.name } },
    { approvedBefore: true, rechecking: true },
  )
  await signedIn(context, api, 'ADMIN')
  await page.goto(`/shops/${shop.id as string}`)
  await expect(page.getByRole('button', { name: 'Send back', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ask the owner to fix', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Reason for the owner').fill('The GSTIN doesn’t match the certificate.')
  await page.getByRole('dialog').getByRole('button', { name: 'Ask the owner to fix' }).click()
  await expect(page.getByText('Sent to the owner. The business stays live and waits here until you approve it.')).toBeVisible()
  expect(shop.status).toBe('APPROVED')
  expect(api.extra.get(shop.id as string)!.rechecking).toBe(true)
  await expect(page.getByRole('list', { name: 'Timeline, newest first' }).getByRole('listitem').first()).toContainText('Asked the owner to fix')
  // Still waiting: Approve when it is right
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
})
