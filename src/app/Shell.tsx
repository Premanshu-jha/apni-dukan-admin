import { NavLink, Outlet } from 'react-router'
import { useTicketCounts } from '../api/admin'
import { handlesTickets, tabsFor } from '../lib/roles'
import { useAdmin } from './guards'

/**
 * The signed-in app: the screen, with the bottom bar (Team and Test mode only for the super admin; a support person
 * has Tickets and More). Tickets shows how many of mine wait on us (plus Unassigned for super admins).
 */
export function Shell() {
  const me = useAdmin()
  const tabs = tabsFor(me.adminRole, me.designation)
  const counts = useTicketCounts(handlesTickets(me.adminRole, me.designation))
  const waiting = (counts.data?.mineOpen ?? 0) + (counts.data?.unassigned ?? 0)
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col md:max-w-2xl">
      <div className="flex flex-1 flex-col">
        <Outlet />
      </div>
      <nav
        aria-label="Main"
        className="sticky bottom-0 z-20 grid border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${isActive ? 'text-link' : 'text-muted'}`
            }
          >
            <span aria-hidden className="relative text-lg leading-none">
              {t.icon}
              {t.to === '/tickets' && waiting > 0 && (
                <span className="absolute -right-3 -top-1 min-w-4 rounded-full bg-bad px-1 text-[10px] font-bold leading-4 text-white">
                  {waiting > 99 ? '99+' : waiting}
                </span>
              )}
            </span>
            {t.label}
            {t.to === '/tickets' && waiting > 0 && <span className="sr-only">, {waiting} waiting on us</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

/** Sign-in and full-screen steps: no bottom bar. */
export function Bare() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <Outlet />
    </div>
  )
}
