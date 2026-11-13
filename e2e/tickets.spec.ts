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
  await expect(page.getByText('Neha Support', { exact: true })).toBeVisible()
  const added = api.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/admin/team')
  expect(added?.body).toMatchObject({ role: 'ADMIN', designation: 'SUPPORT', pincodes: [] })
})

test('find a ticket by number, mobile or email; "other tickets from them" lists theirs', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  api.addTicket({ subject: 'First question' })
  api.addTicket({ subject: 'Second question' })
  api.addTicket({ subject: 'Someone else', requesterId: 'c2', requesterEmail: 'sita@gmail.com', requester: 'Sita', profile: [] })
  await page.goto('/tickets')
  await page.getByLabel('Find a ticket').fill('clz-1002')
  await expect(page.getByText('Second question')).toBeVisible()
  await expect(page.getByText('First question')).toBeHidden()
  await page.getByLabel('Find a ticket').fill('SITA@gmail.com')
  await expect(page.getByText('Someone else')).toBeVisible()
  await page.getByLabel('Find a ticket').fill('98111 22233')
  await expect(page.getByText('First question')).toBeVisible()
  await expect(page.getByText('Second question')).toBeVisible()
  // A name or half a number: what to type, never an error
  await page.getByLabel('Find a ticket').fill('Asha')
  await expect(page.getByText("Names can't be searched.")).toBeVisible()
  await page.getByLabel('Find a ticket').fill('98111 2')
  await expect(page.getByText("Names can't be searched.")).toBeVisible()
  // An email subject pasted whole
  await page.getByLabel('Find a ticket').fill('Re: [CLZ-1002] Second question')
  await expect(page.getByText('Second question')).toBeVisible()
  await expect(page.getByText('First question')).toBeHidden()
  // Back from a result comes back to the same search
  await page.getByText('Second question').click()
  await expect(page).toHaveURL(/\/tickets\/t1002$/)
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByLabel('Find a ticket')).toHaveValue('Re: [CLZ-1002] Second question')
  await expect(page.getByText('Second question')).toBeVisible()
  // The Tickets tab clears the search
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Tickets/ }).click()
  await expect(page.getByLabel('Find a ticket')).toHaveValue('')
  await expect(page.getByText('First question')).toBeVisible()
  await page.goto('/tickets/t1001')
  await page.getByRole('link', { name: '1 other ticket from them' }).click()
  await expect(page.getByText(/Every ticket from Ravi Customer/)).toBeVisible()
  await expect(page.getByText('Second question')).toBeVisible()
})

test('a closed ticket opens again without emailing anyone', async ({ page, context, api }) => {
  await asSupport(context, api)
  const t = api.addTicket({ status: 'RESOLVED' })
  await page.goto(`/tickets/${t.id}`)
  await page.getByRole('button', { name: 'Open again (no email)' }).click()
  await expect(page.getByText('Opened again. Nobody was emailed.')).toBeVisible()
  expect(t.status).toBe('OPEN')
  expect(api.replies).toEqual([])
})

test("team: move an away support person's open tickets to another, or share them out", async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  api.team.push(MockApi.teamMember({ userId: 's1', name: 'Neha', phone: '9800000001', designation: 'SUPPORT', openTickets: 2, since: '2026-11-01T05:00:00Z' }))
  api.team.push(MockApi.teamMember({ userId: 's2', name: 'Ravi', phone: '9800000002', designation: 'SUPPORT', openTickets: 0, since: '2026-11-02T05:00:00Z' }))
  api.addTicket({ assigneeId: 's1' })
  api.addTicket({ assigneeId: 's1' })
  await page.goto('/team')
  await page.getByRole('button', { name: "Move Neha's open tickets" }).click()
  await page.getByRole('button', { name: 'Ravi · 0 open' }).click()
  // A second tap confirms; until then nothing moved
  await expect(page.getByText('Move all 2 to Ravi?')).toBeVisible()
  expect(api.tickets.every((t) => t.assigneeId === 's1')).toBe(true)
  await page.getByRole('button', { name: 'Yes, move them' }).click()
  await expect(page.getByText('Moved 2 open tickets to Ravi.')).toBeVisible()
  expect(api.tickets.every((t) => t.assigneeId === 's2')).toBe(true)
})

