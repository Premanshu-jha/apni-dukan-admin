import { expect, signedIn, test } from './helpers'
import { MockApi } from './mockApi'
import type { BrowserContext } from '@playwright/test'

/** Signed in as a support person (an ADMIN with the SUPPORT designation). */
async function asSupport(context: BrowserContext, api: MockApi) {
  await signedIn(context, api, 'ADMIN')
  api.user = { ...api.user, designation: 'SUPPORT', name: 'Neha Support' }
  api.team = api.team.map((m) => (m.userId === api.user.id ? { ...m, designation: 'SUPPORT', pincodes: [], name: 'Neha Support' } : m))
}

test('a support person sees only their tickets: Tickets and More, and business addresses go to the tickets', async ({ page, context, api }) => {
  await asSupport(context, api)
  api.addTicket({ subject: 'Offer not applied' })
  api.addTicket({ subject: 'Someone else has this', assigneeId: 'u9' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My tickets' })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveText([/Tickets/, /More/])
  await expect(nav.getByRole('link', { name: /Tickets/ })).toContainText('1')   // one waiting on them
  await expect(page.getByText('Offer not applied')).toBeVisible()
  await expect(page.getByText('Someone else has this')).toBeHidden()
  for (const path of ['/shops', '/shops/s1', '/team', '/support']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'My tickets' })).toBeVisible()
  }
  expect(api.calls.some((c) => c.path.startsWith('/api/v1/admin/dashboard') || c.path.startsWith('/api/v1/admin/shops'))).toBe(false)
})

test('a ticket shows who asked with their profile; the typed reply survives leaving; Send & resolve sends once', async ({ page, context, api }) => {
  await asSupport(context, api)
  const t = api.addTicket({ subject: 'Offer not applied to my booking SB12' })
  await page.goto('/tickets')
  await page.getByText('Offer not applied to my booking SB12').click()
  await expect(page.getByRole('heading', { name: 'CLZ-1001' })).toBeVisible()
  await expect(page.getByText('Phone: 9811122233')).toBeVisible()
  await expect(page.getByText('The salon says it is fine but the app shows cancelled.')).toBeVisible()

  await page.getByLabel('Your reply (emailed to them)').fill('We have applied the offer and refunded ₹50.')
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByText('Offer not applied to my booking SB12').click()
  await expect(page.getByLabel('Your reply (emailed to them)')).toHaveValue('We have applied the offer and refunded ₹50.')

  await page.getByRole('button', { name: 'Send & resolve' }).dblclick()
  await expect(page.getByText('Sent and resolved. They get your reply by email.')).toBeVisible()
  expect(api.replies).toEqual([{ id: t.id, body: 'We have applied the offer and refunded ₹50.', resolve: true }])
  await expect(page.getByLabel('Reply (opens it again)')).toHaveValue('')
  await expect(page.getByText('An email to them is on its way.')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Reply (opens it again)')).toHaveValue('')   // the sent draft is forgotten
})

test('they wrote again while the reply was typed: refused, their new message shows, the reply stays', async ({ page, context, api }) => {
  await asSupport(context, api)
  const t = api.addTicket()
  await page.goto(`/tickets/${t.id}`)
  await page.getByLabel('Your reply (emailed to them)').fill('Fixed it.')
  api.incoming(t.id, 'Actually it was booking SB99, sorry!')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByText('They wrote again while you were typing. Read their new message')).toBeVisible()
  await expect(page.getByText('Actually it was booking SB99, sorry!')).toBeVisible()
  await expect(page.getByLabel('Your reply (emailed to them)')).toHaveValue('Fixed it.')
  expect(api.replies).toEqual([])
  // Re-read: Send waits until they say they've read it
  await expect(page.getByRole('button', { name: 'Send reply' })).toBeDisabled()
  await page.getByRole('button', { name: "I've read it" }).click()
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByText('Sent. They get your reply by email.')).toBeVisible()
})

