import { ADMIN_MESSAGES, ApiError, explain, fieldError } from './errors'

const err = (status: number, code: string, message = 'backend words', details: Record<string, unknown> = {}) =>
  new ApiError(status, { code, message, details })

describe('error explanations', () => {
  it('uses the agreed words for every admin refusal in the contract', () => {
    expect(explain(err(409, 'SHOP_CHANGED'))).toBe('The owner changed something; reload and check again')
    for (const code of ['WRONG_STATUS', 'ALREADY_ADMIN', 'TEST_PHONE', 'CANT_REMOVE_SUPER_ADMIN', 'ADMIN_PHONE', 'ALREADY_TEST_PHONE', 'CUSTOMER_NOT_FOUND', 'SUPER_ADMIN_ONLY']) {
      expect(explain(err(409, code))).toBe(ADMIN_MESSAGES[code])
      expect(ADMIN_MESSAGES[code].length).toBeGreaterThan(10)
    }
  })

  it('spells out field reasons for VALIDATION_FAILED', () => {
    const e = err(400, 'VALIDATION_FAILED', 'Some fields are not valid', { reason: 'must be 2 to 200 characters', note: 'is too long' })
    expect(explain(e)).toBe('The reason must be 2 to 200 characters. The note is too long.')
    expect(fieldError(e, 'reason')).toBe('must be 2 to 200 characters')
    expect(fieldError(e, 'label')).toBeUndefined()
    expect(explain(err(400, 'VALIDATION_FAILED', 'Some fields are not valid'))).toBe('Some fields are not valid')
  })

  it("falls back to the backend's message, and a plain one for anything else", () => {
    expect(explain(err(500, 'SERVICE_BUSY', 'Try again in a few seconds.'))).toBe('Try again in a few seconds.')
    expect(explain(ApiError.network())).toMatch(/offline/)
    expect(explain(new Error('x'))).toBe('Something went wrong. Please try again.')
  })
})
