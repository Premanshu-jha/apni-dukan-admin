import { beforeEach, describe, expect, it } from 'vitest'
import type { LeadScan } from '../../api/types'
import { forgetAll, forgetScans, loadSaved, MAX_AGE_MS, saveScan } from './savedScans'

function scan(pincode: string, shops = 0): LeadScan {
  return {
    pincode, places: `Place ${pincode}`, district: 'D', state: 'S', clozestOnly: [], requests: 40, partial: false, capReached: false,
    usage: { month: '2026-11', used: 40, cap: 20000 },
    shops: Array.from({ length: shops }, (_, i) => ({
      mapboxId: `mb-${pincode}-${i}`, name: `Parlour ${i}`, address: 'Road 1, Kukatpally', latitude: 17.49, longitude: 78.4, pincode, onMapbox: true,
      kind: 'LADIES_PARLOUR', chain: false, score: 60, priority: 'MEDIUM', phone: '9133576278', website: null, hours: null, lead: null, clozest: null,
    })),
  }
}

describe('searched areas kept in this tab', () => {
  beforeEach(() => sessionStorage.clear())

  it('keeps a search for this tab and person (a reload reads it back), and another person sees none', async () => {
    await saveScan('ravi', scan('500072', 3))
    const back = await loadSaved('ravi')
    expect(back.map((s) => s.pincode)).toEqual(['500072'])
    expect(back[0].scan.shops).toHaveLength(3)
    expect(await loadSaved('sita')).toEqual([])
  })

  it('forgets after a day', async () => {
    const now = Date.now()
    await saveScan('ravi', scan('500072'), now - MAX_AGE_MS - 1)
    await saveScan('ravi', scan('500085'), now)
    expect((await loadSaved('ravi', now)).map((s) => s.pincode)).toEqual(['500085'])
    expect(sessionStorage.getItem('ada.leads.scan.500072')).toBeNull()
  })

  it('search again, clear saved results and sign-out forget what they should', async () => {
    await saveScan('ravi', scan('500072'))
    await saveScan('ravi', scan('500085'))
    forgetScans(['500072'])
    expect((await loadSaved('ravi')).map((s) => s.pincode)).toEqual(['500085'])
    forgetAll()
    expect(await loadSaved('ravi')).toEqual([])
  })

  it('a save still compressing when everything is forgotten (sign-out, Clear) is not written afterwards', async () => {
    const pending = saveScan('ravi', scan('500072', 50))
    forgetAll()
    await pending
    expect(sessionStorage.getItem('ada.leads.scan.500072')).toBeNull()
  })

  it('a damaged entry is dropped, not shown', async () => {
    sessionStorage.setItem('ada.leads.scan.500072', '{"user":"ravi","savedAt":1,"data":"z:not-gzip"}')
    sessionStorage.setItem('ada.leads.scan.500085', 'not json')
    expect(await loadSaved('ravi', 2)).toEqual([])
    expect(sessionStorage.getItem('ada.leads.scan.500072')).toBeNull()
  })
})