test('test mode is under More for a super admin (five tabs)', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/more')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveCount(5)
  await page.getByRole('link', { name: /Test mode/ }).click()
  await expect(page).toHaveURL(/\/test-mode$/)
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page).toHaveURL(/\/more$/)
})

test("moving tickets: one that the chosen person asked stays and the notice says so", async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  api.team.push(MockApi.teamMember({ userId: 's1', name: 'Neha', phone: '9800000001', designation: 'SUPPORT', openTickets: 2, since: '2026-11-01T05:00:00Z' }))
  api.team.push(MockApi.teamMember({ userId: 's2', name: 'Ravi', phone: '9800000002', designation: 'SUPPORT', openTickets: 0, since: '2026-11-02T05:00:00Z' }))
  api.addTicket({ assigneeId: 's1' })
  api.addTicket({ assigneeId: 's1', requesterId: 's2' })   // Ravi's own question
  await page.goto('/team')
  await page.getByRole('button', { name: "Move Neha's open tickets" }).click()
  await page.getByRole('button', { name: 'Ravi · 0 open' }).click()
  await page.getByRole('button', { name: 'Yes, move them' }).click()
  await expect(page.getByText(/Moved 1 open ticket to Ravi\. 1 stayed with Neha/)).toBeVisible()
})

test('team: mark a support person away (their open tickets go to the others), then back', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  api.team.push(MockApi.teamMember({ userId: 's1', name: 'Neha', phone: '9800000001', designation: 'SUPPORT', openTickets: 2, since: '2026-11-01T05:00:00Z' }))
  api.team.push(MockApi.teamMember({ userId: 's2', name: 'Ravi', phone: '9800000002', designation: 'SUPPORT', openTickets: 0, since: '2026-11-02T05:00:00Z' }))
  api.addTicket({ assigneeId: 's1' })
  api.addTicket({ assigneeId: 's1' })
  await page.goto('/team')
  await page.getByRole('button', { name: 'Mark away: Neha' }).click()
  // Says what happens; nothing changes until the second tap
  await expect(page.getByText(/no new tickets come to them until they are back/)).toBeVisible()
  expect(api.away.size).toBe(0)
  await page.getByRole('button', { name: 'Yes, mark them away' }).click()
  await expect(page.getByText(/Neha is away: no new tickets go to them\. 2 open tickets went to the other support people\./)).toBeVisible()
  expect(api.tickets.every((t) => t.assigneeId === 's2')).toBe(true)
  await expect(page.getByText(/Away since .*: gets no new tickets/)).toBeVisible()
  // Moving someone's tickets never offers a person who is away
  await page.getByRole('button', { name: "Move Ravi's open tickets" }).click()
  await expect(page.getByRole('button', { name: /Neha · / })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()
  // Back: Unassigned ones come to her
  api.addTicket({ assigneeId: null })
  await page.getByRole('button', { name: 'Back from away: Neha' }).click()
  await expect(page.getByText('Neha is back: new tickets go to them again.')).toBeVisible()
  expect(api.away.size).toBe(0)
  expect(api.tickets.some((t) => t.assigneeId === 's1')).toBe(true)
})

test('a support person marks themselves away on their tickets page, and back', async ({ page, context, api }) => {
  await asSupport(context, api)
  await page.goto('/tickets')
  await page.getByRole('button', { name: 'Going on leave? Mark yourself away' }).click()
  await page.getByRole('button', { name: 'Yes, mark me away' }).click()
  await expect(page.getByText("You're marked away: no new tickets come to you.")).toBeVisible()
  await page.getByRole('button', { name: "I'm back" }).click()
  await expect(page.getByText('Welcome back: new tickets come to you again.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Going on leave? Mark yourself away' })).toBeVisible()
})
