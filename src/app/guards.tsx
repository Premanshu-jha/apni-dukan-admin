import { createContext, useContext, useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useMe } from '../api/admin'
import { ApiError, messageOf } from '../api/errors'
import type { AdminMe } from '../api/types'
import { TestModeBanner } from '../components/TestModeBanner'
import { ErrorState, Loading } from '../components/ui'
import { forgetReturn, nextAfterSignIn, rememberReturn } from '../features/auth/flow'
import { NotTeam } from '../features/auth/NotTeam'
import { isSuperAdmin, isTeam, roleOf } from '../lib/roles'
import { missingSteps, useSession } from '../store/session'

/** Screens for signed-out people only (sign-in); a signed-in person goes on to the app. */
export function SignedOutOnly() {
  const status = useSession((s) => s.status)
  const user = useSession((s) => s.user)
  if (status === 'starting') return <Loading />
  if (status === 'signedIn' && user) return <Navigate to={nextAfterSignIn(user)} replace />
  return <Outlet />
}

/** The email and name steps: only for a team member who hasn't finished them. */
export function FinishingProfile() {
  const status = useSession((s) => s.status)
  const user = useSession((s) => s.user)
  if (status === 'starting') return <Loading />
  if (status !== 'signedIn' || !user) return <Navigate to="/signin" replace />
  if (!isTeam(roleOf(user)) || missingSteps(user).length === 0) return <Navigate to={nextAfterSignIn(user)} replace />
  return <Outlet />
}

/**
 * Everything else: signed in, on the team (by the sign-in token's adminRole), email and name done. Someone not on
 * the team sees "This is for the Apni Dukan team" on every address, and no admin call is made for them.
 */
export function SignedIn() {
  const status = useSession((s) => s.status)
  const user = useSession((s) => s.user)
  const endedHere = useSession((s) => s.endedHere)
  const location = useLocation()
  const ready = status === 'signedIn' && user !== null && isTeam(roleOf(user)) && missingSteps(user).length === 0
  useEffect(() => {
    if (ready) forgetReturn()
  }, [ready])
  if (status === 'starting') return <Loading />
  if (status !== 'signedIn' || !user) {
    // Coming from a link: come back here after sign-in. Just signed out here: the next person starts at the dashboard.
    if (!endedHere) rememberReturn(location.pathname + location.search)
    return <Navigate to="/signin" replace />
  }
  if (!isTeam(roleOf(user))) return <NotTeam />
  const missing = missingSteps(user)
  if (missing.length) {
    rememberReturn(location.pathname + location.search)
    return <Navigate to={`/welcome/${missing[0]}`} replace />
  }
  return <Outlet />
}

const MeContext = createContext<AdminMe | null>(null)

/** The signed-in admin, from GET /admin/me (inside AdminGate only). */
export function useAdmin(): AdminMe {
  const me = useContext(MeContext)
  if (!me) throw new Error('useAdmin outside AdminGate')
  return me
}

/** A 403 or 404 on /admin/me: this person is no longer on the team (their token is older than the change). */
export function notTeamAnymore(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 403 || (e.status === 404 && e.code === 'NOT_FOUND'))
}

/**
 * Loads GET /admin/me (role and test mode) and gives it to every screen, with the test-mode banner on top.
 * The role here is the backend's current one, so it wins over the role in the saved sign-in.
 */
export function AdminGate() {
  const me = useMe()
  if (me.isPending) return <Loading />
  if (me.isError && !me.data) {
    if (notTeamAnymore(me.error)) return <NotTeam onRecheck={() => void me.refetch()} />
    return <ErrorState message={messageOf(me.error)} onRetry={() => void me.refetch()} />
  }
  // A re-read that fails with "not an admin" while in use: they were removed from the team meanwhile.
  if (me.isError && notTeamAnymore(me.error)) return <NotTeam onRecheck={() => void me.refetch()} />
  if (!isTeam(me.data.adminRole)) return <NotTeam onRecheck={() => void me.refetch()} />
  return (
    <MeContext.Provider value={me.data}>
      <TestModeBanner />
      <Outlet />
    </MeContext.Provider>
  )
}

/** Team and Test mode: the super admin only. An admin who types the address goes to the dashboard. */
export function SuperAdminOnly() {
  const me = useAdmin()
  if (!isSuperAdmin(me.adminRole)) return <Navigate to="/" replace />
  return <Outlet />
}
