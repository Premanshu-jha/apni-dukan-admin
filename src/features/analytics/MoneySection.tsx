import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { adminApi, keys, useAnalyticsMoney } from '../../api/admin'
import { explain, isApiError } from '../../api/errors'
import type { FeeSettings, Money, MoneyMonth } from '../../api/types'
import { Banner, Button, Card, Chip, ErrorState, Field, Loading, Sheet } from '../../components/ui'
import { dateTimeIst } from '../../lib/time'
import { BarChart } from './BarChart'
import { Freshness, Section, SOURCE_LABELS, Stat, Stats, count, money, monthLabel } from './common'

/**
 * Money: what came in each month, from where, what Razorpay and Google took, and what is left; the money coming in
 * each month now; each month's payments as a CSV file for the accountant; and Google's fee rates for the estimate.
 */
export function MoneySection({ months, onMonths }: { months: number; onMonths: (m: number) => void }) {
  const q = useAnalyticsMoney(months)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="How many months">
        {[6, 12, 24].map((m) => (
          <Chip key={m} selected={months === m} onClick={() => onMonths(m)}>
            Last {m} months
          </Chip>
        ))}
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError && !q.data ? (
        <ErrorState message={explain(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <Freshness q={q} />
          <MoneyBody data={q.data} />
        </>
      )}
    </div>
  )
}

function MoneyBody({ data }: { data: NonNullable<ReturnType<typeof useAnalyticsMoney>['data']> }) {
  const thisMonth = data.months.at(-1)
  const newestFirst = [...data.months].reverse()
  return (
    <>
      {thisMonth && (
        <Stats>
        <Stat
          label="Coming in each month now"
          value={money(data.recurring.monthlyPaise)}
          note={`${count(data.recurring.salons)} paid-up salons, at what each last paid`}
        />
        <Stat label={`Left for us in ${monthLabel(thisMonth.month)} so far`} value={money(thisMonth.total.netPaise)} note="after refunds and fees" />
        <Stat label={`Paid in ${monthLabel(thisMonth.month)} so far`} value={money(thisMonth.total.grossPaise)} note={`${count(thisMonth.total.payments)} payments`} />
        </Stats>
      )}
      {data.recurring.bySource.length > 0 && (
        <Card className="flex flex-col gap-1 text-sm">
          <p className="font-semibold">Paid-up salons by how they pay</p>
          {data.recurring.bySource.map((r) => (
            <p key={r.source} className="flex justify-between gap-2">
              <span className="text-muted">{SOURCE_LABELS[r.source]}</span>
              <span className="tabular-nums">
                {count(r.salons)} · {money(r.monthlyPaise)} a month
              </span>
            </p>
          ))}
        </Card>
      )}
      <BarChart
        title="Left for us each month (₹; below the line: refunded more than came in)"
        bars={data.months.map((m) => ({ label: monthLabel(m.month), value: Math.round(m.total.netPaise / 100), tip: `${monthLabel(m.month)}: ${money(m.total.netPaise)}` }))}
        format={(n) => `₹${n.toLocaleString('en-IN')}`}
      />
      <Banner tone="info">
        Razorpay&apos;s fee is exact (as Razorpay reports it, with its GST). Google&apos;s fee is an estimate at the rates
        below: Google shows its real fee only in the Play Console. Test payments are never counted.
      </Banner>
      <Section title="Month by month">
        <ul className="flex flex-col gap-2" aria-label="Months">
          {newestFirst.map((m) => (
            <li key={m.month}>
              <MonthCard month={m} />
            </li>
          ))}
        </ul>
      </Section>
      <FeeRates fees={data.fees} />
    </>
  )
}

