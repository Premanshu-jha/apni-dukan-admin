import { beforeEach, describe, expect, it } from 'vitest'
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
