import { NavLink, Outlet } from 'react-router'
import { tabsFor } from '../lib/roles'
import { useAdmin } from './guards'

/** The signed-in app: the screen, with the bottom bar (Team and Test mode only for the super admin). */
export function Shell() {
  const tabs = tabsFor(useAdmin().adminRole)
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
              `flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${isActive ? 'text-brand' : 'text-muted'}`
            }
          >
            <span aria-hidden className="text-lg leading-none">
              {t.icon}
            </span>
            {t.label}
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
