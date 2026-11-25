import { Link } from 'react-router'
import { useAnalyticsSalons } from '../../api/admin'
import { explain } from '../../api/errors'
import type { SalonUse } from '../../api/types'
import { Button, Chip, EmptyState, ErrorState, Loading, Pill } from '../../components/ui'
import { todayInIndia } from '../../lib/time'
import { Freshness, Stat, Stats, addDays, count, dayLabel } from './common'

/**
 * How much each approved salon uses Clozest: when its owner or staff last opened it, its bookings over 30 days and
 * how far its setup is. Least used first, to call the quiet ones; or busiest first.
 */
export function SalonsSection({
  pincode,
  sort,
  onSort,
  onAllAreas,
}: {
  pincode: string | null
  sort: 'quiet' | 'bookings'
  onSort: (sort: 'quiet' | 'bookings') => void
  onAllAreas: () => void
}) {
  const q = useAnalyticsSalons(sort, pincode)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Order">
        <Chip selected={sort === 'quiet'} onClick={() => onSort('quiet')}>
          Least used first
        </Chip>
        <Chip selected={sort === 'bookings'} onClick={() => onSort('bookings')}>
          Most bookings first
        </Chip>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError && !q.data ? (
        <ErrorState message={explain(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <Freshness q={q} />
          <Stats>
            <Stat label="Quiet salons" value={count(q.data.pages[0].quietSalons)} note="approved, nobody opened Clozest in 7 days" />
          </Stats>
          {q.data.pages[0].salons.length === 0 ? (
            <EmptyState
              title="No approved salons"
              body={pincode ? `None in ${pincode}.` : 'They appear here once approved.'}
              action={
                pincode ? (
                  <button type="button" className="text-link underline" onClick={onAllAreas}>
                    See all areas
                  </button>
                ) : undefined
              }
            />
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Salons">
              {q.data.pages.flatMap((p) => p.salons).map((s) => (
                <li key={s.shopId}>
                  <SalonCard s={s} />
                </li>
              ))}
            </ul>
          )}
          {q.hasNextPage && (
            <Button variant="secondary" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              Show more salons
            </Button>
          )}
          {q.isFetchNextPageError && <p className="text-sm text-bad">Couldn&apos;t load more. {explain(q.error)}</p>}
          <p className="text-xs text-muted">Always the last 30 days (whatever days are picked elsewhere), worked out every hour. Bookings: online bookings.</p>
        </>
      )}
    </div>
  )
}

function SalonCard({ s }: { s: SalonUse }) {
  const today = todayInIndia()
  const quiet = !s.lastActiveDay || s.lastActiveDay < addDays(today, -7)
  const last = !s.lastActiveDay ? 'Not opened in the last 35 days' : s.lastActiveDay === today ? 'Opened today' : `Last opened ${dayLabel(s.lastActiveDay)}`
  const setup = [
    s.services === 0 && 'no services',
    s.staff === 0 && 'no barbers',
    s.pictures < 3 && `${s.pictures} of 3 photos and video`,
  ].filter(Boolean)
  return (
    <Link to={`/shops/${s.shopId}`} className="flex flex-col gap-1 rounded-xl border border-line bg-surface px-4 py-3 hover:bg-raised">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{s.name}</span>
        {quiet ? <Pill tone="warn">Quiet</Pill> : <Pill tone="good">Active</Pill>}
      </span>
      <span className="text-sm text-muted">
        {[s.area, s.pincode].filter(Boolean).join(' · ')} · {last}
      </span>
      <span className="text-sm tabular-nums">
        {count(s.bookings30d)} bookings · {count(s.completed30d)} done · {count(s.walkIns30d)} walk-ins · {count(s.noShows30d)} didn&apos;t come
      </span>
      {setup.length > 0 && <span className="text-sm text-warn">Setup: {setup.join(', ')}</span>}
    </Link>
  )
}
