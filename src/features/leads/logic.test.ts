import { describe, expect, it } from 'vitest'
import type { LeadArea, LeadScan, LeadShop } from '../../api/types'
import { areaRows, copyText, filterRows, leadIn, matchAreas, NO_FILTERS, rowsOf, shownAreas, summarize } from './logic'

function shop(id: string, extra: Partial<LeadShop> = {}): LeadShop {
  return {
    mapboxId: id, name: id, address: 'Road 1', latitude: 17.49, longitude: 78.4, pincode: '500072', onMapbox: true,
    kind: 'LADIES_PARLOUR', chain: false, score: 60, priority: 'MEDIUM', phone: '9133576278', website: null,
    hours: { days: 7, opens: '1000', closes: '2000', late: false }, lead: null, clozest: null, ...extra,
  }
}

function scan(pincode: string, shops: LeadShop[], clozestOnly: LeadScan['clozestOnly'] = []): LeadScan {
  return {
    pincode, places: `Place ${pincode}`, district: 'D', state: 'S', shops, clozestOnly, requests: 1, partial: false, capReached: false,
    usage: { month: '2026-11', used: 1, cap: 10 },
  }
}

const lead = (extra: Partial<NonNullable<LeadShop['lead']>> = {}): NonNullable<LeadShop['lead']> => ({
  status: 'CALLED', note: '', assignedTo: null, followUpOn: null, whatsappOk: false, whatsappOkAt: null, whatsappOkBy: null,
  signedUpAt: null, creditedTo: null, version: 2, updatedAt: null, updatedBy: null, ...extra,
})

describe('rowsOf', () => {
  it('lists a business two overlapping areas both found once, and each Clozest-only salon once', () => {
    const salon = { shopId: 's1', name: 'Gem', status: 'APPROVED' as const, latitude: 1, longitude: 2 }
    const rows = rowsOf([scan('500072', [shop('a'), shop('b')], [salon]), scan('500085', [shop('b'), shop('c')], [salon])])
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'salon:s1', 'c'])
    expect(rows.find((r) => r.key === 'b')?.area).toBe('500072')
  })
})

describe('filterRows', () => {
  const rows = rowsOf([
    scan(
      '500072',
      [
        shop('tia', { score: 90, name: "Tia's Parlour" }),
        shop('lakme', { chain: true, score: 20, phone: null, kind: 'UNISEX_SALON', name: 'Lakme' }),
        shop('rich', { score: 70, name: 'Rich Look', clozest: { shopId: null, name: 'Rich Look', status: 'APPROVED' }, lead: lead({ assignedTo: { id: 'me', name: 'Me' } }) }),
        shop('signed', { score: 50, name: 'Signed', lead: lead({ status: 'INTERESTED', signedUpAt: '2026-11-20T00:00:00Z' }) }),
      ],
      [{ shopId: null, name: 'Gem', status: 'PENDING_VISIT', latitude: 1, longitude: 2 }],
    ),
  ])
  const keys = (f: Partial<typeof NO_FILTERS>) => filterRows(rows, { ...NO_FILTERS, ...f }, 'me').map((r) => r.key)

  it('shows everything best first by default, the salons without a score last', () => {
    expect(keys({})).toEqual(['tia', 'rich', 'signed', 'lakme', 'salon:Gem@1,2'])
  })
  it('filters by being on Clozest, and by the Clozest status', () => {
    expect(keys({ clozest: 'ON' })).toEqual(['rich', 'salon:Gem@1,2'])
    expect(keys({ clozest: 'ON', clozestStatus: 'PENDING_VISIT' })).toEqual(['salon:Gem@1,2'])
    expect(keys({ clozest: 'OFF' })).toEqual(['tia', 'signed', 'lakme'])
  })
  it('a lead filter leaves out salons that have no lead', () => {
    expect(keys({ status: 'NEW' })).toEqual(['tia', 'lakme'])
    expect(keys({ status: 'SIGNED' })).toEqual(['signed'])
    expect(keys({ mineOnly: true })).toEqual(['rich'])
    expect(keys({ phoneOnly: true, chain: 'LOCAL' })).toEqual(['tia', 'rich', 'signed'])
    expect(keys({ kind: 'UNISEX_SALON' })).toEqual(['lakme'])
  })
  it('searches names, addresses and phones, and salons by name', () => {
    expect(keys({ text: 'tia' })).toEqual(['tia'])
    expect(keys({ text: 'gem' })).toEqual(['salon:Gem@1,2'])
    expect(keys({ sort: 'NAME' })).toEqual(['salon:Gem@1,2', 'lakme', 'rich', 'signed', 'tia'])
  })
})

