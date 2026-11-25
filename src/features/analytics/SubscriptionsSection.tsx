import { Link } from 'react-router'
import { useAnalyticsSubscriptions } from '../../api/admin'
import { explain } from '../../api/errors'
import type { AnalyticsSalonLine } from '../../api/types'
import { Card, EmptyState, ErrorState, Loading } from '../../components/ui'
import { dateIst } from '../../lib/time'
import { Freshness, Section, SOURCE_LABELS, Stat, Stats, count, monthLabel } from './common'

/** Subscriptions: where each approved salon stands now, who started and stopped paying each month, and who to call. */
export function SubscriptionsSection() {
  const q = useAnalyticsSubscriptions()
  if (q.isPending) return <Loading />
  if (q.isError && !q.data) return <ErrorState message={explain(q.error)} onRetry={() => void q.refetch()} />
  const s = q.data
  return (
    <div className="flex flex-col gap-4">
      <Freshness q={q} />
      <p className="text-xs text-muted">Where approved salons stand now (worked out when you open it).</p>
      <Stats>
        <Stat label="Paying" value={count(s.paying)} note={s.payingBySource.filter((p) => p.salons > 0).map((p) => `${SOURCE_LABELS[p.source]} ${count(p.salons)}`).join(' · ') || 'none yet'} />
        <Stat label="In the free trial" value={count(s.trial)} note={`${count(s.trialWithAutoPay)} already set up AutoPay`} />
        <Stat label="Time over, 3 days to pay" value={count(s.grace)} note="still shown to customers" />
        <Stat label="Hidden for not paying" value={count(s.lapsed)} note="customers can't find or book them" />
        <Stat label="Payment problems" value={count(s.paymentProblems)} note="renewing by themselves failed (AutoPay or Google Play)" />
      </Stats>
      <Card className="flex flex-col gap-1 text-sm">
        <p className="font-semibold">Paying salons that renew by themselves (AutoPay or Google Play)</p>
        {s.payingBySource.map((p) => (
          <p key={p.source} className="flex justify-between gap-2">
            <span className="text-muted">{SOURCE_LABELS[p.source]}</span>
            <span className="tabular-nums">
              {count(p.renewing)} of {count(p.salons)}
            </span>
          </p>
        ))}
      </Card>
      <Section title="Each month">
        {s.months.length === 0 ? (
          <EmptyState title="No payments yet" body="Salons that pay show up here from their first payment." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th scope="col" className="px-3 py-2 font-medium">Month</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Started paying</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Stopped paying</th>
                </tr>
              </thead>
              <tbody>
                {[...s.months].reverse().map((m) => (
                  <tr key={m.month} className="border-b border-line last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal">{monthLabel(m.month)}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{count(m.firstPayments)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{count(m.stopped)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">Stopped: the salon&apos;s last paid month ended, its 3 days to pay are over, and no payment came after it.</p>
      </Section>
      <Section title="Free trials ending in the next 7 days, no AutoPay yet">
        <SalonList salons={s.trialsEnding} empty="None: every trial ending this week has AutoPay, or none ends." ends="Trial ends" />
      </Section>
      <Section title="Payment problems">
        <SalonList salons={s.problems} empty="None right now." ends="Paid up to" />
      </Section>
    </div>
  )
}

function SalonList({ salons, empty, ends }: { salons: AnalyticsSalonLine[]; empty: string; ends: string }) {
  if (salons.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return (
    <ul className="flex flex-col gap-2">
      {salons.map((x) => (
        <li key={x.shopId}>
          <Link to={`/shops/${x.shopId}`} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 hover:bg-raised">
            <span className="min-w-0">
              <span className="block font-semibold [overflow-wrap:anywhere]">{x.name}</span>
              <span className="block text-sm text-muted">
                {[x.area, x.pincode].filter(Boolean).join(' · ')} · {ends} {dateIst(x.ends)}
                {x.state === 'PAYING' ? ` · ${SOURCE_LABELS[x.source]}` : ''}
              </span>
            </span>
            <span aria-hidden>›</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
