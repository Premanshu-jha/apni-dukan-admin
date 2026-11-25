import type { DayRange } from '../../api/admin'
import { useAnalyticsPeople } from '../../api/admin'
import { explain } from '../../api/errors'
import type { Point } from '../../api/types'
import { Card, ErrorState, Loading } from '../../components/ui'
import { todayInIndia } from '../../lib/time'
import { BarChart } from './BarChart'
import { Freshness, ROLE_LABELS, SALON_STATUS_LABELS, Section, Stat, Stats, count, dayLabel, perDay, sum, valueOf } from './common'

const SIDES = [
  { key: 'CUSTOMER', label: 'Customers' },
  { key: 'PARTNER', label: 'Salons (owners and staff)' },
] as const

/** People: accounts and salons now, signups over the days chosen, how long approval takes, and who used Clozest. */
export function PeopleSection({ range }: { range: DayRange }) {
  const q = useAnalyticsPeople(range)
  if (q.isPending) return <Loading />
  if (q.isError && !q.data) return <ErrorState message={explain(q.error)} onRetry={() => void q.refetch()} />
  const p = q.data
  const registered = sum(p.salonsRegistered)
  const approved = sum(p.salonsApproved)
  const days = perDay(p.signups, p, (d) => d !== 'ADMIN')
  const activeDay = p.activeToday[0]?.day
  const today = todayInIndia()
  return (
    <div className="flex flex-col gap-4">
      <Freshness q={q} />
      <Section title="Accounts now (whatever days are picked)">
        <Stats>
          {(['CUSTOMER', 'OWNER', 'STAFF'] as const).map((r) => (
            <Stat key={r} label={ROLE_LABELS[r]} value={count(valueOf(p.accounts, r))} />
          ))}
        </Stats>
        <p className="text-xs text-muted">Test accounts and closed accounts aren&apos;t counted. Worked out every hour.</p>
      </Section>
      <Section title="Salons now (whatever days are picked)">
        <Card className="flex flex-col gap-1 text-sm">
          {Object.keys(SALON_STATUS_LABELS).map((s) => (
            <p key={s} className="flex justify-between gap-2">
              <span className="text-muted">{SALON_STATUS_LABELS[s]}</span>
              <span className="tabular-nums">{count(valueOf(p.salons, s))}</span>
            </p>
          ))}
          <p className="flex justify-between gap-2 border-t border-line pt-1">
            <span className="text-muted">Ever approved</span>
            <span className="tabular-nums">{count(p.salonsEverApproved)}</span>
          </p>
        </Card>
      </Section>
      <Section title={`Signups ${dayLabel(p.from)} – ${dayLabel(p.to)}`}>
        <Stats>
          {(['CUSTOMER', 'OWNER', 'STAFF'] as const).map((r) => (
            <Stat key={r} label={ROLE_LABELS[r]} value={count(sum(p.signups, (d) => d === r))} />
          ))}
          <Stat label="Salons registered" value={count(registered)} />
          <Stat label="Salons approved" value={count(approved)} note={p.approvalHoursMedian === null ? undefined : `usually ${hours(p.approvalHoursMedian)} from registering`} />
        </Stats>
        <BarChart title="New accounts each day (customers and salons)" bars={days.map((d) => ({ label: dayLabel(d.day), value: d.value }))} />
        <p className="text-xs text-muted">An account counts as what the person is now (a customer who later registers a salon counts as a salon owner).</p>
      </Section>
      <Section title="Who used Clozest (up to today, whatever days are picked)">
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Who</span>
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {!activeDay || activeDay === today ? 'Today' : dayLabel(activeDay)}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">7 days</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">30 days</th>
              </tr>
            </thead>
            <tbody>
              {SIDES.flatMap((s) => [
                <ActiveRow key={s.key} label={s.label} dim={`${s.key}:ALL`} p={p} bold />,
                <ActiveRow key={`${s.key}a`} label="in the Play Store app" dim={`${s.key}:APP`} p={p} />,
                <ActiveRow key={`${s.key}w`} label="on the website" dim={`${s.key}:WEB`} p={p} />,
              ])}
            </tbody>
          </table>
        </Card>
        <p className="text-xs text-muted">
          Each person once, however often they opened it. Counted only while signed in; kept for 35 days, so these
          counts start from the day this was switched on.
        </p>
        <BarChart
          title="Customers active each day"
          bars={perDay(p.activeDay, p, (d) => d === 'CUSTOMER:ALL').map((d) => ({ label: dayLabel(d.day), value: d.value }))}
        />
      </Section>
    </div>
  )
}

function ActiveRow({ label, dim, p, bold = false }: { label: string; dim: string; p: { activeToday: Point[]; activeWeek: Point[]; activeMonth: Point[] }; bold?: boolean }) {
  return (
    <tr className="border-b border-line last:border-0">
      <th scope="row" className={`px-3 py-2 text-left ${bold ? 'font-semibold' : 'pl-6 font-normal text-muted'}`}>
        {label}
      </th>
      <td className="px-3 py-2 text-right tabular-nums">{count(valueOf(p.activeToday, dim))}</td>
      <td className="px-3 py-2 text-right tabular-nums">{count(valueOf(p.activeWeek, dim))}</td>
      <td className="px-3 py-2 text-right tabular-nums">{count(valueOf(p.activeMonth, dim))}</td>
    </tr>
  )
}

function hours(h: number): string {
  if (h < 48) return `${Math.max(1, Math.round(h))} hours`
  return `${Math.round(h / 24)} days`
}
