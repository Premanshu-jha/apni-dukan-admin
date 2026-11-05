import type { User } from '../../api/types'
import { isTeam, roleOf } from '../../lib/roles'
import { storage } from '../../lib/storage'
import { missingSteps } from '../../store/session'

const RETURN_KEY = 'ada.returnTo'

/** Remember where the person was going (a shop link sent on WhatsApp), so sign-in can bring them back there. */
export function rememberReturn(path: string) {
  if (path.startsWith('/signin') || path.startsWith('/welcome')) return
  storage.set(RETURN_KEY, path)
}

/** Forget the saved place once the person has arrived in the app. */
export function forgetReturn() {
  storage.remove(RETURN_KEY)
}

/**
 * Where to go after a sign-in step. Someone not on the team goes to "/" (which says this site is for the team) and
 * never gets the email and name steps; a team member finishes the missing steps, then goes back to where they
 * started.
 */
export function nextAfterSignIn(user: User): string {
  if (!isTeam(roleOf(user))) return '/'
  const missing = missingSteps(user)
  if (missing[0] === 'email') return '/welcome/email'
  if (missing[0] === 'name') return '/welcome/name'
  const back = storage.get(RETURN_KEY)
  return back && back.startsWith('/') && !back.startsWith('//') ? back : '/'
}
