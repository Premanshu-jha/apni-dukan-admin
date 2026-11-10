import { describe, expect, it } from 'vitest'
import { clock12, rupees } from './salon'

describe('a salon’s hours and prices', () => {
  it('shows times on a 12-hour clock, with midnight by name', () => {
    expect(clock12('10:00')).toBe('10:00 AM')
    expect(clock12('21:30')).toBe('9:30 PM')
    expect(clock12('00:00')).toBe('12:00 AM')
    expect(clock12('12:15')).toBe('12:15 PM')
    expect(clock12('24:00')).toBe('midnight')
  })

  it('shows prices in rupees, "from" when they can go up', () => {
    expect(rupees(15000, false)).toBe('₹150')
    expect(rupees(14950, false)).toBe('₹149.50')
    expect(rupees(150000, true)).toBe('from ₹1,500')
  })
})
