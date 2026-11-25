import { expect, signedIn, test } from './helpers'
import type { MockApi } from './mockApi'

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

function shop(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    mapboxId: id, name, address: 'Road 1, Kukatpally', latitude: 17.49, longitude: 78.4, pincode: '500072', onMapbox: true,
    kind: 'LADIES_PARLOUR', chain: false, score: 85, priority: 'HIGH', phone: '9133576278', website: null,
    hours: { days: 7, opens: '1000', closes: '2100', late: true }, clozest: null, ...extra,
  }
}

/** Kukatpally with a parlour to call, a chain, a mehendi artist with no phone, and a salon already on Clozest. */
function kukatpally(api: MockApi) {
  api.leads.found['500072'] = [
    shop('mb-tia', "Tia's Beauty Parlour"),
    shop('mb-lakme', 'Lakme Salon KPHB', { kind: 'UNISEX_SALON', chain: true, score: 30, priority: 'LOW', phone: null, latitude: 17.495, longitude: 78.399 }),
    shop('mb-arifa', 'Arifa mehandi artist', { kind: 'MEHENDI', score: 60, priority: 'MEDIUM', phone: null, hours: null, latitude: 17.499, longitude: 78.41 }),
    shop('mb-rich', 'Rich Look Unisex', {
      kind: 'UNISEX_SALON', score: 75, phone: '9000000407', latitude: 17.49, longitude: 78.4,
      clozest: { shopId: 'shop-rich', name: 'Rich Look', status: 'APPROVED' },
    }),
  ]
  api.leads.clozestOnly['500072'] = [{ shopId: 'shop-gem', name: 'Hidden Gem', status: 'PENDING_VISIT', latitude: 17.47, longitude: 78.38 }]
  api.leads.onClozest['500072'] = 2
}

async function pickDistrict(page: import('@playwright/test').Page, typed: string, pick: RegExp) {
  await page.getByLabel('City or district').fill(typed)
  await page.getByRole('listbox', { name: 'Matching districts' }).getByRole('button', { name: pick }).click()
}

