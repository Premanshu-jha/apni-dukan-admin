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
  await page.getByRole('listbox', { name: 'Matching places' }).getByRole('button', { name: pick }).click()
}

test('a field agent finds their city by an area name, narrows to areas with the search, searches them and works a lead', async ({ page, context, api }) => {
  kukatpally(api)
  await signedIn(context, api, 'ADMIN')
  await page.goto('/')
  // The home screen points to Leads; the tab is one tap away
  await expect(page.getByRole('link', { name: /Leads: find salons on the map/ })).toBeVisible()
  await page.getByRole('link', { name: 'Leads' }).first().click()
  await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible()
  await expect(page.getByText('Start with a city or district')).toBeVisible()

  // Kukatpally is filed by India Post under Medchal Malkajgiri: it is offered as Hyderabad, the city
  await pickDistrict(page, 'kukat', /Kukatpally \(500072\) · Hyderabad/)
  await expect(page.getByRole('list', { name: 'Places picked' })).toContainText('Hyderabad (city), Telangana')
  const areas = page.getByRole('list', { name: 'Areas', exact: true })
  // Found by Kukatpally: that area is in the area search already, ticked
  await expect(page.getByRole('list', { name: 'Areas searched for' }).getByRole('listitem')).toHaveCount(1)
  await expect(areas.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Search 1 area on the map' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search (show all areas)' }).click()
  // All areas of Hyderabad's three districts, each saying which one
  await expect(areas.getByRole('listitem')).toHaveCount(6)
  await expect(areas.getByText('Yours')).toHaveCount(1)

  // The area search: chips narrow the list; clearing brings every area back
  await page.getByLabel('Search areas').fill('nizam')
  await page.getByRole('listbox', { name: 'Matching areas' }).getByRole('button', { name: /500090/ }).click()
  await page.getByLabel('Search areas').fill('5000')
  await page.getByRole('listbox', { name: 'Matching areas' }).getByRole('button', { name: /500072/ }).click()
  await expect(page.getByRole('list', { name: 'Areas searched for' }).getByRole('listitem')).toHaveCount(2)
  await expect(areas.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Clear search (show all areas)' }).click()
  await expect(areas.getByRole('listitem')).toHaveCount(6)
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
  await page.getByRole('button', { name: /Tick all shown \(4\)/ }).click()
  await page.getByRole('button', { name: 'Search 4 areas on the map' }).click()
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

test('one search finds any place in India: a city with all its districts, any pincode, a district, a name only the map knows', async ({ page, context, api }) => {
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  const options = page.getByRole('listbox', { name: 'Matching places' })
  // "Hyderabad" is the city first: its three districts, one tap
  await page.getByLabel('City or district').fill('hyder')
  await expect(options.getByRole('button').first()).toContainText('City · Hyderabad, Medchal Malkajgiri, Ranga Reddy · 6 areas')
  await options.getByRole('button').first().click()
  const areas = page.getByRole('list', { name: 'Areas', exact: true })
  await expect(areas.getByRole('listitem')).toHaveCount(6)
  await expect(areas.getByRole('listitem').filter({ hasText: '500087' })).toContainText('Medchal Malkajgiri')
  await expect(areas.getByRole('listitem').filter({ hasText: '500032' })).toContainText('Ranga Reddy')

  // A district elsewhere, by name
  await pickDistrict(page, 'sahar', /^Saharsa, Bihar/)
  await expect(page.getByRole('list', { name: 'Places picked' })).toContainText('Saharsa, Bihar')
  await page.getByRole('button', { name: 'Remove Hyderabad' }).click()

  // A pincode not in the places picked: the area search looks across India; tapping it shows its city, that area ticked
  await page.getByLabel('Search areas').fill('500087')
  const matching = page.getByRole('listbox', { name: 'Matching areas' })
  await expect(matching.getByText('Not in the places picked. Elsewhere in India:')).toBeVisible()
  await matching.getByRole('button', { name: /500087 · JJ Nagar Colony, Jawahar Nagar · Hyderabad/ }).click()
  await expect(page.getByRole('list', { name: 'Places picked' })).toContainText('Hyderabad (city), Telangana')
  await expect(page.getByRole('list', { name: 'Areas searched for' })).toContainText('500087')
  await expect(page.getByRole('button', { name: 'Search 1 area on the map' })).toBeVisible()

  // A name our list doesn't have: looked up on the map (one map search), offered as its city with that area
  const lookups = () => api.calls.filter((c) => c.path.includes('/admin/leads/places')).length
  await page.getByLabel('City or district').fill('yapral')
  await expect(options.getByText('Found on the map (used 1 map search):')).toBeVisible()
  await expect(options.getByRole('button', { name: /Yapral \(500087\) · Hyderabad/ })).toBeVisible()
  expect(lookups()).toBe(1)
  // Enter picks the first map result too
  await page.getByLabel('City or district').press('Enter')
  await expect(page.getByRole('list', { name: 'Areas searched for' })).toContainText('500087')
  // Nothing anywhere: said plainly
  await page.getByLabel('City or district').fill('zzqx')
  await expect(options.getByText('Nothing in India matches "zzqx". Check the spelling, or try the pincode.')).toBeVisible()
  // A whole pincode in the city box: just that area
  await page.getByLabel('City or district').fill('852201')
  await expect(options.getByRole('button')).toHaveCount(1)
  await expect(options.getByRole('button')).toContainText('852201 · Saharsa, Saharsa Bazar · Saharsa')
  await expect(options.getByRole('button')).toContainText('Opens Saharsa with this area ticked')
})

test('a city replaces its districts, a removed place keeps what another still lists, and a look-alike can be looked up on the map', async ({ page, context, api }) => {
  api.leads.onMapPlaces['saharsa'] = [{ name: 'Saharsa', pincode: '852201' }]
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  const picked = page.getByRole('list', { name: 'Places picked' })
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  await page.getByRole('list', { name: 'Areas', exact: true }).getByText('500072').click()
  // Hyderabad the city covers Medchal Malkajgiri: its chip goes, the tick stays
  await page.getByLabel('City or district').fill('hyder')
  await expect(page.getByRole('listbox', { name: 'Matching places' }).getByText('District only · Telangana · 1 areas')).toBeVisible()
  await page.getByRole('listbox', { name: 'Matching places' }).getByRole('button').first().click()
  await expect(picked.getByRole('listitem')).toHaveCount(1)
  await expect(picked).toContainText('Hyderabad (city)')
  await expect(page.getByRole('button', { name: 'Search 1 area on the map' })).toBeVisible()

  // A one-letter area search says what to type (no endless spinner)
  await page.getByLabel('Search areas').fill('9')
  await expect(page.getByText('Type 2 or more letters or digits.')).toBeVisible()
  await page.getByLabel('Search areas').fill('')

  // Our list has a match, but maybe not the one meant: a look-up on the map only when asked, said what it costs
  const lookups = () => api.calls.filter((c) => c.path.includes('/admin/leads/places')).length
  await page.getByLabel('City or district').fill('saharsa')
  const options = page.getByRole('listbox', { name: 'Matching places' })
  await expect(options.getByRole('button', { name: /^Saharsa, Bihar/ })).toBeVisible()
  expect(lookups()).toBe(0)
  await options.getByRole('button', { name: 'Not the one? Look up "saharsa" on the map (uses 1 map search)' }).click()
  await expect(options.getByText('Found on the map (used 1 map search):')).toBeVisible()
  await expect(options.getByRole('button', { name: /Saharsa \(852201\) · Saharsa/ })).toBeVisible()
  expect(lookups()).toBe(1)
})

test('searched areas are saved on the page: a reload or another page shows them without searching the map again', async ({ page, context, api }) => {
  kukatpally(api)
  api.leads.found['500085'] = [shop('mb-jntu', 'JNTU Hair Studio', { pincode: '500085' })]
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  const areas = page.getByRole('list', { name: 'Areas', exact: true })
  await areas.getByText('500072').click()
  await page.getByRole('button', { name: 'Search 1 area on the map' }).click()
  const list = page.getByRole('list', { name: 'Businesses' })
  await expect(list.getByText("Tia's Beauty Parlour")).toBeVisible()
  const scansOf = (pin: string) => api.calls.filter((c) => c.method === 'POST' && c.path.endsWith(`/scan/${pin}`)).length
  expect(scansOf('500072')).toBe(1)

  // Reload, and another page and back: still there, no new map search
  await page.reload()
  await expect(list.getByText("Tia's Beauty Parlour")).toBeVisible()
  await expect(page.getByText(/1 area saved on this page/)).toBeVisible()
  await expect(areas.getByText(/found, searched just now/)).toBeVisible()
  await page.getByRole('link', { name: 'Businesses' }).first().click()
  await expect(page.getByRole('heading', { name: 'Leads' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Leads' }).first().click()
  await expect(list.getByText("Tia's Beauty Parlour")).toBeVisible()
  expect(scansOf('500072')).toBe(1)

  // "Searched (1)" finds it in a long list; ticking only saved areas points to the list
  await page.getByRole('button', { name: 'Searched (1)' }).click()
  await expect(areas.getByRole('listitem')).toHaveCount(1)
  await areas.getByText('500072').click()
  await page.getByRole('button', { name: 'Already shown below (1 area)' }).click()
  await expect(page.getByText('1 area already searched: their businesses are in the list below.')).toBeVisible()
  expect(scansOf('500072')).toBe(1)
  await page.getByRole('button', { name: 'Clear search (show all areas)' }).click()

  // Saved with a new one: only the new one asks the map
  await areas.getByText('500072').click()
  await areas.getByText('500085').click()
  await page.getByRole('button', { name: 'Show 2 areas (1 saved, 1 new)' }).click()
  await expect(list.getByText('JNTU Hair Studio')).toBeVisible()
  expect(scansOf('500072')).toBe(1)
  expect(scansOf('500085')).toBe(1)

  // Clear asks first; then gone, here and after a reload (once the saved areas would have loaded)
  await page.getByRole('button', { name: 'Clear saved results' }).click()
  await page.getByRole('button', { name: 'Keep them' }).click()
  await expect(list.getByText('JNTU Hair Studio')).toBeVisible()
  await page.getByRole('button', { name: 'Clear saved results' }).click()
  await page.getByRole('button', { name: 'Yes, clear' }).click()
  await expect(list).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Tick areas to search' })).toBeVisible()
  await expect(page.getByText('No areas searched yet')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Businesses' })).toHaveCount(0)
})

test('search again searches only that area, keeps its saved result until the fresh one arrives, and keeps it if that fails', async ({ page, context, api }) => {
  kukatpally(api)
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  const areas = page.getByRole('list', { name: 'Areas', exact: true })
  await areas.getByText('500072').click()
  await page.getByRole('button', { name: 'Search 1 area on the map' }).click()
  const list = page.getByRole('list', { name: 'Businesses' })
  await expect(list.getByText("Tia's Beauty Parlour")).toBeVisible()
  const scansOf = (pin: string) => api.calls.filter((c) => c.method === 'POST' && c.path.endsWith(`/scan/${pin}`)).length

  // Other areas ticked but not searched: Search again touches only its own area
  await areas.getByText('500085').click()
  await areas.getByText('500090').click()
  api.leads.found['500072'] = [shop('mb-new', 'New Glow Salon')]
  await page.getByRole('button', { name: 'Search again (uses map searches): 500072' }).click()
  await expect(list.getByText('New Glow Salon')).toBeVisible()
  expect(scansOf('500072')).toBe(2)
  expect(scansOf('500085') + scansOf('500090')).toBe(0)
  await expect(page.getByRole('button', { name: 'Search 2 areas on the map' })).toBeVisible()

  // It fails: the saved result stays on screen and after a reload
  api.leads.scanErrorFor.set('500072', { status: 429, code: 'MAPBOX_CAP_REACHED', message: 'cap' })
  await page.getByRole('button', { name: 'Search again (uses map searches): 500072' }).click()
  await expect(page.getByText(/This month's map searches are used up/)).toBeVisible()
  await expect(list.getByText('New Glow Salon')).toBeVisible()
  await page.reload()
  await expect(list.getByText('New Glow Salon')).toBeVisible()
})

test('the big-search question counts only new areas, and closes when it no longer applies', async ({ page, context, api }) => {
  const many = Array.from({ length: 12 }, (_, i) => ({ pincode: `5001${String(i).padStart(2, '0')}`, places: `Place ${i}` }))
  api.leads.districts.push({ district: 'Big District', state: 'Telangana', areas: many })
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'big dis', /Big District/)
  const areas = page.getByRole('list', { name: 'Areas', exact: true })
  // Two searched first (saved)
  await areas.getByText('500100').click()
  await areas.getByText('500101').click()
  await page.getByRole('button', { name: 'Search 2 areas on the map' }).click()
  await expect(page.getByText(/2 areas saved on this page/)).toBeVisible()
  // All 12 ticked: 10 new, no question
  await page.getByRole('button', { name: 'Tick all shown (12)' }).click()
  await page.getByRole('button', { name: 'Show 12 areas (2 saved, 10 new)' }).click()
  await expect(page.getByText(/new areas use about/)).toHaveCount(0)
  await expect(page.getByText(/12 areas saved on this page/)).toBeVisible()
  // 11 new: asks, and the question goes when ticks drop to 10 or fewer
  api.leads.districts[api.leads.districts.length - 1].areas.push(...Array.from({ length: 11 }, (_, i) => ({ pincode: `5002${String(i).padStart(2, '0')}`, places: `More ${i}` })))
  await page.reload()
  await expect(page.getByText(/12 areas saved on this page/)).toBeVisible()
  await page.getByRole('button', { name: 'Tick all shown (23)' }).click()
  await page.getByRole('button', { name: 'Show 23 areas (12 saved, 11 new)' }).click()
  await expect(page.getByText('11 new areas use about 440 to 1,650 of this month\'s map searches', { exact: false })).toBeVisible()
  await areas.getByText('500200').click()
  await expect(page.getByText(/new areas use about/)).toHaveCount(0)
})

test('after clearing saved results the keyboard stays on the area search', async ({ page, context, api }) => {
  kukatpally(api)
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  await page.getByRole('list', { name: 'Areas', exact: true }).getByText('500072').click()
  await page.getByRole('button', { name: 'Search 1 area on the map' }).click()
  await page.getByRole('button', { name: 'Clear saved results' }).click()
  await page.getByRole('button', { name: 'Yes, clear' }).click()
  await expect(page.getByLabel('Search areas')).toBeFocused()
})

test('a searched area updates by itself: a new Clozest signup and a teammate’s lead show without a reload or a map search', async ({ page, context, api }) => {
  kukatpally(api)
  await page.clock.install()
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  const areas = page.getByRole('list', { name: 'Areas', exact: true })
  await areas.getByText('500072').click()
  await page.getByRole('button', { name: 'Search 1 area on the map' }).click()
  const list = page.getByRole('list', { name: 'Businesses' })
  const tia = list.getByRole('listitem').filter({ hasText: "Tia's Beauty Parlour" })
  const arifa = list.getByRole('listitem').filter({ hasText: 'Arifa mehandi artist' })
  const status = page.getByTestId('live-status').last()
  await expect(tia).toBeVisible()
  await expect(tia.getByText(/^Clozest:/)).toHaveCount(0)
  await expect(page.getByText(/update by themselves about every 30 seconds while you're on this screen/)).toBeVisible()
  await expect(status).toContainText('Up to date · checked just now')
  const onClozest = page.getByRole('region', { name: 'Numbers' }).getByText('On Clozest').locator('..')
  await expect(onClozest).toHaveText(/^2On Clozest/)
  const scans = () => api.calledTimes('POST', '/api/v1/admin/leads/scan/')
  const checks = () => api.calledTimes('POST', '/api/v1/admin/leads/changes')
  expect(scans()).toBe(1)
  // Working down the businesses not on Clozest yet
  const clozestFilter = page.getByRole('combobox', { name: 'Clozest', exact: true })
  await clozestFilter.selectOption('OFF')
  await expect(tia).toBeVisible()

  // Tia registers on Clozest, and a teammate calls Arifa, while the page stays open
  api.leads.found['500072'][0].clozest = { shopId: 'shop-tia', name: "Tia's Parlour", status: 'PENDING_VISIT' }
  api.leads.changedAt['500072'] = new Date().toISOString()
  api.leads.saved.set('mb-arifa', {
    mapboxId: 'mb-arifa', pincode: '500072', status: 'CALLED', note: 'Call after 6', assignedTo: null, followUpOn: null,
    name: 'Arifa mehandi artist', phone: null, latitude: 17.499, longitude: 78.41, whatsappOk: false, version: 0,
    updatedAt: new Date().toISOString(), updatedBy: 'u5',
  })
  await page.clock.runFor(31_000)
  // Tia no longer matches "not on Clozest", but stays where it was, marked, until the filter changes
  await expect(tia.getByText('Clozest: Waiting for a visit')).toBeVisible()
  await expect(tia.getByText('Changed: no longer matches your filters')).toBeVisible()
  await expect(arifa).toContainText('Called')
  await expect(status).toContainText(/Up to date · checked just now · 2 businesses updated just now/)
  await clozestFilter.selectOption('ALL')
  await expect(tia.getByText('Changed: no longer')).toHaveCount(0)
  await expect(onClozest).toHaveText(/^3On Clozest/)
  await clozestFilter.selectOption('ON')
  await expect(tia).toBeVisible()
  await clozestFilter.selectOption('OFF')
  await expect(tia).toHaveCount(0)
  await clozestFilter.selectOption('ALL')
  // The area says its statuses were updated after the search
  await page.clock.runFor(61_000)
  await expect(areas.getByText(/found, searched .*, statuses updated just now/)).toBeVisible()
  // No map search for any of it, and a reload shows the area as it is now
  expect(scans()).toBe(1)
  await page.reload()
  await expect(tia.getByText('Clozest: Waiting for a visit')).toBeVisible()
  expect(scans()).toBe(1)

  // Hidden tab or locked phone: no checks; back in front: one right away
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(16_000)
  const hiddenAt = checks()
  await page.clock.runFor(61_000)
  expect(checks()).toBe(hiddenAt)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(checks).toBe(hiddenAt + 1)

  // Checks refused for a while: no error popping up, but the line says the cards may be older; then it catches up
  api.leads.checkError = { status: 503, code: 'SERVICE_BUSY', message: 'Busy.' }
  // Half a minute at a time, each check answered before the next (the fake clock runs ahead of the network)
  const busyFrom = checks()
  for (let i = 0; i < 6; i++) {
    await page.clock.runFor(31_000)
    await page.waitForTimeout(150)
  }
  expect(checks() - busyFrom).toBeGreaterThanOrEqual(4)
  await expect(status).toContainText("Can't check for updates right now. Statuses on the cards may be older")
  await expect(page.getByText('Busy.')).toHaveCount(0)
  api.leads.checkError = null
  await page.clock.runFor(31_000)
  await expect(status).toContainText('Up to date · checked just now')
  await expect(tia).toBeVisible()
})

test('a teammate’s change to the lead you have open is shown before you save, and a lead they added is marked', async ({ page, context, api }) => {
  kukatpally(api)
  await page.clock.install()
  await signedIn(context, api, 'ADMIN')
  await page.goto('/leads')
  await pickDistrict(page, 'medchal', /Medchal Malkajgiri/)
  await page.getByRole('list', { name: 'Areas', exact: true }).getByText('500072').click()
  await page.getByRole('button', { name: 'Search 1 area on the map' }).click()
  const list = page.getByRole('list', { name: 'Businesses' })
  const tia = list.getByRole('listitem').filter({ hasText: "Tia's Beauty Parlour" })
  await tia.getByRole('button', { name: 'Add note or status' }).click()
  const sheet = page.getByRole('dialog', { name: "Tia's Beauty Parlour" })
  await sheet.getByLabel('Note').fill('Met the owner')

  const now = new Date().toISOString()
  api.leads.saved.set('mb-tia', {
    mapboxId: 'mb-tia', pincode: '500072', status: 'CALLED', note: 'Busy, call later', assignedTo: null, followUpOn: null, name: "Tia's Beauty Parlour",
    phone: '9133576278', latitude: 17.49, longitude: 78.4, whatsappOk: false, version: 0, updatedAt: now, updatedBy: 'u5',
  })
  api.leads.saved.set('mb-glow', {
    mapboxId: 'mb-glow', pincode: '500072', status: 'INTERESTED', note: 'Wants a demo', assignedTo: null, followUpOn: null, name: 'Glow Studio',
    phone: '9848012345', latitude: 17.491, longitude: 78.401, whatsappOk: false, version: 0, updatedAt: now, updatedBy: 'u5',
  })
  await page.clock.runFor(31_000)
  await expect(sheet.getByText('Ravi Field just updated this lead: it is now "Called" ("Busy, call later"). What you typed is still here')).toBeVisible()
  await expect(sheet.getByLabel('Note')).toHaveValue('Met the owner')
  // Saving shows theirs and keeps yours, as before
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet.getByText(/Someone else changed this lead just now/)).toBeVisible()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
  expect(api.leads.saved.get('mb-tia')).toMatchObject({ note: 'Met the owner', version: 1 })

  const glow = list.getByRole('listitem').filter({ hasText: 'Glow Studio' })
  await expect(glow.getByText('New from the team')).toBeVisible()
  await expect(glow).toContainText('added by a teammate while this page was open')
  await expect(glow).toContainText('Interested')
  expect(api.calledTimes('POST', '/api/v1/admin/leads/scan/')).toBe(1)
})
