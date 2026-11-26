import { useEffect, useRef, useState } from 'react'
import { dateOnly } from '../../lib/time'
import { Link } from 'react-router'
import type { LeadKind, LeadShop, LeadStatus, ShopStatus } from '../../api/types'
import { useAdmin } from '../../app/guards'
import { Banner, Button, Card, EmptyState, Loading, Pill } from '../../components/ui'
import { STATUS_LABELS } from '../../lib/labels'
import type { AreaWithDistrict } from './AreasTab'
import { LeadSheet } from './LeadSheet'
import { LiveStatus } from './LiveStatus'
import {
  areaRows,
  copyText,
  count,
  filterRows,
  hoursText,
  KIND_COLOURS,
  KIND_LABELS,
  kindCounts,
  LEAD_STATUS_LABELS,
  NO_FILTERS,
  PRIORITY_LABELS,
  rowsOf,
  summarize,
  type Filters,
  type Row,
} from './logic'
import { useLeads } from './store'

const PAGE = 50

/** The lead of this business as the list shows it now (an update may have changed it while its sheet is open). */
function liveLeadOf(rows: Row[], mapboxId: string) {
  for (const r of rows) if (r.type === 'shop' && r.shop.mapboxId === mapboxId) return r.shop.lead
  return null
}
const selectClass = 'min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink'