test('a field agent finds a district by an area name, narrows to areas with the search, searches them and works a lead', async ({ page, context, api }) => {
  kukatpally(api)
  await signedIn(context, api, 'ADMIN')
  await page.goto('/')
  // The home screen points to Leads; the tab is one tap away
  await expect(page.getByRole('link', { name: /Leads: find salons on the map/ })).toBeVisible()
  await page.getByRole('link', { name: 'Leads' }).first().click()
  await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible()
  await expect(page.getByText('Start with a city or district')).toBeVisible()

  await pickDistrict(page, 'kukat', /Medchal Malkajgiri, Telangana.*Has Kukatpally \(500072\)/)
  await expect(page.getByRole('list', { name: 'Districts picked' })).toContainText('Medchal Malkajgiri, Telangana')
  const areas = page.getByRole('list', { name: 'Areas', exact: true })
  // Found by Kukatpally: that area is in the area search already, ticked
  await expect(page.getByRole('list', { name: 'Areas searched for' }).getByRole('listitem')).toHaveCount(1)
  await expect(areas.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Search 1 area on the map' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search (show all areas)' }).click()
  await expect(areas.getByRole('listitem')).toHaveCount(3)
  await expect(areas.getByText('Yours')).toHaveCount(1)

  // The area search: chips narrow the list; clearing brings every area back
  await page.getByLabel('Search areas').fill('nizam')
  await page.getByRole('listbox', { name: 'Matching areas' }).getByRole('button', { name: /500090/ }).click()
  await page.getByLabel('Search areas').fill('5000')
  await page.getByRole('listbox', { name: 'Matching areas' }).getByRole('button', { name: /500072/ }).click()
  await expect(page.getByRole('list', { name: 'Areas searched for' }).getByRole('listitem')).toHaveCount(2)
  await expect(areas.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Clear search (show all areas)' }).click()
  await expect(areas.getByRole('listitem')).toHaveCount(3)
  await page.getByRole('button', { name: /My areas \(1\)/ }).click()
  await expect(areas.getByRole('listitem')).toHaveCount(1)

  // Already ticked when it was picked
  await expect(page.getByRole('button', { name: 'Untick all shown' })).toBeVisible()
  await page.getByRole('button', { name: 'Search 1 area on the map' }).click()
  await expect(page.getByText('Businesses found')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Businesses' }).getByRole('listitem')).toHaveCount(5)
  // Best leads first; chains and Clozest salons are marked; the map usage is shown
  await expect(page.getByRole('list', { name: 'Businesses' }).getByRole('listitem').first()).toContainText("Tia's Beauty Parlour")
  await expect(page.getByRole('list', { name: 'Businesses' }).getByText('Clozest: Live')).toBeVisible()
  await expect(page.getByText(/Map searches this month: 157 of 50,000/)).toBeVisible()
  // A field agent sees the Clozest salon's name, but no link to its page
  await expect(page.getByRole('link', { name: /Open .* on Clozest/ })).toHaveCount(0)

  // On Clozest only: the matched salon and the one no business matched
  await page.getByLabel('Clozest', { exact: true }).selectOption('ON')
  await expect(page.getByRole('list', { name: 'Businesses' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('list', { name: 'Businesses' }).getByText('Hidden Gem')).toBeVisible()
  await page.getByLabel('Clozest status').selectOption('PENDING_VISIT')
  await expect(page.getByRole('list', { name: 'Businesses' }).getByRole('listitem')).toHaveCount(1)
  await page.getByLabel('Clozest', { exact: true }).selectOption('OFF')
  await expect(page.getByRole('list', { name: 'Businesses' }).getByRole('listitem')).toHaveCount(3)
  await page.getByRole('button', { name: 'Clear filters' }).click()

  // Work a lead: call, note, call back today, take it, WhatsApp consent
  const tia = page.getByRole('list', { name: 'Businesses' }).getByRole('listitem').filter({ hasText: "Tia's Beauty Parlour" })
  await expect(tia.getByRole('link', { name: 'Call 9133576278' })).toHaveAttribute('href', 'tel:+919133576278')
  await tia.getByRole('button', { name: 'Add note or status' }).click()
  const sheet = page.getByRole('dialog', { name: "Tia's Beauty Parlour" })
  const consent = sheet.getByRole('switch', { name: 'Owner agreed to WhatsApp messages' })
  await expect(consent).toBeDisabled()
  await sheet.getByRole('button', { name: 'Interested', exact: true }).click()
  await sheet.getByLabel('Note').fill('Owner Lakshmi, wants a demo')
  await sheet.getByLabel('Call back on').fill(today())
  await sheet.getByRole('button', { name: 'Me', exact: true }).click()
  await consent.click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
  await expect(tia).toContainText('Interested')
  await expect(tia).toContainText('WhatsApp OK')
  const put = api.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/admin/leads/mb-tia'))
  expect(put?.body).toMatchObject({ status: 'INTERESTED', whatsappOk: true, phone: '9133576278', pincode: '500072', version: null, followUpOn: today() })

  // It shows as due today, here and on the home screen
  await expect(page.getByRole('tab', { name: 'Follow-ups (1)' })).toBeVisible()
  await page.getByRole('tab', { name: 'Follow-ups (1)' }).click()
  await expect(page.getByRole('list', { name: 'Follow-ups due' }).getByText('Due today', { exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Follow-ups due' }).getByText('Owner Lakshmi, wants a demo')).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Leads: 1 follow-up due/ })).toBeVisible()
})

test('a lead someone else saved meanwhile is shown, and your changes stay to save again', async ({ page, context, api }) => {
  kukatpally(api)
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  await page.getByRole('list', { name: 'Areas', exact: true }).getByText('500072').click()
  await page.getByRole('button', { name: 'Search 1 area on the map' }).click()
  const tia = page.getByRole('list', { name: 'Businesses' }).getByRole('listitem').filter({ hasText: "Tia's Beauty Parlour" })
  await tia.getByRole('button', { name: 'Add note or status' }).click()
  // Another field agent saves it first
  api.leads.saved.set('mb-tia', {
    mapboxId: 'mb-tia', pincode: '500072', status: 'CALLED', note: 'Busy, call later', assignedTo: null, followUpOn: null, name: "Tia's Beauty Parlour",
    phone: '9133576278', latitude: 17.49, longitude: 78.4, whatsappOk: false, version: 0, updatedAt: new Date().toISOString(), updatedBy: 'u-sita',
  })
  const sheet = page.getByRole('dialog', { name: "Tia's Beauty Parlour" })
  await sheet.getByRole('button', { name: 'Visited', exact: true }).click()
  await sheet.getByLabel('Note').fill('Met the owner')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet.getByText(/Someone else changed this lead just now.*"Called"/)).toBeVisible()
  await expect(sheet.getByLabel('Note')).toHaveValue('Met the owner')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
  await expect(tia).toContainText('Visited')
  expect(api.leads.saved.get('mb-tia')).toMatchObject({ status: 'VISITED', version: 1 })
})

test('a lead given to someone else can be updated but not taken by a field agent', async ({ page, context, api }) => {
  kukatpally(api)
  api.team.push({ userId: 'u-sita', name: 'Sita', phone: '9000000403', email: null, emailVerified: false, adminRole: 'ADMIN', designation: 'FIELD_AGENT', pincodes: [], pendingVisits: 0 })
  api.leads.saved.set('mb-tia', {
    mapboxId: 'mb-tia', pincode: '500072', status: 'CALLED', note: '', assignedTo: 'u-sita', followUpOn: null, name: "Tia's Beauty Parlour",
    phone: '9133576278', latitude: 17.49, longitude: 78.4, whatsappOk: false, version: 3, updatedAt: new Date().toISOString(), updatedBy: 'u-sita',
  })
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  await page.getByRole('list', { name: 'Areas', exact: true }).getByText('500072').click()
  await page.getByRole('button', { name: 'Search 1 area on the map' }).click()
  const tia = page.getByRole('list', { name: 'Businesses' }).getByRole('listitem').filter({ hasText: "Tia's Beauty Parlour" })
  await expect(tia).toContainText('Called · Sita')
  await tia.getByRole('button', { name: 'Update' }).click()
  const sheet = page.getByRole('dialog', { name: "Tia's Beauty Parlour" })
  await expect(sheet.getByText('(only a super admin can give it to someone else)')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Me', exact: true })).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Visited', exact: true }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
  expect(api.leads.saved.get('mb-tia')).toMatchObject({ status: 'VISITED', assignedTo: 'u-sita', version: 4 })
})

test('a search that can’t run says why and what to do, and a busy server is waited for', async ({ page, context, api }) => {
  kukatpally(api)
  api.leads.found['500085'] = [shop('mb-jntu', 'JNTU Hair Studio', { pincode: '500085' })]
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  // No key yet: the search stops and says who fixes it
  api.leads.scanError = { status: 503, code: 'MAPBOX_OFF', message: 'off' }
  await page.getByRole('button', { name: /Tick all shown \(3\)/ }).click()
  await page.getByRole('button', { name: 'Search 3 areas on the map' }).click()
  await expect(page.getByText("Searching the map isn't set up yet. Ask a super admin to add the Mapbox key.")).toBeVisible()
  // Busy once for one area, not on the map for another: the busy one is tried again, the other is marked
  api.leads.scanError = null
  api.leads.scanErrorFor.set('500072', { status: 503, code: 'SCAN_BUSY', message: 'busy', retryAfter: 1 })
  api.leads.scanErrorFor.set('500090', { status: 404, code: 'AREA_NOT_ON_MAP', message: 'not on map' })
  setTimeout(() => api.leads.scanErrorFor.delete('500072'), 500)
  await page.getByRole('button', { name: /Search \d areas? on the map/ }).click()
  await expect(page.getByText("This pincode isn't on the map, so it can't be searched.")).toBeVisible()
  await expect(page.getByRole('list', { name: 'Businesses' }).getByText("Tia's Beauty Parlour")).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('list', { name: 'Businesses' }).getByText('JNTU Hair Studio')).toBeVisible()
  expect(api.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/scan/500072')).length).toBeGreaterThanOrEqual(2)
})

test('a super admin opens Leads from More, sees Clozest links and the funnel', async ({ page, context, api }) => {
  kukatpally(api)
  api.leads.saved.set('mb-x', {
    mapboxId: 'mb-x', pincode: '500072', status: 'INTERESTED', note: '', assignedTo: 'u0', followUpOn: null, name: 'X Parlour',
    phone: null, latitude: 17.49, longitude: 78.4, whatsappOk: false, signedUpAt: new Date().toISOString(), creditedTo: 'u0', version: 2,
  })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/more')
  await page.getByRole('link', { name: /Leads/ }).click()
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  await page.getByRole('list', { name: 'Areas', exact: true }).getByText('500072').click()
  await page.getByRole('button', { name: 'Search 1 area on the map' }).click()
  await expect(page.getByRole('link', { name: 'Open "Rich Look" on Clozest' })).toHaveAttribute('href', '/shops/shop-rich')
  // A contacted lead the map doesn't list any more still shows, from what the team saved
  await expect(page.getByText('saved by the team (not on the map now)')).toBeVisible()
  await page.getByRole('tab', { name: 'Funnel' }).click()
  const row = page.getByRole('table', { name: 'Funnel per area' }).getByRole('row').filter({ hasText: '500072' })
  await expect(row).toContainText('1')
})

test('support staff never see Leads', async ({ page, context, api }) => {
  await signedIn(context, api, 'ADMIN')
  api.user = { ...api.user, designation: 'SUPPORT' }
  await page.goto('/leads')
  await expect(page).toHaveURL(/\/tickets/)
})

test('no answer, then my leads: a tried lead never goes back to not contacted, and consent waits until someone spoke', async ({ page, context, api }) => {
  kukatpally(api)
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  await page.getByRole('list', { name: 'Areas', exact: true }).getByText('500072').click()
  await page.getByRole('button', { name: 'Search 1 area on the map' }).click()
  const tia = page.getByRole('list', { name: 'Businesses' }).getByRole('listitem').filter({ hasText: "Tia's Beauty Parlour" })
  await expect(tia.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', /destination=17\.49,78\.4/)
  await tia.getByRole('button', { name: 'Add note or status' }).click()
  const sheet = page.getByRole('dialog', { name: "Tia's Beauty Parlour" })
  await sheet.getByRole('button', { name: 'No answer', exact: true }).click()
  await expect(sheet.getByText(/nobody picked up/)).toBeVisible()
  await expect(sheet.getByRole('switch', { name: 'Owner agreed to WhatsApp messages' })).toBeDisabled()
  await sheet.getByRole('button', { name: 'Tomorrow', exact: true }).click()
  // A field agent's new lead is theirs by default
  await expect(sheet.getByRole('button', { name: 'Me', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
  expect(api.leads.saved.get('mb-tia')).toMatchObject({ status: 'NO_ANSWER', assignedTo: api.user.id })

  // Opened again: "Not contacted" is gone; a slip outside with changes asks first
  await tia.getByRole('button', { name: 'Update' }).click()
  await expect(sheet.getByRole('button', { name: 'Not contacted', exact: true })).toHaveCount(0)
  await sheet.getByLabel('Note').fill('Shut on Monday')
  await page.keyboard.press('Escape')
  await expect(sheet.getByText("You have changes that aren't saved.")).toBeVisible()
  await sheet.getByRole('button', { name: 'Discard changes' }).click()
  await expect(sheet).toBeHidden()

  // My leads lists it from its saved details, with no map search
  const scans = api.calls.filter((c) => c.path.includes('/scan/')).length
  await page.getByRole('tab', { name: /Follow-ups/ }).click()
  await page.getByRole('button', { name: 'My leads', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Follow-ups due' }).getByText("Tia's Beauty Parlour")).toBeVisible()
  await expect(page.getByRole('list', { name: 'Follow-ups due' })).toContainText('No answer')
  expect(api.calls.filter((c) => c.path.includes('/scan/')).length).toBe(scans)
})

test('after a conflict, what you did not change follows what was saved meanwhile', async ({ page, context, api }) => {
  kukatpally(api)
  api.team.push({ userId: 'u-sita', name: 'Sita', phone: '9000000403', email: null, emailVerified: false, adminRole: 'ADMIN', designation: 'FIELD_AGENT', pincodes: [], pendingVisits: 0 })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  await page.getByRole('list', { name: 'Areas', exact: true }).getByText('500072').click()
  await page.getByRole('button', { name: 'Search 1 area on the map' }).click()
  const tia = page.getByRole('list', { name: 'Businesses' }).getByRole('listitem').filter({ hasText: "Tia's Beauty Parlour" })
  await tia.getByRole('button', { name: 'Add note or status' }).click()
  api.leads.saved.set('mb-tia', {
    mapboxId: 'mb-tia', pincode: '500072', status: 'CALLED', note: '', assignedTo: 'u-sita', followUpOn: null, name: "Tia's Beauty Parlour",
    phone: '9133576278', latitude: 17.49, longitude: 78.4, whatsappOk: false, version: 0, updatedAt: new Date().toISOString(), updatedBy: 'u-sita',
  })
  const sheet = page.getByRole('dialog', { name: "Tia's Beauty Parlour" })
  await sheet.getByLabel('Note').fill('Owner prefers mornings')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet.getByText(/Someone else changed this lead just now/)).toBeVisible()
  // Sita's assignment and status are taken; the note typed here stays
  await expect(sheet.getByLabel('Assigned to')).toHaveValue('u-sita')
  await expect(sheet.getByRole('button', { name: 'Called', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
  expect(api.leads.saved.get('mb-tia')).toMatchObject({ status: 'CALLED', assignedTo: 'u-sita', note: 'Owner prefers mornings', version: 1 })
})

test('Greater Hyderabad: its other districts are one tap away', async ({ page, context, api }) => {
  api.leads.districts.push({ district: 'Ranga Reddy', state: 'Telangana', areas: [{ pincode: '500032', places: 'Gachibowli' }] })
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'hyder', /Hyderabad, Telangana/)
  await page.getByRole('button', { name: '+ Ranga Reddy' }).click()
  await expect(page.getByRole('list', { name: 'Districts picked' })).toContainText('Ranga Reddy, Telangana')
  await expect(page.getByRole('button', { name: '+ Ranga Reddy' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '+ Medchal Malkajgiri' })).toBeVisible()
})