test('close without a reply, with a confirm; a deleted account has no reply box', async ({ page, context, api }) => {
  await asSupport(context, api)
  const t = api.addTicket({ requesterEmail: null, requester: 'Deleted account', profile: [] })
  await page.goto(`/tickets/${t.id}`)
  await expect(page.getByText("They deleted their account, so there's no address to reply to.")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send reply' })).toBeHidden()
  await page.getByRole('button', { name: 'Close without reply' }).click()
  await page.getByRole('button', { name: 'Close it' }).click()
  await expect(page.getByText('Closed. Nobody was emailed.')).toBeVisible()
  expect(t.status).toBe('RESOLVED')
})

test("a ticket that isn't theirs (moved meanwhile) says so, also when it moves while open", async ({ page, context, api }) => {
  await asSupport(context, api)
  api.addTicket({ assigneeId: 'u9' })
  await page.goto('/tickets/t1001')
  await expect(page.getByText("This ticket isn't yours")).toBeVisible()
  const t = api.addTicket()
  await page.goto(`/tickets/${t.id}`)
  await page.getByLabel('Your reply (emailed to them)').fill('Looking into it')
  t.assigneeId = 'u9'
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByText("This ticket isn't yours")).toBeVisible()
})

test('a forged-looking email says to confirm who it is; the phone is tappable', async ({ page, context, api }) => {
  await asSupport(context, api)
  const t = api.addTicket({ senderVerified: false, source: 'EMAIL' })
  await page.goto(`/tickets/${t.id}`)
  await expect(page.getByText("We couldn't prove this email came from ravi@gmail.com")).toBeVisible()
  await expect(page.getByRole('link', { name: '9811122233' })).toHaveAttribute('href', 'tel:+919811122233')
})

test('signing out forgets unsent replies; the next person sees none', async ({ page, context, api }) => {
  await asSupport(context, api)
  const t = api.addTicket()
  await page.goto(`/tickets/${t.id}`)
  await page.getByLabel('Your reply (emailed to them)').fill('Half written')
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ada.ticketDraft.')).length)).toBe(1)
  await page.goto('/more')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ada.ticketDraft.')).length)).toBe(0)
})

test('super admin: counts per person, Unassigned, and giving a ticket to a support person', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  api.team.push(MockApi.teamMember({ userId: 's1', name: 'Neha Support', phone: '9800000001', designation: 'SUPPORT', since: '2026-11-01T05:00:00Z' }))
  api.addTicket({ subject: 'Mine to answer', assigneeId: 's1' })
  api.addTicket({ subject: 'Nobody has this', assigneeId: null })
  await page.goto('/tickets')
  await expect(page.getByRole('heading', { name: 'Support tickets' })).toBeVisible()
  await expect(page.getByRole('row', { name: /Neha Support 1 0 0/ })).toBeVisible()
  await page.getByRole('button', { name: '1 unassigned: show them' }).click()
  await expect(page).toHaveURL(/view=UNASSIGNED/)
  await page.getByText('Nobody has this').click()
  await page.getByRole('button', { name: 'Give to someone else' }).click()
  await page.getByRole('button', { name: 'Neha Support · 1 not resolved' }).click()
  await expect(page.getByText('Given to Neha Support.')).toBeVisible()
  await expect(page.getByText('With: Neha Support')).toBeVisible()
})

test('team: a support person is added without pincodes', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/team/new')
  await page.getByLabel('Name').fill('Neha Support')
  await page.getByLabel('Mobile number').fill('9000000066')
  await page.getByLabel('Email').fill('neha@example.com')
  await page.getByRole('button', { name: 'Support', exact: true }).click()
  await expect(page.getByText('Answers only the support tickets given to them. Sees no businesses.')).toBeVisible()
  await expect(page.getByLabel('Pincodes they cover')).toBeHidden()
  await page.getByRole('button', { name: 'Add to the team' }).click()
  await expect(page.getByText('Neha Support')).toBeVisible()
  const added = api.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/admin/team')
  expect(added?.body).toMatchObject({ role: 'ADMIN', designation: 'SUPPORT', pincodes: [] })
})
