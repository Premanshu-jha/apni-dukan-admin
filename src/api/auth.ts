import { deviceName } from '../lib/device'
import { api } from './client'
import type { Tokens, User } from './types'

const A = '/api/v1/auth'

/** The sign-in calls, as in the partner app. */
export const authApi = {
  sendCode: (phone: string, captchaToken: string | null) =>
    api<void>('POST', `${A}/otp/send`, { body: { phone, captchaToken }, auth: false }),
  verifyCode: (phone: string, code: string) =>
    api<Tokens>('POST', `${A}/otp/verify`, { body: { phone, code, device: deviceName() }, auth: false }),
  logout: (refreshToken: string, signal?: AbortSignal) =>
    api<void>('POST', `${A}/logout`, { body: { refreshToken }, auth: false, signal }),
  rename: (name: string) => api<User>('PATCH', `${A}/me`, { body: { name } }),
  sendEmailCode: (email: string) => api<void>('POST', `${A}/email/send-code`, { body: { email, phoneCode: null } }),
  verifyEmail: (email: string, code: string) => api<User>('POST', `${A}/email/verify`, { body: { email, code } }),
  startRecovery: (email: string, newPhone: string, captchaToken: string | null) =>
    api<void>('POST', `${A}/recover/start`, { body: { email, newPhone, captchaToken }, auth: false }),
  completeRecovery: (email: string, emailCode: string, newPhone: string, phoneCode: string) =>
    api<Tokens>('POST', `${A}/recover/complete`, {
      body: { email, emailCode, newPhone, phoneCode, device: deviceName() },
      auth: false,
    }),
}
