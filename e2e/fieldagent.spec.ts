import { atDashboard, expect, signedIn, test } from './helpers'
import { MockApi } from './mockApi'

const me = { id: 'u1', name: 'Asha Field' }

test('a field agent sees only the businesses assigned to them: counts, lists and pages', async ({ page, context, api }) => {
  const mine = api.addShop({ name: 'Raju Hair', type: 'SALON', assignedTo: me })
  api.addShop({ name: 'Second Mine', type: 'SALON', assignedTo: me })
  const ravis = api.addShop({ name: 'Ravi Visits', type: 'SALON' })
  const nobodys = api.addShop({ name: 'Nobody Visits', type: 'SALON', assignedTo: null })
  await atDashboard(page, context, api, 'ADMIN')
  await expect(page.getByText('Only the businesses assigned to you')).toBeVisible()
  await page.getByRole('tab', { name: 'Salon' }).click()
  await expect(page.getByRole('link', { name: 'First visit: 2' })).toBeVisible()
  await page.getByRole('link', { name: 'First visit: 2' }).click()
  const cards = page.getByRole('list', { name: 'Businesses' }).getByRole('listitem')
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).not.toContainText('Visit by')
  // No All / Unassigned choice for a field agent
  await expect(page.getByRole('group', { name: 'Who visits' })).toBeHidden()
  expect(api.calls.some((c) => c.path.includes('unassigned=') || c.path.includes('assignedTo='))).toBe(false)

  // Someone else's or an unassigned business, by its link: as if it didn't exist
  for (const other of [ravis, nobodys]) {
    await page.goto(`/shops/${other.id as string}`)
    await expect(page.getByText('No such business')).toBeVisible()
  }
  // Their own: approve and send back only; no Suspend, no assignee row
  await page.goto(`/shops/${mine.id as string}`)
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send back', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeHidden()
  await expect(page.getByText(/Visit by|Unassigned/)).toBeHidden()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Approved. The business is live now.')).toBeVisible()
  // Live: nothing more for a field agent to decide
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeHidden()
})

test('a field agent reassigned while the page is open is told on the next decision (404) and the guard re-reads them', async ({ page, context, api }) => {
  const mine = api.addShop({ name: 'Raju Hair', assignedTo: me })
  await signedIn(context, api, 'ADMIN')
  await page.goto(`/shops/${mine.id as string}`)
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
  mine.assignedTo = { id: 'u5', name: 'Ravi Field' }
  const meReads = api.calledTimes('GET', '/api/v1/admin/me')
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('dialog').getByText(/No such shop|not found/i)).toBeVisible()
  expect(api.calledTimes('GET', '/api/v1/admin/me')).toBeGreaterThan(meReads)
  expect(mine.status).toBe('PENDING_VISIT')
})

