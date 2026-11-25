import { expect, signedIn, test } from './helpers'

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const thisMonth = () => today().slice(0, 7)

function money(source: string | null, grossPaise: number, payments: number, extra: Record<string, number> = {}) {
  return {
    source, payments, salons: payments, grossPaise, refundsPaise: 0, refundCount: 0, razorpayFeePaise: 0,
    googleFeeEstimatePaise: 0, netPaise: grossPaise, ...extra,
  }
}

test('a super admin finds Analytics from More and sees the money by month and source', async ({ page, context, api }) => {
  const web = money('WEBSITE', 1_00_000, 2, { razorpayFeePaise: 2_360, netPaise: 97_640 })
  const play = money('GOOGLE_PLAY', 50_000, 1, { googleFeeEstimatePaise: 7_500, netPaise: 42_500 })
  api.analytics.months = [
    { month: thisMonth(), total: money(null, 1_50_000, 3, { razorpayFeePaise: 2_360, googleFeeEstimatePaise: 7_500, netPaise: 1_40_140 }), bySource: [web, play] },
  ]
  api.analytics.recurring = { salons: 3, monthlyPaise: 1_50_000, bySource: [{ source: 'WEBSITE', salons: 2, monthlyPaise: 1_00_000 }, { source: 'GOOGLE_PLAY', salons: 1, monthlyPaise: 50_000 }] }
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/more')
  await page.getByRole('link', { name: 'Analytics' }).click()
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible()

  await expect(page.getByText('Coming in each month now')).toBeVisible()
  await expect(page.getByText('₹1,500', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('3 paid-up salons, at what each last paid')).toBeVisible()
  await expect(page.getByText(/Google.s fee is an estimate/)).toBeVisible()

  const month = page.getByRole('list', { name: 'Months' }).getByRole('listitem').first()
  await expect(month.getByText('₹1,401')).toBeVisible()
  await month.getByRole('button', { name: 'Show by payment source' }).click()
  await expect(month.getByText('Google Play')).toBeVisible()
  await expect(month.getByText('Razorpay (website)')).toBeVisible()

  // The CSV downloads with the sign-in (not a bare link)
  const download = page.waitForEvent('download')
  await month.getByRole('button', { name: 'Download payments (CSV)' }).click()
  expect((await download).suggestedFilename()).toBe(`clozest-payments-${thisMonth()}.csv`)
  const csvCall = api.calls.find((c) => c.path.endsWith(`/money/${thisMonth()}.csv`))
  expect(csvCall?.auth).toMatch(/^Bearer /)

  // Every call says it comes from the admin website
  expect(api.calls.filter((c) => c.path.startsWith('/api/v1/admin/analytics')).every((c) => c.client === 'admin-web')).toBe(true)

  // The chart can be read as a table
  await page.getByRole('button', { name: 'Show as a table' }).click()
  await expect(page.getByRole('row').filter({ hasText: '₹1,401' }).first()).toBeVisible()
})

test('Google’s fee rates are checked before saving, and another super admin’s change is never overwritten', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/analytics')
  await page.getByRole('button', { name: 'Change the rates' }).click()
  const sheet = page.getByRole('dialog', { name: 'Google’s fee rates' })
  const play = sheet.getByLabel('Google Play billing (%)')
  await play.fill('31')
  await expect(sheet.getByText('A number from 0 to 30, like 15')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Save rates' })).toBeDisabled()
  await play.fill('12.5')
  // Another super admin saved meanwhile
  api.analytics.fees = { ...api.analytics.fees, version: 1 }
  await sheet.getByRole('button', { name: 'Save rates' }).click()
  await expect(sheet.getByText(/Another super admin changed these/)).toBeVisible()
  expect(api.analytics.fees.playFeeBps).toBe(1500)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Change the rates' }).click()
  await page.getByRole('dialog').getByLabel('Google Play billing (%)').fill('12.5')
  await page.getByRole('dialog').getByRole('button', { name: 'Save rates' }).click()
  await expect(page.getByText('12.5%')).toBeVisible()
  expect(api.analytics.fees).toMatchObject({ playFeeBps: 1250, userChoiceFeeBps: 1100, version: 2 })
})

test('subscriptions show where salons stand, with the trials ending this week linked to the salon', async ({ page, context, api }) => {
  api.analytics.subscriptions = {
    ...api.analytics.subscriptions,
    trial: 4, trialWithAutoPay: 1, paying: 3, grace: 1, lapsed: 2, paymentProblems: 1,
    payingBySource: [{ source: 'WEBSITE', salons: 2, renewing: 2 }, { source: 'APP_RAZORPAY', salons: 0, renewing: 0 }, { source: 'GOOGLE_PLAY', salons: 1, renewing: 1 }],
    months: [{ month: thisMonth(), firstPayments: 2, stopped: 1 }],
    trialsEnding: [{ shopId: 's-ending', name: 'Sharp Cuts', area: 'Kondapur', pincode: '500084', ends: new Date(Date.now() + 3 * 86_400_000).toISOString(), state: 'TRIAL', source: 'WEBSITE' }],
    problems: [],
  }
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/analytics?s=subscriptions')
  await expect(page.getByText('In the free trial')).toBeVisible()
  await expect(page.getByText('1 already set up AutoPay')).toBeVisible()
  await expect(page.getByText('Razorpay (website) 2 · Google Play 1')).toBeVisible()
  await expect(page.getByRole('link', { name: /Sharp Cuts/ })).toHaveAttribute('href', '/shops/s-ending')
  await expect(page.getByText('None right now.')).toBeVisible()
})

test('bookings follow the days and the area picked, and the address keeps them', async ({ page, context, api }) => {
  const d = today()
  api.analytics.bookings = {
    created: [{ day: d, dim: '', value: 7 }],
    visits: [],
    visitsByStatus: [{ day: d, dim: 'BOOKING:COMPLETED', value: 5 }, { day: d, dim: 'BOOKING:NO_SHOW', value: 1 }],
    busiestHours: [{ day: d, dim: '18', value: 4 }],
    topAreas: [{ day: d, dim: '500084', value: 7 }],
  }
  api.analytics.byPincode['500084'] = { created: [{ day: d, dim: '500084', value: 7 }], visits: [{ day: d, dim: '500084', value: 6 }] }
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/analytics')
  await page.getByRole('button', { name: 'Bookings', exact: true }).click()
  await expect(page.getByText('Customer didn’t come', { exact: true })).toBeVisible()
  await expect(page.getByText('Bookings done', { exact: true })).toBeVisible()
  await expect(page.getByText('1. 500084')).toBeVisible()

  await page.getByRole('button', { name: 'Last 7 days' }).click()
  await expect(page).toHaveURL(/from=.*&to=/)
  expect(api.calls.some((c) => c.path.includes('/analytics/bookings?from=') && c.path.includes(`to=${d}`))).toBe(true)

  const area = page.getByLabel('Area (pincode)')
  await area.fill('5000')
  await expect(page.getByText('Type all 6 digits')).toBeVisible()
  await area.fill('500084')
  await expect(page.getByText('Bookings made in 500084')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Bookings made in 500084')).toBeVisible()
  await page.getByRole('button', { name: 'All areas' }).click()
  await expect(page.getByText('Bookings done', { exact: true })).toBeVisible()

  // A busiest area, tapped: only it
  await page.goto('/analytics?s=bookings')
  await page.getByRole('button', { name: /1\. 500084/ }).click()
  await expect(page.getByText('Bookings made in 500084')).toBeVisible()
  await page.getByRole('button', { name: 'All areas' }).click()

  // A day that doesn't exist in the address: the last 30 days instead, never a refused request
  await page.goto('/analytics?s=bookings&from=2026-02-30&to=2026-03-05')
  await expect(page.getByText('Bookings done', { exact: true })).toBeVisible()
  await page.getByLabel('Area (pincode)').fill('012345')
  await expect(page.getByText('Indian pincodes don’t start with 0')).toBeVisible()
  await page.getByLabel('Area (pincode)').fill('')

  // A range back to front isn't sent
  await page.getByLabel('From', { exact: true }).fill(d)
  await page.getByLabel('To', { exact: true }).fill('2025-01-01')
  await expect(page.getByText(/The first day is after the last one|Pick at most a year/)).toBeVisible()
})

test('salons are listed least used first, and the rest of the team never sees Analytics', async ({ page, context, api }) => {
  api.analytics.salons = [
    { shopId: 'busy', name: 'Busy Barbers', area: 'Kondapur', pincode: '500084', status: 'APPROVED', lastActiveDay: today(), bookings30d: 40, completed30d: 35, walkIns30d: 12, noShows30d: 2, services: 6, staff: 3, pictures: 3 },
    { shopId: 'quiet', name: 'Quiet Cuts', area: 'Madhapur', pincode: '500081', status: 'APPROVED', lastActiveDay: null, bookings30d: 0, completed30d: 0, walkIns30d: 0, noShows30d: 0, services: 0, staff: 1, pictures: 1 },
  ]
  api.analytics.quietSalons = 1
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/analytics?s=salons')
  const list = page.getByRole('list', { name: 'Salons' })
  await expect(list.getByRole('listitem').first()).toContainText('Quiet Cuts')
  await expect(list.getByRole('listitem').first()).toContainText('Not opened in the last 35 days')
  await expect(list.getByRole('listitem').first()).toContainText('Setup: no services, 1 of 3 photos and video')
  await page.getByRole('button', { name: 'Most bookings first' }).click()
  await expect(list.getByRole('listitem').first()).toContainText('Busy Barbers')
  // The order is kept on reload (and Back from a salon's page)
  await expect(page).toHaveURL(/sort=bookings/)
  await page.reload()
  await expect(page.getByRole('list', { name: 'Salons' }).getByRole('listitem').first()).toContainText('Busy Barbers')
})

test('a field agent has no Analytics link, and the page itself is refused', async ({ page, context, api }) => {
  await signedIn(context, api, 'ADMIN')
  await page.goto('/more')
  await expect(page.getByRole('link', { name: 'Analytics' })).toHaveCount(0)
  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: 'Analytics' })).toHaveCount(0)
  expect(api.calls.some((c) => c.path.startsWith('/api/v1/admin/analytics'))).toBe(false)
})

test('app versions show phones per version, Play Store apart from test APKs', async ({ page, context, api }) => {
  const d = today()
  api.analytics.versions = [
    { day: d, app: 'partner', versionCode: 245, store: true, phones: 120 },
    { day: d, app: 'partner', versionCode: 240, store: true, phones: 8 },
    { day: d, app: 'partner', versionCode: 246, store: false, phones: 2 },
  ]
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/analytics?s=versions')
  const partner = page.getByRole('region', { name: 'Partner app' })
  await expect(partner.getByRole('row').nth(1)).toContainText('245')
  await expect(partner.getByRole('row').nth(1)).toContainText('120')
  await expect(partner.getByRole('row').filter({ hasText: 'test APK' })).toContainText('246')
  await expect(page.getByRole('region', { name: 'Customer app' }).getByText('No phones counted this week')).toBeVisible()
})
