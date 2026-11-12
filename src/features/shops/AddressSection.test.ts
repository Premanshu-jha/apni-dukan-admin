import { describe, expect, it } from 'vitest'
import { checkAddress, mapUrl, metresBetween } from './AddressSection'

const ok = { addressLine: 'Shop 3, Sector 18 Market', area: 'Sector 18', city: 'Noida', pincode: '201301', latitude: '28.57', longitude: '77.32' }

describe('changing an address by hand', () => {
  it('takes what the backend takes', () => {
    expect(checkAddress(ok)).toEqual({})
  })

  it('says what is wrong, field by field, as the backend would', () => {
    expect(checkAddress({ ...ok, addressLine: 'Sh 3', pincode: '01301', latitude: '50', longitude: 'x' })).toEqual({
      addressLine: 'Enter the shop number, building and street (5 to 200 letters)',
      pincode: 'Enter the 6-digit pincode',
      latitude: 'A latitude in India, like 17.4401',
      longitude: 'A longitude in India, like 78.3489',
    })
    expect(checkAddress({ ...ok, latitude: ' ' }).latitude).toBeDefined()
  })

  it('measures how far the pin moves and links each pin', () => {
    expect(Math.round(metresBetween({ latitude: 28.627, longitude: 77.372 }, { latitude: 28.627, longitude: 77.372 }))).toBe(0)
    // About 111 m per thousandth of a degree of latitude
    expect(Math.round(metresBetween({ latitude: 28.627, longitude: 77.372 }, { latitude: 28.628, longitude: 77.372 }))).toBe(111)
    expect(mapUrl(28.57, 77.32)).toBe('https://www.google.com/maps/search/?api=1&query=28.57,77.32')
  })
})