test('a super admin sees who visits each business, filters the unassigned ones, and assigns one', async ({ page, context, api }) => {
  api.team.push(MockApi.teamMember({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', pincodes: ['500072'], since: '2026-10-05T05:00:00Z' }))
  api.team.push(MockApi.teamMember({ userId: 'u8', name: 'Mohan Field', phone: '9000000008', pincodes: ['500099'], since: '2026-10-06T05:00:00Z' }))
  api.addShop({ name: 'Ravi Visits', type: 'SALON' })
  const nobodys = api.addShop({ name: 'Nobody Visits', type: 'SALON', pincode: '500072', assignedTo: null })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/shops?type=SALON&group=FIRST_VISIT')
  const cards = page.getByRole('list', { name: 'Businesses' }).getByRole('listitem')
  await expect(cards).toHaveCount(2)
  await expect(cards.filter({ hasText: 'Ravi Visits' })).toContainText('Visit by Ravi Field')
  await expect(cards.filter({ hasText: 'Nobody Visits' })).toContainText('Unassigned: no field agent can take 500072')
  await page.getByRole('group', { name: 'Who visits' }).getByRole('button', { name: 'Unassigned' }).click()
  await expect(cards).toHaveCount(1)
  await expect(page).toHaveURL(/who=UNASSIGNED/)
  expect(api.calls.some((c) => c.path.includes('unassigned=true'))).toBe(true)

  await cards.first().getByRole('link').click()
  await expect(page.getByText('Unassigned: no field agent can take 500072')).toBeVisible()
  await page.getByRole('button', { name: 'Assign', exact: true }).click()
  const sheet = page.getByRole('dialog')
  // Covering the pincode first, then the others
  await expect(sheet.getByText('Covering 500072')).toBeVisible()
  await expect(sheet.getByText('Other field agents')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Assign' })).toBeDisabled()
  await sheet.getByRole('button', { name: /Kiran Field/ }).click()
  await sheet.getByRole('button', { name: 'Assign' }).click()
  await expect(page.getByText('Assigned to Kiran Field. They got a message.')).toBeVisible()
  await expect(page.getByText('Visit by Kiran Field')).toBeVisible()
  expect(api.calls.find((c) => c.path.endsWith('/assign'))?.body).toEqual({ adminId: 'u7' })
  expect(nobodys.assignedTo).toEqual({ id: 'u7', name: 'Kiran Field' })

  // Reassign to someone who works there: said plainly, nothing changes
  api.agentWorksIn.add(`u5:${nobodys.id as string}`)
  await page.getByRole('button', { name: 'Reassign' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Ravi Field/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Assign' }).click()
  await expect(page.getByText("That field agent works in this business, so they can't visit it. Choose someone else.")).toBeVisible()
  expect(nobodys.assignedTo).toEqual({ id: 'u7', name: 'Kiran Field' })

  // The chosen agent left the team meanwhile: said in the sheet, the choice clears and the list loses them
  await page.getByRole('dialog').getByRole('button', { name: /Mohan Field/ }).click()
  api.team = api.team.filter((m) => m.userId !== 'u8')
  await page.getByRole('dialog').getByRole('button', { name: 'Assign' }).click()
  await expect(page.getByRole('dialog').getByText("That person isn't a field agent on the team any more. Reload the team and choose again.")).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('button', { name: /Mohan Field/ })).toBeHidden()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Assign' })).toBeDisabled()
})

test('a business that is no longer waiting offers no Assign', async ({ page, context, api }) => {
  const live = api.addShop({ name: 'Live Cuts', status: 'APPROVED' })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto(`/shops/${live.id as string}`)
  await expect(page.getByText('Visit by Ravi Field')).toBeVisible()
  await expect(page.getByRole('button', { name: /^(Assign|Reassign)$/ })).toBeHidden()
})

test('assigning a business someone decided meanwhile closes the sheet and says what it is now', async ({ page, context, api }) => {
  api.team.push(MockApi.teamMember({ userId: 'u7', name: 'Kiran Field', phone: '9000000007', pincodes: ['500072'], since: '2026-10-05T05:00:00Z' }))
  const shop = api.addShop({ name: 'Raju Hair', assignedTo: null })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto(`/shops/${shop.id as string}`)
  await page.getByRole('button', { name: 'Assign', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Kiran Field/ }).click()
  api.setStatus(shop.id as string, 'APPROVED')
  await page.getByRole('dialog').getByRole('button', { name: 'Assign' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByText('Someone else decided meanwhile: it is now Live.')).toBeVisible()
  await expect(page.getByText('No field agent')).toBeVisible()
})

test('a super admin made a field agent while using the site never sees the old lists', async ({ page, context, api }) => {
  await page.clock.install()
  api.addShop({ name: 'Ravi Visits' })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Waiting for first visit: 1' })).toBeVisible()
  // Made a field agent elsewhere: the minute's /admin/me re-read brings the new role, and the counts read under
  // the old one are read again for the new one, with no reload
  api.setRole('ADMIN')
  await page.clock.runFor(61_000)
  await expect(page.getByText('Only the businesses assigned to you')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Waiting for first visit: 0' })).toBeVisible()
})

test('More names a field agent as "Admin · Field agent"', async ({ page, context, api }) => {
  await signedIn(context, api, 'ADMIN')
  await page.goto('/more')
  await expect(page.getByText('Admin · Field agent', { exact: true })).toBeVisible()
})
