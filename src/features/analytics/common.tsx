import type { ReactNode } from 'react'
import type { DayRange } from '../../api/admin'
import type { PaymentSource, Point } from '../../api/types'
import { Banner, Button, Card, Chip } from '../../components/ui'
import { explain } from '../../api/errors'
import { todayInIndia } from '../../lib/time'

export const SOURCE_LABELS: Record<PaymentSource, string> = {
  WEBSITE: 'Razorpay (website)',
  APP_RAZORPAY: 'Razorpay (in the app)',
  GOOGLE_PLAY: 'Google Play',
}

/** What became of a booking or walk-in (visits' dim: KIND:STATUS). */
export const VISIT_LABELS: Record<string, string> = {
  'BOOKING:COMPLETED': 'Bookings done',
  'BOOKING:CONFIRMED': 'Bookings still to come',
  'BOOKING:IN_SERVICE': 'Bookings in the chair now',
  'BOOKING:NO_SHOW': 'Bookings: customer didn’t come',
  'BOOKING:CANCELLED_BY_CUSTOMER': 'Bookings cancelled by the customer',
  'BOOKING:CANCELLED_BY_SALON': 'Bookings cancelled by the salon',
  'WALK_IN:COMPLETED': 'Walk-ins done',
  'WALK_IN:IN_SERVICE': 'Walk-ins in the chair now',
  'WALK_IN:CONFIRMED': 'Walk-ins waiting',
  'WALK_IN:REMOVED': 'Walk-ins removed',
  'WALK_IN:CANCELLED_BY_SALON': 'Walk-ins cancelled',
}

export const SALON_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Still registering',
  PENDING_VISIT: 'Waiting for the visit',
  APPROVED: 'Approved',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed',
}

export const ROLE_LABELS: Record<string, string> = {
  CUSTOMER: 'Customers',
  OWNER: 'Salon owners',
  STAFF: 'Helpers and barbers',
  ADMIN: 'Our team',
}

/** ₹1,23,456 (Indian grouping), no paise; ₹12.50 when under ₹100 and not whole. */
export function money(paise: number): string {
  const rupees = paise / 100
  const digits = Math.abs(rupees) < 100 && paise % 100 !== 0 ? 2 : 0
  return `${paise < 0 ? '−' : ''}₹${Math.abs(rupees).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function count(n: number): string {
  return n.toLocaleString('en-IN')
}

/** "Nov 2026" from 2026-11. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** "25 Nov" from 2026-11-25. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** The day `n` days after (or before, negative) a yyyy-MM-dd day. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Every day of the range, oldest first, each with its total (0 on days without a row), summing the dims given. */
export function perDay(points: Point[], range: DayRange, dims?: (dim: string) => boolean): { day: string; value: number }[] {
  const byDay = new Map<string, number>()
  for (const p of points) if (!dims || dims(p.dim)) byDay.set(p.day, (byDay.get(p.day) ?? 0) + p.value)
  const out: { day: string; value: number }[] = []
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push({ day: d, value: byDay.get(d) ?? 0 })
  return out
}

export function sum(points: Point[], dims?: (dim: string) => boolean): number {
  return points.reduce((t, p) => (!dims || dims(p.dim) ? t + p.value : t), 0)
}

export function valueOf(points: Point[], dim: string): number {
  return points.find((p) => p.dim === dim)?.value ?? 0
}

/** A big number with what it is, and an optional line under it. */
export function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col gap-1">
      <p className="text-sm text-muted">{label}</p>
      <p className="font-display text-2xl font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </Card>
  )
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `s-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

export const PRESETS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
] as const

export function lastDays(days: number, today: string = todayInIndia()): DayRange {
  return { from: addDays(today, -(days - 1)), to: today }
}

/**
 * The days a section counts (India's calendar): one tap for the usual ranges, or two dates. A range longer than a
 * year (the backend's limit) or back to front isn't sent: the dates say why.
 */
export function RangePicker({ value, onChange }: { value: DayRange; onChange: (r: DayRange) => void }) {
  const today = todayInIndia()
  const preset = PRESETS.find((p) => value.to === today && value.from === addDays(today, -(p.days - 1)))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Which days">
        {PRESETS.map((p) => (
          <Chip key={p.days} selected={preset?.days === p.days} onClick={() => onChange(lastDays(p.days, today))}>
            {p.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 text-muted">
          From
          <input
            type="date"
            className="min-h-11 rounded-xl border border-line bg-surface px-3 text-ink"
            value={value.from}
            max={value.to}
            min={addDays(value.to, -365)}
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-muted">
          To
          <input
            type="date"
            className="min-h-11 rounded-xl border border-line bg-surface px-3 text-ink"
            value={value.to}
            min={value.from}
            max={today}
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
          />
        </label>
      </div>
    </div>
  )
}

/** A range the backend takes: from on or before to, at most 366 days, to not after today. */
export function rangeProblem(r: DayRange, today: string = todayInIndia()): string | null {
  if (r.from > r.to) return 'The first day is after the last one.'
  if (r.to > today) return 'The last day is in the future.'
  if (addDays(r.from, 365) < r.to) return 'Pick at most a year.'
  return null
}

/**
 * Under a section's numbers: a warning when reading them again failed (what is shown may be old), and "Updating…"
 * while new ones for other days or another area are on their way (the old ones stay meanwhile).
 */
export function Freshness({
  q,
}: {
  q: { isRefetchError: boolean; isPlaceholderData?: boolean; isFetching: boolean; error: unknown; refetch: () => unknown }
}) {
  if (q.isRefetchError) {
    return (
      <Banner tone="bad">
        <span className="flex flex-wrap items-center justify-between gap-2">
          Couldn&apos;t load the newest numbers, so these may be out of date. {explain(q.error)}
          <Button variant="secondary" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </span>
      </Banner>
    )
  }
  if (q.isPlaceholderData && q.isFetching) return <p className="text-sm text-muted" role="status">Updating…</p>
  return null
}
