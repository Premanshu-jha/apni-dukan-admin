import { howLong } from '../../lib/time'
import { useNow } from '../../lib/useNow'
import { count } from './logic'
import { FRESH_FOR_MS } from './liveUpdates'
import { useLeads } from './store'

const ago = (at: number, now: number) => {
  const text = howLong(new Date(at).toISOString(), now)
  return text === 'just now' ? text : `${text} ago`
}

/**
 * Says whether the searched areas are being kept up to date: "Up to date · checked just now · 2 businesses updated 1
 * min ago", or, when checks don't get through (no connection, refused, server down), that the cards may be older. So a
 * field agent never trusts a list that stopped updating.
 */
export function LiveStatus() {
  const live = useLeads((s) => s.live)
  const any = useLeads((s) => Object.keys(s.scans).length > 0)
  const ticked = useNow(15_000)
  if (!any) return null
  // The clock read every 15 s can be behind the last check: never earlier than what the checks themselves saw
  const now = Math.max(ticked, live.okAt ?? 0, live.failedAt ?? 0)
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  const lastFailed = live.failedAt !== null && (live.okAt === null || live.failedAt > live.okAt)
  const fresh = live.okAt !== null && now - live.okAt < FRESH_FOR_MS
  if (offline || (lastFailed && !fresh)) {
    return (
      <p className="text-sm text-warn" data-testid="live-status">
        Can't check for updates right now{offline ? ' (no connection)' : ''}. Statuses on the cards may be older; they update by themselves once it works again.
      </p>
    )
  }
  if (!fresh) {
    return (
      <p className="text-sm text-muted" data-testid="live-status">
        Checking for updates…
      </p>
    )
  }
  const recent = live.updatedAt !== null && now - live.updatedAt < 10 * 60_000
  return (
    <p className="text-sm text-muted" data-testid="live-status">
      Up to date · checked {ago(live.okAt!, now)}
      {recent && ` · ${count(live.updated)} ${live.updated === 1 ? 'business' : 'businesses'} updated ${ago(live.updatedAt!, now)}`}
      {live.pending > 0 && ` · ${count(live.pending)} more ${live.pending === 1 ? 'area' : 'areas'} updating`}
    </p>
  )
}
