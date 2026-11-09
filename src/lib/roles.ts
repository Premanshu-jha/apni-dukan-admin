import type { AdminRole, User } from '../api/types'

/** Only people on the Clozest team get past the sign-in. */
export function isTeam(role: AdminRole | null | undefined): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

export function isSuperAdmin(role: AdminRole | null | undefined): boolean {
  return role === 'SUPER_ADMIN'
}

/** The role the sign-in token's user carries (an older saved session has none: not on the team). */
export function roleOf(user: User | null | undefined): AdminRole {
  return user?.adminRole ?? 'NONE'
}

export interface Tab {
  to: string
  label: string
  icon: string
}

/**
 * The bottom bar. A field agent (ADMIN) sees only the businesses assigned to them; Support, Team and Test mode are
 * for super admins.
 */
export function tabsFor(role: AdminRole): Tab[] {
  return [
    { to: '/', label: 'Businesses', icon: '▦' },
    ...(isSuperAdmin(role)
      ? [
          { to: '/support', label: 'Support', icon: '☏' },
          { to: '/team', label: 'Team', icon: '☺' },
          { to: '/test-mode', label: 'Test mode', icon: '⚑' },
        ]
      : []),
    { to: '/more', label: 'More', icon: '☰' },
  ]
}
