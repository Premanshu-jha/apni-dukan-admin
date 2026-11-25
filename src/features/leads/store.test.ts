import { beforeEach, describe, expect, it } from 'vitest'
import { loadSaved, MAX_AGE_MS, saveScan } from './savedScans'
import { useLeads } from './store'

const medchal = { district: 'Medchal Malkajgiri', state: 'Telangana' }
const hyd = { district: 'Hyderabad', state: 'Telangana' }

describe('leads store', () => {
  beforeEach(() => useLeads.getState().reset())

  it('removing a district drops its areas from the ticks and the area search', () => {
    const s = useLeads.getState()
    s.addDistrict(medchal)
    s.addDistrict(hyd)
    s.knowAreas(medchal, ['500072', '500085'])
    s.knowAreas(hyd, ['500073'])
    s.select(['500072', '500073'], true)
    s.setAreaFilter(['500085', '500073'])
    useLeads.getState().removeDistrict(medchal)
    expect(useLeads.getState().districts).toEqual([hyd])
    expect(useLeads.getState().selected).toEqual(['500073'])
    expect(useLeads.getState().areaFilter).toEqual(['500073'])
  })

  it('sign-out forgets the districts, ticks and results (a shared phone shows the next person none)', () => {
    const s = useLeads.getState()
    s.addDistrict(medchal)
    s.select(['500072'], true)
    useLeads.getState().reset()
    const after = useLeads.getState()
    expect(after.districts).toEqual([])
    expect(after.selected).toEqual([])
    expect(after.scans).toEqual({})
    expect(localStorage.getItem('ada.leads.districts')).toBeNull()
  })
})

describe('areas saved on the page', () => {
  const scan = (pincode: string) => ({
    pincode, places: 'P', district: 'D', state: 'S', shops: [], clozestOnly: [], requests: 1, partial: false, capReached: false,
    usage: { month: '2026-11', used: 1, cap: 10 },
  })

  beforeEach(() => {
    useLeads.getState().reset()
    sessionStorage.clear()
  })

  it('a reload brings back what this person searched; sign-out forgets it, also from storage', async () => {
    await saveScan('ravi', scan('500072'))
    await useLeads.getState().hydrate('ravi')
    expect(Object.keys(useLeads.getState().scans)).toEqual(['500072'])
    expect(useLeads.getState().hydrating).toBe(false)
    useLeads.getState().reset()
    expect(useLeads.getState().scans).toEqual({})
    expect(await loadSaved('ravi')).toEqual([])
  })

  it('another person signing in on the same tab sees none of the first one\'s areas, also mid-load', async () => {
    await saveScan('ravi', scan('500072'))
    const loading = useLeads.getState().hydrate('ravi')
    useLeads.getState().reset()
    await useLeads.getState().hydrate('sita')
    await loading
    expect(useLeads.getState().user).toBe('sita')
    expect(useLeads.getState().scans).toEqual({})
    expect(useLeads.getState().hydrating).toBe(false)
  })

  it('drops areas older than a day while the page stays open', async () => {
    const t = Date.now()
    await saveScan('ravi', scan('500072'), t)
    await useLeads.getState().hydrate('ravi')
    useLeads.getState().dropOld(t + MAX_AGE_MS + 1)
    expect(useLeads.getState().scans).toEqual({})
    expect(await loadSaved('ravi', t + 1)).toEqual([])
  })
})
