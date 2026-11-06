import { ADMIN_MESSAGES, ApiError, explain, fieldError, isNetwork, phoneError, retryDelay, wrongStatusText } from './errors'

const err = (status: number, code: string, message = 'backend words', details: Record<string, unknown> = {}) =>
  new ApiError(status, { code, message, details })

describe('error explanations', () => {
  it('uses the agreed words for every admin refusal in the contract', () => {
    expect(explain(err(409, 'SHOP_CHANGED'))).toBe('This shop changed since you opened it (the owner or another admin). Reload and check again.')
    expect(explain(err(409, 'REAL_ACCOUNT'))).toBe('That number already has a real account (a customer or a shop). Use a number nobody has signed in with.')
    expect(explain(err(409, 'TEST_PHONE'))).toBe("This is a test number, or an account made in test mode, so it can't be an admin.")
    for (const code of ['ALREADY_ADMIN', 'TEST_PHONE', 'CANT_REMOVE_SUPER_ADMIN', 'ADMIN_PHONE', 'REAL_ACCOUNT', 'ALREADY_TEST_PHONE', 'CUSTOMER_NOT_FOUND', 'STRIKE_NOT_FOUND', 'INVALID_PHONE', 'SUPER_ADMIN_ONLY']) {
      expect(explain(err(409, code))).toBe(ADMIN_MESSAGES[code])
      expect(ADMIN_MESSAGES[code].length).toBeGreaterThan(10)
    }
  })

  it('says what the shop is now on WRONG_STATUS (details.status)', () => {
    expect(wrongStatusText(err(409, 'WRONG_STATUS', 'x', { status: 'APPROVED' }))).toBe('Someone else decided meanwhile: it is now Live.')
    expect(explain(err(409, 'WRONG_STATUS', 'x', { status: 'DRAFT' }))).toBe('Someone else decided meanwhile: it is now Sent back to the owner.')
    expect(explain(err(409, 'WRONG_STATUS'))).toBe('Someone else decided meanwhile.')
  })

  it('puts INVALID_PHONE (no details) on the phone field, and knows a network failure', () => {
    expect(phoneError(err(400, 'INVALID_PHONE'))).toBe("That isn't a valid mobile number. Check the 10 digits.")
    expect(phoneError(err(400, 'VALIDATION_FAILED', 'x', { phone: 'is wrong' }))).toBe('is wrong')
    expect(phoneError(err(409, 'ALREADY_ADMIN'))).toBeUndefined()
    expect(isNetwork(ApiError.network())).toBe(true)
    expect(isNetwork(err(503, 'SERVICE_BUSY'))).toBe(false)
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

describe('retry delay', () => {
  it("waits as long as the backend's Retry-After asks (at most 30 s), else 1 s, 2 s, 4 s…", () => {
    expect(retryDelay(0, new ApiError(503, { code: 'SERVICE_BUSY' }, 5))).toBe(5000)
    expect(retryDelay(0, new ApiError(503, { code: 'SERVICE_BUSY' }, 600))).toBe(30_000)
    expect(retryDelay(0, ApiError.network())).toBe(1000)
    expect(retryDelay(2, new Error('x'))).toBe(4000)
  })

  it('spells out a refused search', () => {
    expect(explain(err(400, 'VALIDATION_FAILED', 'Some fields are not valid', { q: 'type at least 3 letters' }))).toBe(
      'The search: type at least 3 letters.',
    )
  })
})
