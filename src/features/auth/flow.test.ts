import type { User } from '../../api/types'
import { forgetReturn, nextAfterSignIn, rememberReturn } from './flow'

const user = (over: Partial<User> = {}): User => ({
  id: 'u1',
  phone: '9848012345',
  name: 'Asha',
  email: 'a@x.in',
  emailVerified: true,
  admin: true,
  adminRole: 'ADMIN',
  ...over,
})

describe('where sign-in goes next', () => {
  beforeEach(() => localStorage.clear())

  it('sends someone not on the team to "/" (the not-for-you screen), never to the email or name steps', () => {
    expect(nextAfterSignIn(user({ adminRole: 'NONE', admin: false, email: null, emailVerified: false, name: null }))).toBe('/')
    // An older saved session without adminRole counts as not on the team
    expect(nextAfterSignIn(user({ adminRole: undefined, email: null, emailVerified: false }))).toBe('/')
  })

  it('takes an admin through email, then name, then back to where they were going', () => {
    expect(nextAfterSignIn(user({ email: null, emailVerified: false, name: null }))).toBe('/welcome/email')
    expect(nextAfterSignIn(user({ name: ' ' }))).toBe('/welcome/name')
    rememberReturn('/shops/shop7')
    expect(nextAfterSignIn(user({ adminRole: 'SUPER_ADMIN' }))).toBe('/shops/shop7')
    forgetReturn()
    expect(nextAfterSignIn(user())).toBe('/')
  })

  it('never remembers sign-in pages or another site', () => {
    rememberReturn('/signin/code')
    expect(nextAfterSignIn(user())).toBe('/')
    localStorage.setItem('ada.returnTo', '//evil.example')
    expect(nextAfterSignIn(user())).toBe('/')
  })
})