/** The searched areas' businesses: numbers, the areas compared, a map and the list to work through. */
export function Results({ areas }: { areas: AreaWithDistrict[] }) {
  const me = useAdmin()
  const scansMap = useLeads((s) => s.scans)
  const hydrating = useLeads((s) => s.hydrating)
  const filters = useLeads((s) => s.filters)
  const setFilters = useLeads((s) => s.setFilters)
  const resetFilters = useLeads((s) => s.resetFilters)
  const leadSaved = useLeads((s) => s.leadSaved)
  const [shownCount, setShownCount] = useState(PAGE)
  const [editing, setEditing] = useState<LeadShop | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  /**
   * The rows shown with these filters: a business an update takes out of them (it signed up, a teammate called it)
   * stays on screen, marked, until the filters change, so nothing jumps away under the user's thumb.
   */
  const shownWith = useRef<{ filters: string; keys: Set<string> }>({ filters: '', keys: new Set() })
  // A new search of an area (its searched time changes) starts afresh too
  const savedAtMap = useLeads((s) => s.savedAt)
  const filtersKey = JSON.stringify(filters) + JSON.stringify(savedAtMap)

  const shownRowKeys = useRef<string[]>([])
  useEffect(() => {
    shownWith.current = { filters: filtersKey, keys: new Set(shownRowKeys.current) }
  })

  // Only areas of the districts still picked
  const known = new Set(areas.map((a) => a.pincode))
  const scans = Object.values(scansMap).filter((s) => known.has(s.pincode))
  if (!scans.length && hydrating) return <Loading label="Loading the areas saved on this page…" />
  if (!scans.length) {
    return (
      <EmptyState
        title="No areas searched yet"
        body="Tick one or more areas above and press Search. Every salon, parlour, barber, spa, makeup, mehendi, nail and threading business the map knows there shows here."
      />
    )
  }
  const rows = rowsOf(scans)
  const matching = filterRows(rows, filters, me.userId)
  const kept = shownWith.current.filters === filtersKey ? shownWith.current.keys : new Set<string>()
  const matchingKeys = new Set(matching.map((r) => r.key))
  const left = rows.filter((r) => kept.has(r.key) && !matchingKeys.has(r.key))
  const changedOut = new Set(left.map((r) => r.key))
  // In the list's order: what matches and what an update took out of it
  const filtered = left.length ? filterRows(rows, { ...NO_FILTERS, sort: filters.sort }, me.userId).filter((r) => matchingKeys.has(r.key) || changedOut.has(r.key)) : matching
  shownRowKeys.current = filtered.map((r) => r.key)
  const sum = summarize(rows)
  const places = Object.fromEntries(scans.map((s) => [s.pincode, s.places]))
  const partial = scans.filter((s) => s.partial)
  const change = (f: Partial<Filters>) => {
    setFilters(f)
    setShownCount(PAGE)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText(filtered, places))
      setCopied(`Copied ${count(filtered.length)} rows: paste them into a sheet.`)
    } catch {
      setCopied("Your browser didn't allow copying here.")
    }
  }

  return (
    <div id="lead-results" tabIndex={-1} className="flex flex-col gap-4 focus:outline-none">
      {partial.length > 0 && (
        <Banner tone="warn">
          The map didn't answer fully for {partial.map((s) => s.pincode).join(', ')}: a few businesses may be missing there. Search those areas again later.
        </Banner>
      )}

      <section aria-label="Numbers" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Businesses found" value={sum.businesses} />
        <Stat label="Local (not chains)" value={sum.local} />
        <Stat label="With a phone" value={sum.withPhone} />
        <Stat label="On Clozest" value={sum.onClozest} />
        <Stat label="High priority" value={sum.high} />
        <Stat label="Contacted" value={sum.contacted} />
        <Stat label="Signed up from leads" value={sum.signedUp} />
        <Stat label="Areas searched" value={scans.length} />
      </section>

      <AreaTable scans={scans} onPick={(p) => change({ pincode: p })} picked={filters.pincode} />
      <DotMap rows={rows} />
      <KindBars rows={rows} />

      <section aria-labelledby="lead-list" className="flex flex-col gap-3">
        <h2 id="lead-list" className="font-semibold">
          Lead list
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            aria-label="Search name, address or phone"
            placeholder="Search name, address or phone"
            value={filters.text}
            onChange={(e) => change({ text: e.target.value })}
            className="min-h-12 rounded-xl border border-line bg-surface px-4 text-base text-ink placeholder:text-muted/60"
          />
          <select aria-label="Clozest" value={filters.clozest} onChange={(e) => change({ clozest: e.target.value as Filters['clozest'], clozestStatus: '' })} className={selectClass}>
            <option value="ALL">All businesses</option>
            <option value="ON">On Clozest only</option>
            <option value="OFF">Not on Clozest</option>
          </select>
          {filters.clozest === 'ON' && (
            <select aria-label="Clozest status" value={filters.clozestStatus} onChange={(e) => change({ clozestStatus: e.target.value as ShopStatus | '' })} className={selectClass}>
              <option value="">Any Clozest status</option>
              {(Object.keys(STATUS_LABELS) as ShopStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Lead status" value={filters.status} onChange={(e) => change({ status: e.target.value as Filters['status'] })} className={selectClass}>
            <option value="">Any lead status</option>
            {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
            <option value="SIGNED">Signed up from a lead</option>
          </select>
          <select aria-label="Kind" value={filters.kind} onChange={(e) => change({ kind: e.target.value as LeadKind | '' })} className={selectClass}>
            <option value="">Every kind</option>
            {(Object.keys(KIND_LABELS) as LeadKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <select aria-label="Local or chain" value={filters.chain} onChange={(e) => change({ chain: e.target.value as Filters['chain'] })} className={selectClass}>
            <option value="">Local and chains</option>
            <option value="LOCAL">Local only</option>
            <option value="CHAIN">Chains only</option>
          </select>
          <select aria-label="Area" value={filters.pincode} onChange={(e) => change({ pincode: e.target.value })} className={selectClass}>
            <option value="">Every searched area</option>
            {scans.map((s) => (
              <option key={s.pincode} value={s.pincode}>
                {s.pincode} {s.places.split(', ')[0]}
              </option>
            ))}
          </select>
          <select aria-label="Sort" value={filters.sort} onChange={(e) => change({ sort: e.target.value as Filters['sort'] })} className={selectClass}>
            <option value="PRIORITY">Best leads first</option>
            <option value="NAME">By name</option>
            <option value="AREA">By area</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="h-5 w-5" checked={filters.phoneOnly} onChange={(e) => change({ phoneOnly: e.target.checked })} />
            With a phone
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="h-5 w-5" checked={filters.mineOnly} onChange={(e) => change({ mineOnly: e.target.checked })} />
            Given to me
          </label>
          <button type="button" className="min-h-11 font-semibold text-link underline" onClick={() => { resetFilters(); setShownCount(PAGE) }}>
            Clear filters
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted" aria-live="polite">
            {count(matching.length)} of {count(rows.length)} shown
            {left.length > 0 && ` · ${count(left.length)} changed and no longer match: kept until you change a filter`}
          </p>
          <Button variant="secondary" className="min-h-11" onClick={() => void copy()} disabled={!filtered.length}>
            Copy shown rows
          </Button>
        </div>
        <LiveStatus />
        {copied && <Banner>{copied}</Banner>}

        {filtered.length === 0 ? (
          <EmptyState title="Nothing matches these filters" body="Clear a filter to see more." />
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Businesses">
            {filtered.slice(0, shownCount).map((r) => (
              <li key={r.key}>
                {changedOut.has(r.key) && (
                  <p className="px-1 pb-1 text-xs font-semibold text-warn">Changed: no longer matches your filters</p>
                )}
                {r.type === 'shop' ? <ShopCard shop={r.shop} places={places[r.area] ?? ''} onUpdate={() => setEditing(r.shop)} /> : <SalonCard row={r} />}
              </li>
            ))}
          </ul>
        )}
        {filtered.length > shownCount && (
          <Button variant="secondary" onClick={() => setShownCount((n) => n + PAGE)}>
            Show {Math.min(PAGE, filtered.length - shownCount)} more
          </Button>
        )}
      </section>

      <p className="text-xs text-muted">
        Businesses: © Mapbox and its suppliers, searched live and not stored. Areas: India Post's pincode directory (data.gov.in). Priority is our own estimate,
        not a rating: local over chain, a phone to call, open more days and hours, no website yet, a core salon kind.
      </p>

      {editing && (
        <LeadSheet
          mapboxId={editing.mapboxId}
          shop={editing}
          title={editing.name}
          lead={editing.lead}
          liveLead={liveLeadOf(rows, editing.mapboxId)}
          onClose={() => setEditing(null)}
          onSaved={(lead) => leadSaved(editing.mapboxId, lead)}
        />
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-2xl font-bold tabular-nums">{count(value)}</span>
      <span className="text-xs text-muted">{label}</span>
    </Card>
  )
}

function AreaTable({ scans, onPick, picked }: { scans: Parameters<typeof areaRows>[0]; onPick: (p: string) => void; picked: string }) {
  const rows = areaRows(scans)
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
  return (
    <section aria-labelledby="areas-compared" className="flex flex-col gap-2">
      <h2 id="areas-compared" className="font-semibold">
        Areas compared
      </h2>
      <p className="text-sm text-muted">"To reach": local businesses with a phone, not on Clozest, nobody contacted yet. Tap an area to list only it.</p>
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-raised text-left text-muted">
            <tr>
              <th className="p-2">Area</th>
              <th className="p-2 text-right">To reach</th>
              <th className="p-2 text-right">Found</th>
              <th className="p-2 text-right">Local</th>
              <th className="p-2 text-right">Phone</th>
              <th className="p-2 text-right">Open all week</th>
              <th className="p-2 text-right">On Clozest</th>
              <th className="p-2 text-right">Contacted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pincode} className={`border-t border-line ${picked === r.pincode ? 'bg-brand/10' : ''}`}>
                <td className="p-2">
                  <button type="button" className="min-h-11 text-left" onClick={() => onPick(picked === r.pincode ? '' : r.pincode)}>
                    <span className="font-semibold text-link">{r.pincode}</span> <span className="text-muted">{r.places.split(', ')[0]}</span>
                  </button>
                </td>
                <td className="p-2 text-right font-semibold tabular-nums">{count(r.toReach)}</td>
                <td className="p-2 text-right tabular-nums">{count(r.businesses)}</td>
                <td className="p-2 text-right tabular-nums">{pct(r.local, r.businesses)}</td>
                <td className="p-2 text-right tabular-nums">{pct(r.withPhone, r.businesses)}</td>
                <td className="p-2 text-right tabular-nums">{pct(r.openAllWeek, r.businesses)}</td>
                <td className="p-2 text-right tabular-nums">{count(r.onClozest)}</td>
                <td className="p-2 text-right tabular-nums">{count(r.contacted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Every business as a dot, coloured by kind (Clozest salons ringed). No map tiles: just where they are. */
function DotMap({ rows }: { rows: Row[] }) {
  const pts = rows.map((r) => (r.type === 'shop' ? { lat: r.shop.latitude, lng: r.shop.longitude, colour: KIND_COLOURS[r.shop.kind], on: !!r.shop.clozest, name: r.shop.name } : { lat: r.salon.latitude, lng: r.salon.longitude, colour: '#ffffff', on: true, name: r.salon.name })).filter((p) => p.lat && p.lng)
  if (pts.length < 2) return null
  const lats = pts.map((p) => p.lat)
  const lngs = pts.map((p) => p.lng)
  const [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
  const cos = Math.cos((((s + n) / 2) * Math.PI) / 180)
  const width = Math.max(1e-6, (e - w) * cos)
  const height = Math.max(1e-6, n - s)
  const W = 600
  const H = Math.max(200, Math.min(600, Math.round((W * height) / width)))
  const x = (lng: number) => 10 + ((lng - w) * cos * (W - 20)) / width
  const y = (lat: number) => 10 + ((n - lat) * (H - 20)) / height
  return (
    <section aria-labelledby="dot-map" className="flex flex-col gap-2">
      <h2 id="dot-map" className="font-semibold">
        Where they are
      </h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-2xl border border-line bg-raised" role="img" aria-label={`${pts.length} businesses as dots, coloured by kind`}>
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.lng)} cy={y(p.lat)} r={p.on ? 4 : 3} fill={p.colour} stroke={p.on ? '#ffffff' : 'none'} strokeWidth={p.on ? 1.5 : 0} opacity={0.9}>
            <title>{p.name}</title>
          </circle>
        ))}
      </svg>
      <p className="text-xs text-muted">Each dot is a business, coloured by kind (see "What they offer"). A white ring: on Clozest.</p>
    </section>
  )
}

function KindBars({ rows }: { rows: Row[] }) {
  const kinds = kindCounts(rows)
  const max = Math.max(1, ...kinds.map((k) => k.count))
  return (
    <section aria-labelledby="kinds" className="flex flex-col gap-2">
      <h2 id="kinds" className="font-semibold">
        What they offer
      </h2>
      <ul className="flex flex-col gap-1">
        {kinds.map((k) => (
          <li key={k.kind} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3rem] items-center gap-2 text-sm">
            <span className="truncate">
              <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOURS[k.kind] }} aria-hidden />
              {KIND_LABELS[k.kind]}
            </span>
            <span className="h-3 overflow-hidden rounded bg-raised">
              <span className="block h-full rounded" style={{ width: `${(k.count / max) * 100}%`, background: KIND_COLOURS[k.kind] }} />
            </span>
            <span className="text-right tabular-nums">{count(k.count)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ShopCard({ shop, places, onUpdate }: { shop: LeadShop; places: string; onUpdate: () => void }) {
  const lead = shop.lead
  const hours = hoursText(shop.hours)
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{shop.name}</p>
        {shop.chain && <Pill tone="muted">Chain</Pill>}
        <Pill tone={shop.priority === 'HIGH' ? 'good' : shop.priority === 'MEDIUM' ? 'warn' : 'muted'}>
          {PRIORITY_LABELS[shop.priority]} · {shop.score}
        </Pill>
        {shop.clozest && <Pill tone="brand">Clozest: {STATUS_LABELS[shop.clozest.status]}</Pill>}
        {lead?.signedUpAt && <Pill tone="good">Signed up from this lead</Pill>}
        {shop.addedLive && <Pill tone="muted">New from the team</Pill>}
      </div>
      <p className="text-sm text-muted">
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOURS[shop.kind] }} aria-hidden />
        {KIND_LABELS[shop.kind]} · {shop.pincode} {places.split(', ')[0]}
        {shop.addedLive ? ' · added by a teammate while this page was open' : !shop.onMapbox && ' · saved by the team (not on the map now)'}
      </p>
      {shop.address && <p className="text-sm [overflow-wrap:anywhere]">{shop.address}</p>}
      {hours && <p className="text-sm text-muted">{hours}</p>}
      {shop.clozest?.shopId && (
        <Link to={`/shops/${shop.clozest.shopId}`} className="text-sm font-semibold text-link underline">
          Open "{shop.clozest.name}" on Clozest
        </Link>
      )}
      {lead && (
        <p className="text-sm [overflow-wrap:anywhere]">
          <span className="font-semibold">{LEAD_STATUS_LABELS[lead.status]}</span>
          {lead.assignedTo ? ` · ${lead.assignedTo.name ?? 'someone who left'}` : ''}
          {lead.followUpOn ? ` · call back ${dateOnly(lead.followUpOn)}` : ''}
          {lead.whatsappOk ? ' · WhatsApp OK' : ''}
          {lead.note ? ` · "${lead.note}"` : ''}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {shop.phone && /^[6-9]\d{9}$/.test(shop.phone) ? (
          <a href={`tel:+91${shop.phone}`} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 font-semibold text-link">
            Call {shop.phone}
          </a>
        ) : shop.phone ? (
          <span className="inline-flex min-h-11 items-center text-sm">Phone: {shop.phone}</span>
        ) : (
          <span className="inline-flex min-h-11 items-center text-sm text-muted">No phone on the map: visit</span>
        )}
        {!!shop.latitude && !!shop.longitude && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${shop.latitude},${shop.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 font-semibold text-link"
          >
            Directions
          </a>
        )}
        <Button variant="secondary" className="min-h-11" onClick={onUpdate}>
          {lead ? 'Update' : 'Add note or status'}
        </Button>
      </div>
    </Card>
  )
}

function SalonCard({ row }: { row: Extract<Row, { type: 'salon' }> }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{row.salon.name}</p>
        <Pill tone="brand">Clozest: {STATUS_LABELS[row.salon.status]}</Pill>
      </div>
      <p className="text-sm text-muted">On Clozest in {row.area}; the map doesn't list it (or lists it under another name).</p>
      {row.salon.shopId && (
        <Link to={`/shops/${row.salon.shopId}`} className="text-sm font-semibold text-link underline">
          Open on Clozest
        </Link>
      )}
    </Card>
  )
}
