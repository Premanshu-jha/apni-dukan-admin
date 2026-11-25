import type { DayRange } from '../../api/admin'
import { useAnalyticsBookings } from '../../api/admin'
import { explain } from '../../api/errors'
import { Card, ErrorState, Loading } from '../../components/ui'
import { BarChart } from './BarChart'
import { Freshness, Section, Stat, Stats, VISIT_LABELS, count, dayLabel, perDay, sum } from './common'

/**
 * Bookings over the days chosen: made each day, what became of them, the busiest hours and areas. For one area
 * (pincode) only bookings made and visits each day are kept.
 */
export function BookingsSection({ range, pincode, onArea }: { range: DayRange; pincode: string | null; onArea: (pincode: string) => void }) {
  const q = useAnalyticsBookings(range, pincode)
  if (q.isPending) return <Loading />
  if (q.isError && !q.data) return <ErrorState message={explain(q.error)} onRetry={() => void q.refetch()} />
  const b = q.data
  const made = perDay(b.created, b)
  const days = `${dayLabel(b.from)} – ${dayLabel(b.to)}`
  if (b.pincode) {
    const visits = perDay(b.visits, b)
    return (
      <div className="flex flex-col gap-4">
        <Freshness q={q} />
        <p className="text-sm text-muted">{days}</p>
        <Stats>
          <Stat label={`Bookings made in ${b.pincode}`} value={count(sum(b.created))} />
          <Stat label="Visits (done or still to come)" value={count(sum(b.visits))} note="bookings and walk-ins" />
        </Stats>
        <BarChart title={`Bookings made each day in ${b.pincode}`} bars={made.map((d) => ({ label: dayLabel(d.day), value: d.value }))} />
        <BarChart title={`Visits each day in ${b.pincode}`} bars={visits.map((d) => ({ label: dayLabel(d.day), value: d.value }))} />
        <p className="text-xs text-muted">Clear the pincode to see the outcomes, busiest hours and areas for all of them.</p>
      </div>
    )
  }
  const totalVisits = sum(b.visitsByStatus)
  const done = sum(b.visitsByStatus, (d) => d.endsWith(':COMPLETED'))
  const noShows = sum(b.visitsByStatus, (d) => d === 'BOOKING:NO_SHOW')
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
  return (
    <div className="flex flex-col gap-4">
      <Freshness q={q} />
      <p className="text-sm text-muted">{days}</p>
      <Stats>
        <Stat label="Bookings made" value={count(sum(b.created))} note="counted on the day they were made" />
        <Stat label="Visits done" value={count(done)} note="bookings and walk-ins, on the day of the visit" />
        <Stat label="Customer didn’t come" value={count(noShows)} />
      </Stats>
      <BarChart title="Bookings made each day" bars={made.map((d) => ({ label: dayLabel(d.day), value: d.value }))} />
      <Section title="What became of the visits on these days">
        {totalVisits === 0 ? (
          <p className="text-sm text-muted">No bookings or walk-ins on these days.</p>
        ) : (
          <Card className="flex flex-col gap-1 text-sm">
            {b.visitsByStatus.map((v) => (
              <p key={v.dim} className="flex justify-between gap-2">
                <span className="text-muted">{VISIT_LABELS[v.dim] ?? v.dim}</span>
                <span className="tabular-nums">
                  {count(v.value)} <span className="text-muted">({Math.round((v.value / totalVisits) * 100)}%)</span>
                </span>
              </p>
            ))}
          </Card>
        )}
        <p className="text-xs text-muted">Bookings and walk-ins, counted on the day of the visit (percent of all of them).</p>
      </Section>
      <BarChart
        title="Busiest hours (visits, India time)"
        bars={hours.map((h) => ({ label: h, value: b.busiestHours.find((x) => x.dim === h)?.value ?? 0, tip: `${h}:00–${h}:59: ${count(b.busiestHours.find((x) => x.dim === h)?.value ?? 0)} visits` }))}
      />
      <Section title="Busiest areas (bookings made; tap one to see only it)">
        {b.topAreas.length === 0 ? (
          <p className="text-sm text-muted">No bookings on these days.</p>
        ) : (
          <Card className="flex flex-col gap-1 text-sm">
            {b.topAreas.map((a, i) => (
              <button
                key={a.dim}
                type="button"
                className="flex min-h-10 items-center justify-between gap-2 rounded-lg px-1 text-left hover:bg-raised"
                onClick={() => onArea(a.dim)}
              >
                <span className="text-muted">
                  {i + 1}. {a.dim}
                </span>
                <span className="tabular-nums">{count(a.value)} ›</span>
              </button>
            ))}
          </Card>
        )}
      </Section>
    </div>
  )
}