describe('numbers', () => {
  it('summarizes the list and compares the areas, with who is left to reach', () => {
    const scans = [
      scan('500072', [shop('a'), shop('b', { chain: true }), shop('c', { lead: lead() }), shop('d', { clozest: { shopId: null, name: 'd', status: 'APPROVED' } })]),
      scan('500085', [shop('e', { phone: null, hours: null })], [{ shopId: 's', name: 's', status: 'APPROVED', latitude: 1, longitude: 2 }]),
    ]
    expect(summarize(rowsOf(scans))).toMatchObject({ businesses: 5, local: 4, withPhone: 4, onClozest: 2, contacted: 1 })
    const [first, second] = areaRows(scans)
    expect(first).toMatchObject({ pincode: '500072', businesses: 4, local: 3, onClozest: 1, contacted: 1, toReach: 1, openAllWeek: 4 })
    expect(second).toMatchObject({ pincode: '500085', businesses: 1, onClozest: 1, toReach: 0, openAllWeek: 0 })
  })

  it('counts no answer as still to reach, not contacted (as the backend counts)', () => {
    const scans = [scan('500072', [shop('a', { lead: lead({ status: 'NO_ANSWER' }) })])]
    expect(summarize(rowsOf(scans))).toMatchObject({ contacted: 0 })
    expect(areaRows(scans)[0]).toMatchObject({ contacted: 0, toReach: 1 })
  })
})

describe('area search', () => {
  const areas: LeadArea[] = [
    { pincode: '500072', places: 'Kukatpally, Vivekanandanagar Colony', mine: true, onMap: true, contacted: 0, interested: 0, signedUp: 0, onClozest: 0 },
    { pincode: '500085', places: 'JNTU, KPHB Colony', mine: false, onMap: true, contacted: 0, interested: 0, signedUp: 0, onClozest: 0 },
  ]
  it('matches a pincode by its start and a place by any part, leaving out those chosen', () => {
    expect(matchAreas(areas, '5000', []).map((a) => a.pincode)).toEqual(['500072', '500085'])
    expect(matchAreas(areas, 'colony', ['500072']).map((a) => a.pincode)).toEqual(['500085'])
    expect(matchAreas(areas, '  ', [])).toEqual([])
  })
  it('shows the chosen areas, or every area when none is chosen', () => {
    expect(shownAreas(areas, ['500085']).map((a) => a.pincode)).toEqual(['500085'])
    expect(shownAreas(areas, [])).toHaveLength(2)
  })
})

describe('leadIn', () => {
  const edit = { status: 'CALLED' as const, note: '  Call at 6  ', assignedTo: null, followUpOn: '', whatsappOk: true }
  it("sends the map's details, the version shown, and WhatsApp consent only for a contacted mobile", () => {
    expect(leadIn(shop('a'), lead({ version: 4 }), edit)).toEqual({
      status: 'CALLED', note: 'Call at 6', assignedTo: null, followUpOn: null, whatsappOk: true, pincode: '500072', name: 'a',
      phone: '9133576278', latitude: 17.49, longitude: 78.4, version: 4,
    })
    expect(leadIn(shop('a', { phone: '040 2354 4236' }), null, edit)).toMatchObject({ phone: null, whatsappOk: false, version: null })
    expect(leadIn(shop('a'), null, { ...edit, status: 'NEW' })).toMatchObject({ whatsappOk: false })
    // A saved lead with no point (from the follow-ups list) sends none
    expect(leadIn({ ...shop('a'), onMapbox: false, latitude: 0, longitude: 0 }, null, edit)).toMatchObject({ latitude: null, longitude: null })
  })
})

describe('copyText', () => {
  it('writes one tab-separated row per business with no tabs or line breaks inside cells', () => {
    const rows = rowsOf([scan('500072', [shop('a', { name: 'A\tB', lead: lead({ note: 'line1\nline2' }) })])])
    const lines = copyText(rows, { '500072': 'Kukatpally' }).split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1].split('\t')).toHaveLength(13)
    expect(lines[1]).toContain('A B')
    expect(lines[1]).toContain('line1 line2')
  })
})
