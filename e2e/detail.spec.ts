import { expect, signedIn, test } from './helpers'
import { API } from './mockApi'

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
      previousShopPhotoUrl: `${API}/photos/old-shop.png`,
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
  await expect(changed.getByRole('img', { name: 'Old shop photo' })).toHaveAttribute('src', `${API}/photos/old-shop.png`)
  await expect(changed.getByRole('img', { name: 'New shop photo' })).toHaveAttribute('src', shop.shopPhotoUrl as string)
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
  // Salon counts
  const details = page.getByRole('region', { name: 'Details' })
  await expect(details).toContainText('Barbers')
  await expect(details).toContainText('2')
  await expect(details).toContainText('Services')
  await expect(details).toContainText('5')
  await page.getByRole('button', { name: 'Shop photo, tap to enlarge' }).click()
  const big = page.getByRole('dialog', { name: 'Shop photo' })
  await expect(big.getByRole('img', { name: 'Shop photo, large' })).toBeVisible()
  await big.getByRole('button', { name: 'Close' }).click()
  await expect(big).toBeHidden()
  // Waiting for a visit: these three, and Add note
  for (const name of ['Approve', 'Send back', 'Suspend', 'Add note']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reinstate' })).toBeHidden()
})

test('approve with an optional note: it goes live, the timeline shows it, the counts follow', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Internal note (optional)').fill('Met the owner, all good')
  await sheet.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Approved. The shop is live now.')).toBeVisible()
  const call = api.calls.find((c) => c.path === `/api/v1/admin/shops/${shop.id}/approve`)
  expect(call?.body).toEqual({ version: 3, note: 'Met the owner, all good' })
  await expect(page.getByText('Live', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeHidden()
  await expect(page.getByRole('list', { name: 'Timeline, newest first' }).getByRole('listitem').first()).toContainText('Approved by Asha Field')
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Live: 1' })).toBeVisible()
})

test('send back: checklist, a reason started from the ticks, checks before sending, then a sent-back draft has no decisions', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Send back', exact: true }).click()
  const sheet = page.getByRole('dialog')
  const reason = sheet.getByLabel('Reason for the owner')
  await sheet.getByRole('button', { name: 'Send back' }).click()
  await expect(sheet.getByText('Write a reason for the owner (at least 2 letters)')).toBeVisible()
  expect(api.calledTimes('POST', `/api/v1/admin/shops/${shop.id}/reject`)).toBe(0)

  await sheet.getByLabel("Photo doesn't show the name board").check()
  await sheet.getByLabel('Pin is in the wrong place').check()
  await expect(reason).toHaveValue("Photo doesn't show the name board. Pin is in the wrong place.")
  await reason.fill('Please retake the shop photo with the board, and move the pin to the door.')
  await sheet.getByLabel('Shop was shut').check()
  // Typed by hand: ticking more no longer rewrites it
  await expect(reason).toHaveValue('Please retake the shop photo with the board, and move the pin to the door.')
  await sheet.getByLabel('Internal note (optional)').fill('x'.repeat(501))
  await sheet.getByRole('button', { name: 'Send back' }).click()
  await expect(sheet.getByText('Keep the note under 500 letters (now 501)')).toBeVisible()
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
  await expect(first).toContainText('Shop was shut')
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
  await sheet.getByLabel('Shop was shut').check()
  await sheet.getByRole('button', { name: 'Suspend' }).click()
  await expect(page.getByText('Suspended. The owner sees your reason.')).toBeVisible()
  expect(api.calls.find((c) => c.path.endsWith('/suspend'))?.body).toEqual({ version: 3, reason: 'Shop was shut.', checklist: ['SHOP_SHUT'] })
  await page.getByRole('button', { name: 'Reinstate', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reinstate' }).click()
  await expect(page.getByText('Reinstated. It now waits for a re-check visit.')).toBeVisible()
  expect(api.calls.find((c) => c.path.endsWith('/reinstate'))?.body).toEqual({ version: 4 })
  await expect(page.getByText('Re-check after edit')).toBeVisible()
})

test('409 SHOP_CHANGED: the owner edited meanwhile; Reload shows it, what was typed is kept, and the new version is sent', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Send back', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Reason for the owner').fill('Pin is at the wrong building')
  api.ownerEdits(shop.id as string, { addressLine: 'Shop 14, Ithum Tower' })
  await page.getByRole('dialog').getByRole('button', { name: 'Send back' }).click()
  await expect(page.getByText('The owner changed something; reload and check again')).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(page.getByText('Shop 14, Ithum Tower')).toBeVisible()
  await expect(page.getByText('The owner changed something; reload and check again')).toBeHidden()
  await page.getByRole('button', { name: 'Send back', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('Reason for the owner')).toHaveValue('Pin is at the wrong building')
  await page.getByRole('dialog').getByRole('button', { name: 'Send back' }).click()
  await expect(page.getByText('Sent back to the owner with your reason.')).toBeVisible()
  const sent = api.calls.filter((c) => c.path.endsWith('/reject')).map((c) => (c.body as { version: number }).version)
  expect(sent).toEqual([3, 4])
})

test('409 WRONG_STATUS: someone else decided first; the shop reloads with its new buttons', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Gupta General Store' })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  // Another admin approved it a moment ago (status and version moved on)
  api.shops[0].status = 'APPROVED'
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText("This shop's status changed meanwhile")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible()
})

test('a double tap on Approve sends once', async ({ page, context, api }) => {
  const shop = api.addShop()
  await signedIn(context, api)
  api.slow.set('/approve', 600)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).dblclick()
  await expect(page.getByText('Approved. The shop is live now.')).toBeVisible()
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
  await expect(page.getByText('No such shop')).toBeVisible()
  const shop = api.addShop()
  api.failOnce.set(`/admin/shops/${shop.id}`, { status: 400, code: 'BAD', message: 'Could not read the shop.' })
  await page.goto(`/shops/${shop.id}`)
  await expect(page.getByText('Could not read the shop.')).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
})
