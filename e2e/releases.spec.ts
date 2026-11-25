import { atDashboard, expect, signedIn, test } from './helpers'

test('a super admin finds App releases from More, pulls a bad release back and puts it back', async ({ page, context, api }) => {
  api.addRelease('partner', 240)
  api.addRelease('partner', 245)
  api.addRelease('partner', 246, 'UPLOADING')
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/more')
  await page.getByRole('link', { name: 'App releases' }).click()
  await expect(page.getByRole('heading', { name: 'App releases' })).toBeVisible()

  const list = page.getByRole('list', { name: 'Releases' })
  await expect(list.getByRole('listitem')).toHaveCount(3)
  const newest = list.getByRole('listitem').filter({ hasText: 'Build 245' })
  await expect(newest.getByText('Newest live')).toBeVisible()
  await expect(list.getByRole('listitem').filter({ hasText: 'Build 246' }).getByText('Not finished', { exact: true })).toBeVisible()

  // Pulling back asks first, naming where phones go
  await newest.getByRole('button', { name: 'Pull back' }).click()
  const sheet = page.getByRole('dialog', { name: 'Pull back build 245?' })
  await expect(sheet.getByText(/Phones on it move back to build 240 over their next two openings/)).toBeVisible()
  await sheet.getByRole('button', { name: 'Keep it live' }).click()
  await expect(newest.getByText('Live', { exact: true })).toBeVisible()
  await newest.getByRole('button', { name: 'Pull back' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Pull back build 245' }).click()
  await expect(newest.getByText('Pulled back', { exact: true })).toBeVisible()
  await expect(list.getByRole('listitem').filter({ hasText: 'Build 240' }).getByText('Newest live')).toBeVisible()
  expect(api.calledTimes('POST', '/api/v1/admin/app-releases/partner/245/pull-back')).toBe(1)

  await newest.getByRole('button', { name: 'Put back' }).click()
  await expect(newest.getByText('Newest live')).toBeVisible()

  // The customer app has its own list
  await page.getByRole('button', { name: 'Customer app' }).click()
  await expect(page.getByText('No releases yet')).toBeVisible()
})

test('the version numbers are checked before saving, and another super admin’s save is never overwritten', async ({ page, context, api }) => {
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/app-releases')
  const store = page.getByLabel('Version on the Play Store')
  const min = page.getByLabel('Oldest allowed version')
  const save = page.getByRole('button', { name: 'Save' })
  await expect(save).toBeDisabled()

  await min.fill('120')
  await expect(page.getByText('Fill in the Play Store version first')).toBeVisible()
  await expect(save).toBeDisabled()
  await store.fill('100')
  await expect(page.getByText("Can't be newer than the version on the Play Store")).toBeVisible()
  await expect(save).toBeDisabled()
  await store.fill('12a')
  await expect(page.getByText('A version number is a whole number, like 245')).toBeVisible()
  await store.fill('150')
  // Raising the oldest allowed version blocks older phones: asked first
  await save.click()
  const confirm = page.getByRole('dialog', { name: 'Block versions older than 120?' })
  await confirm.getByRole('button', { name: "Don't change it" }).click()
  expect(api.calls.some((c) => c.method === 'PUT')).toBe(false)
  await save.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Block older versions' }).click()
  await expect(page.getByText('Saved. Phones follow the next time the app is opened.')).toBeVisible()
  expect(api.calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ storeVersionCode: 150, minVersionCode: 120, version: 0 })
  await expect(page.getByText(/Last changed by/)).toBeVisible()

  // Another super admin saves meanwhile: ours is refused and the page shows theirs
  api.appReleases.partner.settings = { ...api.appReleases.partner.settings, storeVersionCode: 160, version: 2 }
  await store.fill('170')
  await save.click()
  await expect(page.getByText(/Another super admin changed these numbers/)).toBeVisible()
  await expect(store).toHaveValue('160')
})

test('a field agent has no App releases', async ({ page, context, api }) => {
  await atDashboard(page, context, api, 'ADMIN')
  await page.goto('/more')
  await expect(page.getByRole('link', { name: 'App releases' })).toBeHidden()
  await page.goto('/app-releases')
  await expect(page.getByRole('heading', { name: 'Businesses' })).toBeVisible()
  expect(api.calls.some((c) => c.path.startsWith('/api/v1/admin/app-releases'))).toBe(false)
})

test('a release another super admin pulled back first: the reason shows in the sheet, which closes once the list updates', async ({ page, context, api }) => {
  api.addRelease('partner', 240)
  api.addRelease('partner', 245)
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/app-releases')
  const card = page.getByRole('list', { name: 'Releases' }).getByRole('listitem').filter({ hasText: 'Build 245' })
  await card.getByRole('button', { name: 'Pull back' }).click()
  // Meanwhile, someone else pulls it back
  Object.assign(api.appReleases.partner.releases.find((r) => r.build === 245)!, { status: 'PULLED' })
  await page.getByRole('dialog').getByRole('button', { name: 'Pull back build 245' }).click()
  await expect(card.getByText('Pulled back', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(card.getByText(/already pulled back/)).toBeVisible()
})

test('a warning when releases are live but no Play Store version is filled in', async ({ page, context, api }) => {
  api.addRelease('partner', 240)
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/app-releases')
  await expect(page.getByText(/phones from the Play Store get none of these releases yet/)).toBeVisible()
})

test('a pull-back that fails offline says why inside the sheet, which stays open to try again', async ({ page, context, api }) => {
  api.addRelease('partner', 240)
  api.addRelease('partner', 245)
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/app-releases')
  const card = page.getByRole('list', { name: 'Releases' }).getByRole('listitem').filter({ hasText: 'Build 245' })
  await card.getByRole('button', { name: 'Pull back' }).click()
  await page.route('**/api/v1/admin/app-releases/partner/245/pull-back', (route) => route.abort())
  const sheet = page.getByRole('dialog', { name: 'Pull back build 245?' })
  await sheet.getByRole('button', { name: 'Pull back build 245' }).click()
  await expect(sheet.getByRole('alert')).toBeVisible()
  await expect(sheet).toBeVisible()
})

test('a serious fix is marked urgent with what it fixes, and can be taken back', async ({ page, context, api }) => {
  api.addRelease('partner', 250)
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/app-releases')
  const card = page.getByRole('list', { name: 'Releases' }).getByRole('listitem').filter({ hasText: 'Build 250' })
  await card.getByRole('button', { name: 'Mark urgent' }).click()
  const sheet = page.getByRole('dialog', { name: 'Mark build 250 urgent?' })
  await expect(sheet.getByText(/Use it only for serious fixes/)).toBeVisible()
  await expect(sheet.getByText(/Only for the team \(not shown on phones\)/)).toBeVisible()
  // A note is needed first
  const confirm = sheet.getByRole('button', { name: 'Mark urgent' })
  await expect(confirm).toBeDisabled()
  await sheet.getByLabel('What does it fix?').fill('  Wrong   total on bills ')
  await confirm.click()
  await expect(card.getByText('Urgent', { exact: true })).toBeVisible()
  await expect(card.getByText(/Wrong total on bills/)).toBeVisible()
  await expect(card.getByText(/marked by/)).toBeVisible()
  expect(api.calls.find((c) => c.path.endsWith('/250/urgent'))?.body).toEqual({ note: 'Wrong total on bills' })

  await card.getByRole('button', { name: 'Not urgent any more' }).click()
  const undo = page.getByRole('dialog', { name: 'Build 250 not urgent any more?' })
  await expect(undo.getByText(/Phones that already restarted keep the fix/)).toBeVisible()
  await undo.getByRole('button', { name: 'Not urgent any more' }).click()
  await expect(card.getByRole('button', { name: 'Mark urgent' })).toBeVisible()
  await expect(card.getByText('Urgent', { exact: true })).toHaveCount(0)
})

test('a release CI marked urgent from an [urgent] PR says so', async ({ page, context, api }) => {
  api.addRelease('partner', 260)
  Object.assign(api.appReleases.partner.releases[0], { urgent: true, urgentNote: 'Payments failing', urgentAt: new Date().toISOString(), urgentByName: null })
  await signedIn(context, api, 'SUPER_ADMIN')
  await page.goto('/app-releases')
  await expect(page.getByText(/Payments failing/)).toBeVisible()
  await expect(page.getByText(/from an \[urgent\] PR/)).toBeVisible()
})
