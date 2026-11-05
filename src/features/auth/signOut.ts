import type { QueryClient } from '@tanstack/react-query'
import { authApi } from '../../api/auth'
import { useSession } from '../../store/session'
import { forgetReturn } from './flow'

/** How long sign-out lets the backend's logout run in the background before giving up on it. */
const LOGOUT_TIMEOUT_MS = 4000

/**
 * Ends the session on this browser at once: the session and every cached shop, phone number and note are gone
 * before anything else happens. Then the backend is told in the background (never waited on: a weak network must
 * not keep the next person looking at this one's data). A refresh still on its way ends its own new token (the
 * client checks the session's generation).
 */
export function signOutHere(qc: QueryClient) {
  const { refreshToken, signOut } = useSession.getState()
  signOut()
  forgetThisPerson(qc)
  if (!refreshToken) return
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), LOGOUT_TIMEOUT_MS)
  void authApi
    .logout(refreshToken, stop.signal)
    .catch(() => {
      /* signed out here anyway; the token expires on its own */
    })
    .finally(() => clearTimeout(timer))
}

/**
 * Forgets what this browser holds about the person who was signed in (cached shops, owners' phone numbers, where
 * they were going), so the next person on a shared phone sees none of it. Also run when the session ends elsewhere.
 */
export function forgetThisPerson(qc: QueryClient) {
  forgetReturn()
  void qc.cancelQueries()
  qc.clear()
}
