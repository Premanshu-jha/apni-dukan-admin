import { addPincodes, isPincode, looksLikeAList, typedPincode } from './pincodes'

describe('pincodes', () => {
  it('takes 6 digits not starting with 0, as the backend does', () => {
    expect(isPincode('500072')).toBe(true)
    expect(isPincode('050072')).toBe(false)
    expect(isPincode('50007')).toBe(false)
    expect(isPincode('5000721')).toBe(false)
    expect(isPincode('50007a')).toBe(false)
  })

  it('keeps only digits while typing, 6 at most', () => {
    expect(typedPincode('50a00 72')).toBe('500072')
    expect(typedPincode('5000721')).toBe('500072')
    expect(typedPincode('')).toBe('')
  })

  it('adds each valid pincode once, in order, and returns the rest to show', () => {
    const r = addPincodes(['500072'], '500085, 500072\n012345 50004;201309  500085')
    expect(r.next).toEqual(['500072', '500085', '201309'])
    expect(r.added).toEqual(['500085', '201309'])
    expect(r.duplicates).toEqual(['500072', '500085'])
    expect(r.invalid).toEqual(['012345', '50004'])
    expect(addPincodes([], '   ').next).toEqual([])
  })

  it('tells a pasted list from one pincode', () => {
    expect(looksLikeAList('500072')).toBe(false)
    expect(looksLikeAList(' 500072 ')).toBe(false)
    expect(looksLikeAList('500072, 500085')).toBe(true)
    expect(looksLikeAList('500072500085')).toBe(true)
  })
})

describe('pincode limit', () => {
  it(`keeps at most ${300} and counts the rest`, async () => {
    const { addPincodes: add, MAX_PINCODES } = await import('./pincodes')
    const full = Array.from({ length: MAX_PINCODES - 1 }, (_, i) => String(100000 + i))
    const r = add(full, '600001 600002 600003')
    expect(r.next).toHaveLength(MAX_PINCODES)
    expect(r.added).toEqual(['600001'])
    expect(r.overLimit).toBe(2)
  })
})
