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

/** The bottom bar: Team and Test mode only for the super admin. */
export function tabsFor(role: AdminRole): Tab[] {
  return [
    { to: '/', label: 'Shops', icon: '▦' },
    { to: '/support', label: 'Support', icon: '☏' },
    ...(isSuperAdmin(role)
      ? [
          { to: '/team', label: 'Team', icon: '☺' },
          { to: '/test-mode', label: 'Test mode', icon: '⚑' },
        ]
      : []),
    { to: '/more', label: 'More', icon: '☰' },
  ]
}