function MonthCard({ month: m }: { month: MoneyMonth }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  async function download() {
    setBusy(true)
    setError(null)
    try {
      const file = await adminApi.analyticsMoneyCsv(m.month)
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = `clozest-payments-${m.month}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-lg font-semibold">{monthLabel(m.month)}</p>
        <p className="tabular-nums">
          <span className="text-sm text-muted">Left for us </span>
          <span className="font-semibold">{money(m.total.netPaise)}</span>
        </p>
      </div>
      <MoneyLines m={m.total} />
      {m.bySource.length > 0 && (
        <button type="button" className="self-start text-sm text-link underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide by payment source' : 'Show by payment source'}
        </button>
      )}
      {open &&
        m.bySource.map((s) => (
          <div key={s.source} className="rounded-xl bg-raised p-3">
            <p className="mb-1 text-sm font-semibold">{s.source ? SOURCE_LABELS[s.source] : ''}</p>
            <MoneyLines m={s} />
          </div>
        ))}
      <Button variant="secondary" busy={busy} disabled={m.total.payments === 0 && m.total.refundCount === 0} onClick={() => void download()}>
        Download payments (CSV)
      </Button>
      {error !== null && <p className="text-sm text-bad">Couldn&apos;t download it. {explain(error)}</p>}
    </Card>
  )
}

function MoneyLines({ m }: { m: Money }) {
  const rows: [string, string][] = [
    [`Paid (${count(m.payments)} payments, ${count(m.salons)} salons)`, money(m.grossPaise)],
    [`Refunded (${count(m.refundCount)})`, m.refundsPaise ? `−${money(m.refundsPaise)}` : money(0)],
    ['Razorpay’s fee', m.razorpayFeePaise ? `−${money(m.razorpayFeePaise)}` : money(0)],
    ['Google’s fee (estimate)', m.googleFeeEstimatePaise ? `−${money(m.googleFeeEstimatePaise)}` : money(0)],
  ]
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Google's rates as percent with up to 2 decimals, saved as basis points. */
function FeeRates({ fees }: { fees: FeeSettings }) {
  const qc = useQueryClient()
  const sending = useRef(false)
  const [editing, setEditing] = useState(false)
  const [play, setPlay] = useState('')
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const playBps = toBps(play)
  const choiceBps = toBps(choice)
  function open() {
    setPlay(percent(fees.playFeeBps))
    setChoice(percent(fees.userChoiceFeeBps))
    setError(null)
    setEditing(true)
  }
  async function save() {
    if (sending.current || playBps === null || choiceBps === null) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await adminApi.saveAnalyticsSettings({ playFeeBps: playBps, userChoiceFeeBps: choiceBps, version: fees.version })
      setEditing(false)
    } catch (e) {
      setError(e)
    } finally {
      sending.current = false
      setBusy(false)
      void qc.invalidateQueries({ queryKey: keys.analytics })
    }
  }
  return (
    <Section title="Google’s fee rates (for the estimate)">
      <Card className="flex flex-col gap-2 text-sm">
        <p className="flex justify-between gap-2">
          <span className="text-muted">Google Play billing</span>
          <span className="tabular-nums">{percent(fees.playFeeBps)}%</span>
        </p>
        <p className="flex justify-between gap-2">
          <span className="text-muted">Razorpay (in the app)</span>
          <span className="tabular-nums">{percent(fees.userChoiceFeeBps)}%</span>
        </p>
        {fees.changedAt && (
          <p className="text-xs text-muted">
            Changed {dateTimeIst(fees.changedAt)}
            {fees.changedByName ? ` by ${fees.changedByName}` : ''}
          </p>
        )}
        <Button variant="secondary" onClick={open}>
          Change the rates
        </Button>
      </Card>
      {error !== null && !editing && <Banner tone="bad">Couldn&apos;t save the rates. {explain(error)}</Banner>}
      <Sheet open={editing} title="Google’s fee rates" onClose={() => !busy && setEditing(false)}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Google takes 15% of subscriptions paid through Google Play, and 11% (4 points less) when the salon pays
            with Razorpay (in the app). Change these only if Google changes its fees or your Play Console shows other rates.
          </p>
          <Field
            id="fee-play"
            label="Google Play billing (%)"
            inputMode="decimal"
            value={play}
            onChange={(e) => setPlay(e.target.value)}
            error={playBps === null ? 'A number from 0 to 30, like 15' : undefined}
          />
          <Field
            id="fee-choice"
            label="Razorpay (in the app) (%)"
            inputMode="decimal"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            error={choiceBps === null ? 'A number from 0 to 30, like 11' : undefined}
          />
          {error !== null && (
            <Banner tone="bad">{isApiError(error, 'SETTINGS_CHANGED') ? explain(error) : `Couldn’t save. ${explain(error)}`}</Banner>
          )}
          <Button busy={busy} disabled={playBps === null || choiceBps === null} onClick={() => void save()}>
            Save rates
          </Button>
        </div>
      </Sheet>
    </Section>
  )
}

export function percent(bps: number): string {
  return (bps / 100).toString()
}

/** "15" or "11.5" (0 to 30, at most 2 decimals) as basis points; null when not such a number. */
export function toBps(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null
  const bps = Math.round(Number(t) * 100)
  return bps <= 3000 ? bps : null
}
