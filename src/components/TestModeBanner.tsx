import { Link } from 'react-router'
import { useMe } from '../api/admin'
import { isSuperAdmin } from '../lib/roles'
import { testModeActive, testModeText } from '../lib/time'
import { useNow } from '../lib/useNow'

/**
 * The red line on every screen while OTP test mode is on: test numbers then sign in with any code, so nobody
 * should forget it is on. It goes by itself when the end time passes (and on the next /admin/me).
 */
export function TestModeBanner() {
  const me = useMe()
  const now = useNow(15_000)
  const flag = me.data?.testMode
  if (!testModeActive(flag, now)) return null
  return (
    <div role="alert" className="sticky top-0 z-40 bg-bad px-4 py-2 text-center text-sm font-semibold text-bg">
      {testModeText(flag!.until, now)}
      {/* Test mode is no longer a tab: the warning itself leads to where it is switched off */}
      {isSuperAdmin(me.data?.adminRole) && (
        <>
          {' '}
          <Link to="/test-mode" className="underline">
            Turn it off
          </Link>
        </>
      )}
    </div>
  )
}
