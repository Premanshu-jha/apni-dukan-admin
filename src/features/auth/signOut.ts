import type { QueryClient } from '@tanstack/react-query'
import { authApi } from '../../api/auth'
import { refreshSettled } from '../../api/client'
import { useSession } from '../../store/session'
import { forgetReturn } from './flow'

/** Ends the session on this browser: tells the backend, forgets everything local. */
export async function signOutHere(qc: QueryClient) {
  // A refresh on its way would replace the token we are about to sign out: let it finish first.
  await refreshSettled()
  const { refreshToken, signOut } = useSession.getState()
  if (refreshToken) {
    await authApi.logout(refreshToken).catch(() => {
      /* signed out here anyway; the token expires on its own */
    })
  }
  signOut()
  forgetThisPerson(qc)
}

/**
 * Forgets what this browser holds about the person who was signed in (cached shops, owners' phone numbers, where
 * they were going), so the next person on a shared phone sees none of it. Also run when the session ends elsewhere.
 */
export function forgetThisPerson(qc: QueryClient) {
  forgetReturn()
  qc.clear()
}
