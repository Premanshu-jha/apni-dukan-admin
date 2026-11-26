import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { leadsApi } from '../../api/leads'
import { ApiError } from '../../api/errors'
import type { LeadAreaStatus, LeadScan, LeadShop } from '../../api/types'
import { applyRefresh, areasFor, later, MAX_AREAS, REFRESH_PER_CHECK, seenOf, sinceOf, watchList } from './liveUpdates'
import { loadSaved, saveScan } from './savedScans'
import { useLeads } from './store'

const shop = (id: string, extra: Partial<LeadShop> = {}): LeadShop => ({
  mapboxId: id, name: id, address: null, latitude: 17.49, longitude: 78.4, pincode: '500072', onMapbox: true, kind: 'LADIES_PARLOUR',
  chain: false, score: 80, priority: 'HIGH', phone: '9133576278', website: null, hours: null, lead: null, clozest: null, matchKey: 'k-' + id, ...extra,
})
const scan = (pincode: string, shops: LeadShop[] = [shop('mb-a', { pincode }), shop('mb-b', { pincode })], asOf = '2026-11-26T06:00:00.000Z'): LeadScan => ({
  pincode, places: 'P', district: 'D', state: 'S', shops, clozestOnly: [], requests: 1, partial: false, capReached: false,
  usage: { month: '2026-11', used: 1, cap: 10 }, asOf,
})
const lead = { status: 'CALLED' as const, note: '', assignedTo: null, followUpOn: null, whatsappOk: false, whatsappOkAt: null, whatsappOkBy: null, signedUpAt: null, creditedTo: null, version: 1, updatedAt: null, updatedBy: null }
const status = (pincode: string, extra: Partial<LeadAreaStatus> = {}): LeadAreaStatus => ({
  pincode, shops: [{ mapboxId: 'mb-a', lead: null, clozest: { shopId: null, name: 'A on Clozest', status: 'PENDING_VISIT' } }, { mapboxId: 'mb-b', lead, clozest: null }],
  saved: [], clozestOnly: [], asOf: '2026-11-26T06:05:00.000Z', ...extra,
})
const T = (m: number) => `2026-11-26T06:${String(m).padStart(2, '0')}:00.000Z`

describe('live updates: the pure parts', () => {
  it('asks from the later of the last check and the answer; an area saved before checks asks from long ago (brought up to date once)', () => {
    expect(sinceOf(scan('500072'), undefined)).toBe(T(0))
    expect(sinceOf(scan('500072'), T(1))).toBe(T(1))
    expect(sinceOf({ ...scan('500072'), asOf: undefined }, undefined)).toBe('2000-01-01T00:00:00.000Z')
    expect(later(undefined, 'b')).toBe('b')
  })

  it('watches the searched areas and the pincodes of their businesses, the longest waiting first, at most 300', () => {
    const scans = {
      '500072': scan('500072', [shop('mb-a', { pincode: '500072' }), shop('mb-next', { pincode: '500085' }), shop('mb-bad', { pincode: '' })], T(2)),
      '500090': scan('500090', [shop('mb-c', { pincode: '500090' })], T(1)),
    }
    expect(watchList(scans, {})).toEqual([
      { pincode: '500090', since: T(1) },
      { pincode: '500072', since: T(2) },
      { pincode: '500085', since: T(2) },
    ])
    // A watched pincode that isn't searched itself asks from its own last check when that is later
    expect(watchList(scans, { '500085': T(4) }).find((w) => w.pincode === '500085')!.since).toBe(T(4))
    expect(areasFor(new Set(['500085']), scans, {})).toEqual(['500072'])
    const many = Object.fromEntries(Array.from({ length: 320 }, (_, i) => [`5${String(i).padStart(5, '0')}`, scan(`5${String(i).padStart(5, '0')}`, [])]))
    expect(watchList(many, {})).toHaveLength(MAX_AREAS)
  })

  it("sends each business with its point only when it is in India, and the scan's key for its phone", () => {
    const seen = seenOf(scan('500072', [shop('mb-a'), shop('mb-saved', { onMapbox: false, latitude: 0, longitude: 0, name: 'x'.repeat(400), matchKey: undefined })]))
    expect(seen[0]).toEqual({ mapboxId: 'mb-a', name: 'mb-a', latitude: 17.49, longitude: 78.4, phone: '9133576278', matchKey: 'k-mb-a' })
    expect(seen[1]).toMatchObject({ mapboxId: 'mb-saved', latitude: null, longitude: null, matchKey: null })
    expect(seen[1].name).toHaveLength(300)
  })

  it('a refresh changes only the leads and Clozest salons, adds contacted leads not shown (marked), counts what changed', () => {
    const before = scan('500072', [shop('mb-a', { name: 'Tia' }), shop('mb-b'), shop('mb-c')])
    const { scan: after, changed } = applyRefresh(before, status('500072', {
      saved: [shop('mb-new', { onMapbox: false }), shop('mb-c', { onMapbox: false })],
      clozestOnly: [{ shopId: null, name: 'Gem', status: 'APPROVED', latitude: 1, longitude: 2 }],
    }))
    expect(after.shops.map((s) => s.mapboxId)).toEqual(['mb-a', 'mb-b', 'mb-c', 'mb-new'])
    expect(after.shops[0]).toMatchObject({ name: 'Tia', clozest: { name: 'A on Clozest' } })
    expect(after.shops[1].lead).toEqual(lead)
    expect(after.shops[2]).toBe(before.shops[2])
    expect(after.shops[3].addedLive).toBe(true)
    expect(changed).toBe(3)
    expect(after.clozestOnly).toHaveLength(1)
    expect(after.asOf).toBe(T(5))
    // Nothing new: nothing changed
    expect(applyRefresh(after, status('500072')).changed).toBe(0)
  })
})

