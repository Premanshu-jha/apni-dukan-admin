import { useQueries } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { explain } from '../../api/errors'
import { leadKeys, leadsApi, useDistricts, useUsage } from '../../api/leads'
import type { LeadArea } from '../../api/types'
import { useAdmin } from '../../app/guards'
import { Banner, Button, Card, EmptyState, ErrorState, Loading, Spinner } from '../../components/ui'
import { isSuperAdmin } from '../../lib/roles'
import { useDebounced } from '../../lib/useDebounced'
import { count, matchAreas, shownAreas } from './logic'
import { Results } from './Results'
import { useLeads, type District } from './store'

export interface AreaWithDistrict extends LeadArea {
  district: string
}

/**
 * Pick one or more cities or districts, narrow the areas with the area search (chips; clearing it brings every area
 * back), tick areas and press Search: each area is searched on the map and its businesses join the list below.
 */
export function AreasTab() {
  const districts = useLeads((s) => s.districts)
  const areaQueries = useQueries({
    queries: districts.map((d) => ({
      queryKey: leadKeys.areas(d.district, d.state),
      queryFn: () => leadsApi.areas(d.district, d.state),
      staleTime: 60_000,
    })),
  })
  const areas: AreaWithDistrict[] = areaQueries.flatMap((q) => (q.data ? q.data.areas.map((a) => ({ ...a, district: q.data.district })) : []))
  const loading = areaQueries.some((q) => q.isPending)
  const failed = areaQueries.find((q) => q.isError)
  const knowAreas = useLeads((s) => s.knowAreas)
  const loaded = areaQueries.map((q) => q.dataUpdatedAt).join(',')
  useEffect(() => {
    areaQueries.forEach((q, i) => {
      if (q.data && districts[i]) knowAreas(districts[i], q.data.areas.map((a) => a.pincode))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when an area list arrives
  }, [loaded, districts, knowAreas])

  return (
    <div className="flex flex-col gap-4">
      <DistrictPicker />
      {districts.length === 0 ? (
        <EmptyState
          title="Start with a city or district"
          body="Type a city, district, area name or pincode above (for example Hyderabad, Kukatpally or 500072), then pick it."
        />
      ) : (
        <>
          {failed && <ErrorState message={explain(failed.error)} onRetry={() => void failed.refetch()} />}
          {loading && !areas.length ? <Loading label="Loading areas…" /> : <AreaPanel areas={areas} />}
          <Results areas={areas} />
        </>
      )}
    </div>
  )
}

/** A search box with a dropdown of districts; the picked ones are chips with ×. */
function DistrictPicker() {
  const { districts, addDistrict, removeDistrict, setAreaFilter, select } = useLeads()
  const [typed, setTyped] = useState('')
  const q = useDebounced(typed, 250)
  const found = useDistricts(q)
  const listId = useId()
  const open = typed.trim().length >= 2
  const pick = (d: District & { matched?: string | null }) => {
    addDistrict({ district: d.district, state: d.state })
    setTyped('')
    // Found by an area ("Kukatpally (500072)"): that area goes straight into the area search, ticked
    const pin = d.matched?.match(/\((\d{6})\)$/)?.[1]
    if (pin) {
      const now = useLeads.getState().areaFilter
      if (!now.includes(pin)) setAreaFilter([...now, pin])
      select([pin], true)
    }
  }
  const has = (name: string) => districts.some((x) => x.district === name && x.state === 'Telangana')
  const greaterHyderabad = has('Hyderabad') ? ['Medchal Malkajgiri', 'Ranga Reddy'].filter((n) => !has(n)) : []
  return (
    <Card className="flex flex-col gap-3">
      <label htmlFor="district-search" className="text-sm font-medium text-muted">
        City or district
      </label>
      <input
        id="district-search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Type a city, area or pincode"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          // Only what the list shows for what is typed now (not an older answer still on screen)
          if (e.key === 'Enter' && q === typed && !found.isFetching && found.data?.[0]) pick(found.data[0])
          if (e.key === 'Escape') setTyped('')
        }}
        className="min-h-12 rounded-xl border border-line bg-surface px-4 text-base text-ink placeholder:text-muted/60 focus:border-brand focus:outline-none"
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Matching districts" className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {found.isPending || q !== typed ? (
            <li className="p-2">
              <Spinner small label="Searching…" />
            </li>
          ) : found.isError ? (
            <li className="p-2 text-sm text-bad">{explain(found.error)}</li>
          ) : found.data.length === 0 ? (
            <li className="p-2 text-sm text-muted">No city, district, area or pincode matches "{typed.trim()}". Check the spelling.</li>
          ) : (
            found.data.map((d) => (
              <li key={`${d.district}|${d.state}`} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => pick(d)}
                  className="flex min-h-12 w-full flex-col items-start justify-center rounded-xl px-3 text-left hover:bg-raised"
                >
                  <span className="font-semibold">
                    {d.district}, {d.state}
                  </span>
                  <span className="text-sm text-muted">
                    {d.matched ? `Has ${d.matched} · ` : ''}
                    {count(d.pincodes)} areas
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {districts.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Districts picked">
          {districts.map((d) => (
            <li key={`${d.district}|${d.state}`}>
              <span className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-brand bg-brand/15 pl-3 text-sm font-semibold">
                {d.district}, {d.state}
                <button
                  type="button"
                  aria-label={`Remove ${d.district}`}
                  onClick={() => removeDistrict(d)}
                  className="min-h-11 min-w-11 rounded-xl text-lg text-muted hover:text-ink"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {greaterHyderabad.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">Greater Hyderabad also spans these districts:</p>
          <div className="flex flex-wrap gap-2">
            {greaterHyderabad.map((n) => (
              <Button key={n} variant="secondary" className="min-h-11" onClick={() => addDistrict({ district: n, state: 'Telangana' })}>
                + {n}
              </Button>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

/** The area search (chips), the areas list with ticks, and the Search button with its progress. */
function AreaPanel({ areas }: { areas: AreaWithDistrict[] }) {
  const me = useAdmin()
  const superAdmin = isSuperAdmin(me.adminRole)
  const { areaFilter, setAreaFilter, selected, toggle, select, clearSelection, scans, failed, progress, stopped, scanSelected, stop } = useLeads()
  const usage = useUsage()
  const liveUsage = useLeads((s) => s.usage) ?? usage.data ?? null
  const [typed, setTyped] = useState('')
  const [confirmBig, setConfirmBig] = useState(false)
  const listId = useId()
  const suggestions = matchAreas(areas, typed, areaFilter)
  const shown = shownAreas(areas, areaFilter)
  const mine = areas.filter((a) => a.mine)
  const byPin = new Map(areas.map((a) => [a.pincode, a]))
  const allShownTicked = shown.length > 0 && shown.every((a) => selected.includes(a.pincode))

  const add = (pincode: string) => {
    setAreaFilter([...areaFilter, pincode])
    setTyped('')
  }

  return (
    <Card className="flex flex-col gap-3">
      <label htmlFor="area-search" className="text-sm font-medium text-muted">
        Search areas
      </label>
      <input
        id="area-search"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        autoComplete="off"
        placeholder="Area name or pincode, e.g. Kukatpally"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && suggestions[0]) add(suggestions[0].pincode)
          if (e.key === 'Backspace' && !typed && areaFilter.length) setAreaFilter(areaFilter.slice(0, -1))
        }}
        className="min-h-12 rounded-xl border border-line bg-surface px-4 text-base text-ink placeholder:text-muted/60 focus:border-brand focus:outline-none"
      />
      {typed.trim() && (
        <ul id={listId} role="listbox" aria-label="Matching areas" className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {suggestions.length === 0 ? (
            <li className="p-2 text-sm text-muted">No area matches "{typed.trim()}" in the districts picked.</li>
          ) : (
            suggestions.map((a) => (
              <li key={a.pincode} role="option" aria-selected={false}>
                <button type="button" onClick={() => add(a.pincode)} className="flex min-h-12 w-full items-center rounded-xl px-3 text-left hover:bg-raised">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-semibold">{a.pincode}</span> {a.places}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {areaFilter.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <ul className="flex flex-wrap gap-2" aria-label="Areas searched for">
            {areaFilter.map((p) => (
              <li key={p}>
                <span className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-line bg-raised pl-3 text-sm">
                  <span className="font-semibold">{p}</span>
                  <span className="max-w-40 truncate text-muted">{byPin.get(p)?.places.split(', ')[0]}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${p}`}
                    onClick={() => setAreaFilter(areaFilter.filter((x) => x !== p))}
                    className="min-h-11 min-w-11 text-lg text-muted hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <Button variant="ghost" className="min-h-11" onClick={() => setAreaFilter([])}>
            Clear search (show all areas)
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="min-h-11" onClick={() => select(shown.map((a) => a.pincode), !allShownTicked)}>
          {allShownTicked ? 'Untick all shown' : `Tick all shown (${shown.length})`}
        </Button>
        {!superAdmin && mine.length > 0 && (
          <Button variant="secondary" className="min-h-11" onClick={() => setAreaFilter(mine.map((a) => a.pincode))}>
            My areas ({mine.length})
          </Button>
        )}
        {selected.length > 0 && (
          <Button variant="ghost" className="min-h-11" onClick={clearSelection}>
            Untick all
          </Button>
        )}
      </div>

      <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto" aria-label="Areas">
        {shown.map((a) => {
          const scanned = scans[a.pincode]
          const running = progress?.running.includes(a.pincode)
          const queued = progress?.queue.includes(a.pincode)
          return (
            <li key={a.pincode}>
              <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-raised">
                <input
                  type="checkbox"
                  checked={selected.includes(a.pincode)}
                  onChange={() => toggle(a.pincode)}
                  className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-brand)]"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="[overflow-wrap:anywhere]">
                    <span className="font-semibold">{a.pincode}</span> {a.places}
                    {a.mine && <span className="ml-2 text-xs font-semibold text-link">Yours</span>}
                  </span>
                  <span className="text-xs text-muted">
                    {a.district} · {count(a.onClozest)} on Clozest · {count(a.contacted)} contacted
                    {a.signedUp ? ` · ${count(a.signedUp)} signed up` : ''}
                    {running ? ' · searching…' : queued ? ' · waiting' : scanned ? ` · ${count(scanned.shops.length)} found` : ''}
                  </span>
                  {failed[a.pincode] && <span className="text-xs text-bad">{failed[a.pincode]}</span>}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      {stopped && <Banner tone="bad">{stopped}</Banner>}
      {progress ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-raised">
            <div className="h-full bg-brand transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted">
              Searched {progress.done} of {progress.total} areas. You can keep working below meanwhile.
            </span>
            <Button variant="secondary" className="min-h-11" onClick={stop}>
              Stop
            </Button>
          </div>
        </div>
      ) : (
        <>
          {confirmBig && (
            <Banner tone="warn">
              <span className="block">
                {selected.length} areas use about {count(selected.length * 40)} to {count(selected.length * 150)} of this month's map searches
                {liveUsage ? ` (${count(Math.max(0, liveUsage.cap - liveUsage.used))} left)` : ''}. Search them all?
              </span>
              <span className="mt-2 flex gap-2">
                <Button
                  className="min-h-11"
                  onClick={() => {
                    setConfirmBig(false)
                    scanSelected()
                  }}
                >
                  Yes, search {selected.length}
                </Button>
                <Button variant="secondary" className="min-h-11" onClick={() => setConfirmBig(false)}>
                  Not now
                </Button>
              </span>
            </Banner>
          )}
          <Button disabled={!selected.length} onClick={() => (selected.length > 10 ? setConfirmBig(true) : scanSelected())}>
            {selected.length ? `Search ${selected.length} area${selected.length === 1 ? '' : 's'} on the map` : 'Tick areas to search'}
          </Button>
        </>
      )}
      {liveUsage && (
        <p className="text-xs text-muted">
          Map searches this month: {count(liveUsage.used)} of {count(liveUsage.cap)}. One area uses about 40 to 150.
        </p>
      )}
    </Card>
  )
}
