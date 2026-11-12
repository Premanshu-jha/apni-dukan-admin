import type { AdminRole, Designation, User } from '../api/types'

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

/** A support person: an ADMIN whose designation is SUPPORT (only tickets, no businesses). */
export function isSupport(role: AdminRole | null | undefined, designation: Designation | null | undefined): boolean {
  return role === 'ADMIN' && designation === 'SUPPORT'
}

/** Who may work on tickets: support people and super admins. */
export function handlesTickets(role: AdminRole | null | undefined, designation: Designation | null | undefined): boolean {
  return isSuperAdmin(role) || isSupport(role, designation)
}

/**
 * The bottom bar. A field agent sees only the businesses assigned to them; a support person only their tickets;
 * Tickets (everyone's), Strikes, Team and Test mode are for super admins.
 */
export function tabsFor(role: AdminRole, designation?: Designation | null): Tab[] {
  if (isSupport(role, designation)) {
    return [
      { to: '/tickets', label: 'Tickets', icon: '✉' },
      { to: '/more', label: 'More', icon: '☰' },
    ]
  }
  return [
    { to: '/', label: 'Businesses', icon: '▦' },
    ...(isSuperAdmin(role)
      ? [
          { to: '/tickets', label: 'Tickets', icon: '✉' },
          { to: '/support', label: 'Strikes', icon: '☏' },
          { to: '/team', label: 'Team', icon: '☺' },
          { to: '/test-mode', label: 'Test mode', icon: '⚑' },
        ]
      : []),
    { to: '/more', label: 'More', icon: '☰' },
  ]
}