describe('live updates: the store', () => {
  beforeEach(async () => {
    useLeads.getState().reset()
    sessionStorage.clear()
    await useLeads.getState().hydrate('ravi')
    useLeads.setState({ scans: { '500072': scan('500072'), '500085': scan('500085') }, savedAt: { '500072': Date.now(), '500085': Date.now() } })
  })
  afterEach(() => vi.restoreAllMocks())

  it('brings a changed area up to date and keeps it through a reload; an unchanged one asks from the new time next', async () => {
    const changes = vi.spyOn(leadsApi, 'changes').mockResolvedValue({ asOf: T(4), areas: [{ pincode: '500072', changedAt: T(3) }] })
    const refresh = vi.spyOn(leadsApi, 'refresh').mockResolvedValue(status('500072'))
    expect(await useLeads.getState().checkChanges()).toBe(2)
    expect(changes).toHaveBeenCalledWith([{ pincode: '500072', since: T(0) }, { pincode: '500085', since: T(0) }], expect.any(AbortSignal))
    expect(refresh).toHaveBeenCalledWith('500072', expect.arrayContaining([expect.objectContaining({ mapboxId: 'mb-a', matchKey: 'k-mb-a' })]), expect.any(AbortSignal))
    const s = useLeads.getState()
    expect(s.scans['500072'].shops[0].clozest?.name).toBe('A on Clozest')
    expect(s.checkedAt).toEqual({ '500072': T(5), '500085': T(4) })
    expect(s.confirmedAt['500072']).toBeGreaterThan(0)
    expect(s.live).toMatchObject({ pending: 0, updated: 2 })
    expect(s.live.okAt).not.toBeNull()
    await vi.waitFor(async () => expect((await loadSaved('ravi')).find((x) => x.pincode === '500072')?.scan.shops[0].clozest?.name).toBe('A on Clozest'))

    changes.mockResolvedValue({ asOf: T(6), areas: [] })
    expect(await useLeads.getState().checkChanges()).toBe(0)
    expect(changes).toHaveBeenLastCalledWith([{ pincode: '500085', since: T(4) }, { pincode: '500072', since: T(5) }], expect.any(AbortSignal))
  })

  it('a change filed under the next pincode brings up to date the area showing that business', async () => {
    useLeads.setState({ scans: { '500072': scan('500072', [shop('mb-a', { pincode: '500085' }), shop('mb-b')]) } })
    vi.spyOn(leadsApi, 'changes').mockResolvedValue({ asOf: T(4), areas: [{ pincode: '500085', changedAt: T(3) }] })
    const refresh = vi.spyOn(leadsApi, 'refresh').mockResolvedValue(status('500072'))
    await useLeads.getState().checkChanges()
    expect(refresh).toHaveBeenCalledWith('500072', expect.anything(), expect.anything())
    // Once every area showing it is up to date, the next pincode asks from the check's time
    expect(useLeads.getState().checkedAt['500085']).toBe(T(4))
  })

  it('a change under the next pincode is not lost when the area showing it could not be brought up to date', async () => {
    useLeads.setState({ scans: { '500072': scan('500072', [shop('mb-a', { pincode: '500085' }), shop('mb-b')]) } })
    const changes = vi.spyOn(leadsApi, 'changes').mockResolvedValue({ asOf: T(4), areas: [{ pincode: '500085', changedAt: T(3) }] })
    vi.spyOn(leadsApi, 'refresh').mockRejectedValueOnce(new ApiError(503, { code: 'SERVICE_BUSY', message: 'busy' }))
    await useLeads.getState().checkChanges()
    // Still waiting: it says so, and the next check asks both pincodes from before the change
    expect(useLeads.getState().live.pending).toBe(1)
    changes.mockResolvedValue({ asOf: T(6), areas: [] })
    await useLeads.getState().checkChanges()
    expect(changes).toHaveBeenLastCalledWith([{ pincode: '500072', since: T(0) }, { pincode: '500085', since: T(0) }], expect.any(AbortSignal))
  })

  it('one check at a time: a slow one is never doubled', async () => {
    let answer: (v: { asOf: string; areas: [] }) => void = () => {}
    const changes = vi.spyOn(leadsApi, 'changes').mockReturnValue(new Promise((r) => (answer = r)))
    const first = useLeads.getState().checkChanges()
    expect(await useLeads.getState().checkChanges()).toBe(0)
    answer({ asOf: T(4), areas: [] })
    await first
    expect(changes).toHaveBeenCalledTimes(1)
  })

  it('a refused or failed check changes nothing, shows no error, and says it could not check', async () => {
    vi.spyOn(leadsApi, 'changes').mockRejectedValue(new ApiError(429, { code: 'TOO_MANY_REQUESTS', message: 'slow down' }))
    const before = useLeads.getState().scans
    expect(await useLeads.getState().checkChanges()).toBe(0)
    expect(useLeads.getState().scans).toBe(before)
    expect(useLeads.getState().stopped).toBeNull()
    expect(useLeads.getState().live.failedAt).not.toBeNull()
  })

  it(`at most ${REFRESH_PER_CHECK} areas a check, longest waiting first; too many refreshes stop the rest until the next check`, async () => {
    const pins = Array.from({ length: 8 }, (_, i) => `5000${70 + i}`)
    // The last pincodes waited longest
    useLeads.setState({ scans: Object.fromEntries(pins.map((p, i) => [p, scan(p, [shop('mb-' + p, { pincode: p })], T(10 - i))])) })
    vi.spyOn(leadsApi, 'changes').mockResolvedValue({ asOf: T(20), areas: pins.map((p) => ({ pincode: p, changedAt: T(15) })) })
    const refresh = vi.spyOn(leadsApi, 'refresh').mockImplementation(async (p) => status(p, { asOf: T(20) }))
    await useLeads.getState().checkChanges()
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(['500077', '500076', '500075', '500074', '500073'])
    expect(useLeads.getState().live.pending).toBe(3)
    // The areas not refreshed keep their old time: the next check finds them again, first
    expect(useLeads.getState().checkedAt['500070']).toBeUndefined()

    refresh.mockReset().mockRejectedValueOnce(new ApiError(429, { code: 'TOO_MANY_REQUESTS', message: 'slow down' }))
    await useLeads.getState().checkChanges()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh.mock.calls[0][0]).toBe('500072')
  })

  it('one area the server refuses (too big, no longer in the list) is skipped and the others go on', async () => {
    vi.spyOn(leadsApi, 'changes').mockResolvedValue({ asOf: T(4), areas: [{ pincode: '500072', changedAt: T(3) }, { pincode: '500085', changedAt: T(3) }] })
    const refresh = vi.spyOn(leadsApi, 'refresh')
      .mockRejectedValueOnce(new ApiError(413, { code: 'REQUEST_TOO_LARGE', message: 'big' }))
      .mockResolvedValueOnce(status('500085'))
    await useLeads.getState().checkChanges()
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(useLeads.getState().checkedAt['500072']).toBe(T(4))
    expect(useLeads.getState().scans['500085'].shops[0].clozest?.name).toBe('A on Clozest')
  })

  it('an area searched again (or a lead saved) while its refresh was on the way keeps the newer result', async () => {
    vi.spyOn(leadsApi, 'changes').mockResolvedValue({ asOf: T(4), areas: [{ pincode: '500072', changedAt: T(3) }] })
    const fresh = scan('500072', [shop('mb-fresh')], T(10))
    vi.spyOn(leadsApi, 'refresh').mockImplementation(async (p) => {
      useLeads.setState((s) => ({ scans: { ...s.scans, [p]: fresh } }))
      return status(p)
    })
    expect(await useLeads.getState().checkChanges()).toBe(0)
    expect(useLeads.getState().scans['500072']).toBe(fresh)
  })

  it('signing out during a check or a refresh shows the next person nothing from it', async () => {
    vi.spyOn(leadsApi, 'changes').mockResolvedValue({ asOf: T(4), areas: [{ pincode: '500072', changedAt: T(3) }] })
    vi.spyOn(leadsApi, 'refresh').mockImplementation(async (p) => {
      useLeads.getState().reset()
      return status(p)
    })
    expect(await useLeads.getState().checkChanges()).toBe(0)
    expect(useLeads.getState().scans).toEqual({})
    expect(useLeads.getState().live.okAt).toBeNull()
  })
})

describe('saving an area often', () => {
  beforeEach(() => sessionStorage.clear())

  it('an older save finishing after a newer one never wins', async () => {
    const older = saveScan('ravi', scan('500072', [shop('mb-old')]))
    const newer = saveScan('ravi', scan('500072', [shop('mb-new')]))
    await Promise.all([newer, older])
    expect((await loadSaved('ravi'))[0].scan.shops[0].mapboxId).toBe('mb-new')
  })
})
