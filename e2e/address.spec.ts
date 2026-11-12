import { expect, signedIn, test } from './helpers'

const request = (over: Record<string, unknown> = {}) => ({
  id: 'ar1',
  addressLine: 'Shop 3, Sector 18 Market',
  area: 'Sector 18',
  city: 'Noida',
  pincode: '201301',
  latitude: 28.57,
  longitude: 77.32,
  status: 'PENDING',
  reason: null,
  createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  decidedAt: null,
  ...over,
})

test('the owner’s address request: badge in the list, old and new with their pins, Approve applies it', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Shine Salon', type: 'SALON', status: 'APPROVED' }, { approvedBefore: true, rechecking: true, addressRequest: request() })
  await signedIn(context, api)
  await page.goto('/shops?type=SALON&group=RECHECK')
  const card = page.getByRole('link', { name: /Shine Salon/ })
  await expect(card.getByText('Address change')).toBeVisible()
  await card.click()

  const asked = page.getByRole('region', { name: 'The owner asks for a new address' })
  await expect(asked).toContainText('Shop 12, Ithum Tower, Sector 62, Noida 201309')
  await expect(asked).toContainText('Shop 3, Sector 18 Market, Sector 18, Noida 201301')
  await expect(asked.getByRole('link', { name: 'New pin' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=28.57,77.32')
  await expect(asked.getByRole('link', { name: 'Pin now' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=28.627,77.372')
  await expect(asked).toContainText(/The pin moves \d+(\.\d)? km/)

  // Approve says it applies the new address too
  await page.getByRole('button', { name: 'Approve' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText("The owner's new address (Shop 3, Sector 18 Market, Sector 18) becomes the business's address")
  await sheet.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Checked. The business stays live', { exact: false })).toBeVisible()
  expect(shop.addressLine).toBe('Shop 3, Sector 18 Market')
  await expect(asked).toBeHidden()
})

test('declining the owner’s address request asks for the reason; a request already gone says so', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Shine Salon', type: 'SALON', status: 'APPROVED' }, { approvedBefore: true, rechecking: true, addressRequest: request() })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  const asked = page.getByRole('region', { name: 'The owner asks for a new address' })
  await asked.getByRole('button', { name: 'Decline the new address' }).click()
  await expect(asked.getByRole('button', { name: 'Decline', exact: true })).toBeDisabled()
  await asked.getByLabel('Why (the owner is told)').fill('The board at the new place shows another salon.')
  await asked.getByRole('button', { name: 'Decline', exact: true }).click()
  await expect(page.getByText('Address change declined. The owner was told why', { exact: false })).toBeVisible()
  expect(shop.addressLine).toBe('Shop 12, Ithum Tower')
  await expect(asked).toBeHidden()
  // Still waiting for the rest of the re-check
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible()

  // Taken back by the owner meanwhile (the business gets a new version): the page says it changed, and reloads
  const other = api.addShop({ name: 'Style Point', type: 'SALON', status: 'APPROVED' }, { approvedBefore: true, rechecking: true, addressRequest: request() })
  await page.goto(`/shops/${other.id}`)
  const card = page.getByRole('region', { name: 'The owner asks for a new address' })
  await card.getByRole('button', { name: 'Decline the new address' }).click()
  await card.getByLabel('Why (the owner is told)').fill('Wrong pin.')
  api.extra.get(other.id as string)!.addressRequest = null
  other.version = (other.version as number) + 1
  await card.getByRole('button', { name: 'Decline', exact: true }).click()
  await expect(page.getByText('This business changed since you opened it', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(card).toBeHidden()
})

test('Change address can start from the owner’s request, and a change by someone else meanwhile is refused, not overwritten', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Shine Salon', type: 'SALON', status: 'APPROVED' }, { approvedBefore: true, rechecking: true, addressRequest: request() })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await expect(page.getByRole('link', { name: 'Navigate there' })).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=28.57,77.32')
  await page.getByRole('button', { name: 'Change address' }).click()
  await page.getByRole('button', { name: "Start from the owner's new address" }).click()
  await expect(page.getByLabel('Shop number, building, street')).toHaveValue('Shop 3, Sector 18 Market')
  await page.getByLabel('Shop number, building, street').fill('Shop 3A, Sector 18 Market')
  // Another admin changes the business meanwhile
  shop.version = (shop.version as number) + 1
  await page.getByRole('button', { name: 'Save the new address' }).click()
  await expect(page.getByText('This business changed since you opened it', { exact: false }).first()).toBeVisible()
  // What was typed stays; after Reload it saves
  await expect(page.getByLabel('Shop number, building, street')).toHaveValue('Shop 3A, Sector 18 Market')
  await page.getByRole('button', { name: 'Reload' }).click()
  await page.getByRole('button', { name: 'Save the new address' }).click()
  await expect(page.getByText('Address changed. Customers see the new one; the owner is told.')).toBeVisible()
  expect(shop.addressLine).toBe('Shop 3A, Sector 18 Market')
})

test('the field team changes the address themselves: checked on the page, the owner is told', async ({ page, context, api }) => {
  const shop = api.addShop({ name: 'Shine Salon', type: 'SALON', status: 'APPROVED' }, { approvedBefore: true })
  await signedIn(context, api)
  await page.goto(`/shops/${shop.id}`)
  await page.getByRole('button', { name: 'Change address' }).click()
  await expect(page.getByLabel('Shop number, building, street')).toHaveValue('Shop 12, Ithum Tower')
  // Saving what is there changes nothing
  await page.getByRole('button', { name: 'Save the new address' }).click()
  await expect(page.getByText('That is its address and pin now: change something first.')).toBeVisible()
  expect(shop.version).toBe(3)
  await page.getByLabel('Pincode').fill('20130')
  await page.getByLabel('Latitude').fill('50')
  await page.getByRole('button', { name: 'Save the new address' }).click()
  await expect(page.getByText('Enter the 6-digit pincode')).toBeVisible()
  await expect(page.getByText('A latitude in India, like 17.4401')).toBeVisible()
  await page.getByLabel('Pincode').fill('201301')
  await page.getByLabel('Latitude').fill('28.5701')
  await expect(page.getByRole('link', { name: 'Check the pin on Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=28.5701,77.372')
  await page.getByLabel('Shop number, building, street').fill('Shop 3, Sector 18 Market')
  await page.getByRole('button', { name: 'Save the new address' }).click()
  await expect(page.getByText('Address changed. Customers see the new one; the owner is told.')).toBeVisible()
  expect(shop.addressLine).toBe('Shop 3, Sector 18 Market')
  expect(shop.pincode).toBe('201301')
  await expect(page.getByRole('list', { name: 'Timeline, newest first' }).getByRole('listitem').first()).toContainText('Address changed by the field team')
})
