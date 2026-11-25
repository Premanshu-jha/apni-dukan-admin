import { useState } from 'react'
import { useSearchParams } from 'react-router'
import type { DayRange } from '../../api/admin'
import { Banner, Chip, Page } from '../../components/ui'
import { todayInIndia } from '../../lib/time'
import { BookingsSection } from './BookingsSection'
import { MoneySection } from './MoneySection'
import { PeopleSection } from './PeopleSection'
import { SalonsSection } from './SalonsSection'
import { SubscriptionsSection } from './SubscriptionsSection'
import { VersionsSection } from './VersionsSection'
import { RangePicker, lastDays, rangeProblem } from './common'

export const SECTIONS = [
  { key: 'money', label: 'Money' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'people', label: 'People' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'salons', label: 'Salons' },
  { key: 'versions', label: 'App versions' },
] as const

type Key = (typeof SECTIONS)[number]['key']

/** A real day (yyyy-mm-dd): 2026-02-30 isn't one (it would come back as 2 March). */
function realDay(text: string | null): text is string {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const d = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text && text >= '2020-01-01'
}

/**
 * Analytics (super admins only): money, subscriptions, people, bookings, salons' use and app versions. Only totals
 * and per-salon figures, worked out by the backend every hour; days are India's. The section, days and pincode are in
 * the address, so Back, reload and a shared link keep them.
 */
export function Analytics() {
  const [params, setParams] = useSearchParams()
  const section: Key = SECTIONS.some((s) => s.key === params.get('s')) ? (params.get('s') as Key) : 'money'
  const from = params.get('from')
  const to = params.get('to')
  const range: DayRange = realDay(from) && realDay(to) ? { from, to } : lastDays(30)
  const pin = params.get('pincode')
  const pincode = pin && /^[1-9]\d{5}$/.test(pin) ? pin : null
  const [typed, setTyped] = useState(pincode ?? '')
  const months = [6, 12, 24].includes(Number(params.get('months'))) ? Number(params.get('months')) : 12
  const sort = params.get('sort') === 'bookings' ? 'bookings' : 'quiet'
  const problem = rangeProblem(range, todayInIndia())

  function set(next: Record<string, string | null>) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k)
      else p.set(k, v)
    }
    setParams(p, { replace: true })
  }

  const usesDays = section === 'people' || section === 'bookings'
  const usesPincode = section === 'bookings' || section === 'salons'
  return (
    <Page title="Analytics" back="/more">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Section">
        {SECTIONS.map((s) => (
          <Chip key={s.key} selected={section === s.key} onClick={() => set({ s: s.key })}>
            {s.label}
          </Chip>
        ))}
      </div>
      {(usesDays || usesPincode) && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3">
          {usesDays && <RangePicker value={range} onChange={(r) => set({ from: r.from, to: r.to })} />}
          {usesPincode && (
            <div className="flex flex-wrap items-end gap-2 text-sm">
              <label className="flex flex-col gap-1 text-muted">
                Area (pincode)
                <input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="All areas"
                  className="min-h-11 w-36 rounded-xl border border-line bg-bg px-3 text-ink placeholder:text-muted/60"
                  value={typed}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                    setTyped(v)
                    // Applied once it is a whole pincode; cleared when emptied
                    if (v === '') set({ pincode: null })
                    else if (/^[1-9]\d{5}$/.test(v)) set({ pincode: v })
                  }}
                />
              </label>
              {pincode && (
                <button
                  type="button"
                  className="min-h-11 text-link underline"
                  onClick={() => {
                    setTyped('')
                    set({ pincode: null })
                  }}
                >
                  All areas
                </button>
              )}
              {typed !== '' && typed !== pincode && (
                <span className="pb-3 text-muted">
                  {typed.startsWith('0') ? 'Indian pincodes don’t start with 0' : 'Type all 6 digits'}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {usesDays && problem ? (
        <Banner tone="warn">{problem}</Banner>
      ) : section === 'money' ? (
        <MoneySection months={months} onMonths={(m) => set({ months: String(m) })} />
      ) : section === 'subscriptions' ? (
        <SubscriptionsSection />
      ) : section === 'people' ? (
        <PeopleSection range={range} />
      ) : section === 'bookings' ? (
        <BookingsSection
          range={range}
          pincode={pincode}
          onArea={(p) => {
            setTyped(p)
            set({ pincode: p })
          }}
        />
      ) : section === 'salons' ? (
        <SalonsSection
          pincode={pincode}
          sort={sort}
          onSort={(v) => set({ sort: v })}
          onAllAreas={() => {
            setTyped('')
            set({ pincode: null })
          }}
        />
      ) : (
        <VersionsSection />
      )}
    </Page>
  )
}
