import { useAnalyticsVersions } from '../../api/admin'
import { explain } from '../../api/errors'
import type { AppName, VersionsView } from '../../api/types'
import { EmptyState, ErrorState, Loading } from '../../components/ui'
import { Freshness, Section, addDays, count } from './common'

const APPS: { app: AppName; label: string }[] = [
  { app: 'partner', label: 'Partner app' },
  { app: 'customer', label: 'Customer app' },
]

/**
 * Phones per app version, from each phone's first update check of the day (only the number is kept): yesterday's
 * full day, today so far and the most on one day this week. Helps decide when an old version can be made to update.
 */
export function VersionsSection() {
  const q = useAnalyticsVersions()
  if (q.isPending) return <Loading />
  if (q.isError && !q.data) return <ErrorState message={explain(q.error)} onRetry={() => void q.refetch()} />
  return (
    <div className="flex flex-col gap-4">
      {APPS.map((a) => (
        <Section key={a.app} title={a.label}>
          <VersionTable data={q.data} app={a.app} />
        </Section>
      ))}
      <Freshness q={q} />
      <p className="text-xs text-muted">
        The app version each phone installed (from the Play Store, or a test APK), counted once a day when it first
        checks for updates. Screen updates aren&apos;t counted here: a phone on version 240 may run build 250&apos;s
        screens (see App releases). Phones on screens from before this count don&apos;t show up yet.
      </p>
    </div>
  )
}

export function versionRows(data: VersionsView, app: AppName) {
  const yesterday = addDays(data.today, -1)
  const rows = new Map<string, { versionCode: number; store: boolean; today: number; yesterday: number; peak: number }>()
  for (const d of data.days) {
    if (d.app !== app) continue
    const key = `${d.versionCode}:${d.store}`
    const r = rows.get(key) ?? { versionCode: d.versionCode, store: d.store, today: 0, yesterday: 0, peak: 0 }
    if (d.day === data.today) r.today += d.phones
    if (d.day === yesterday) r.yesterday += d.phones
    r.peak = Math.max(r.peak, d.phones)
    rows.set(key, r)
  }
  return [...rows.values()].sort((x, y) => Number(y.store) - Number(x.store) || y.versionCode - x.versionCode)
}

function VersionTable({ data, app }: { data: VersionsView; app: AppName }) {
  const rows = versionRows(data, app)
  if (rows.length === 0) return <EmptyState title="No phones counted this week" body="They show up once phones with this round's app open it." />
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th scope="col" className="px-3 py-2 font-medium">App version (APK)</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Today so far</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Yesterday</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Most in a day (7 days)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.versionCode}:${r.store}`} className="border-b border-line last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-normal">
                {r.versionCode} <span className="text-muted">{r.store ? 'Play Store' : 'test APK'}</span>
              </th>
              <td className="px-3 py-2 text-right tabular-nums">{count(r.today)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{count(r.yesterday)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{count(r.peak)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
