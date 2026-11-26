import { useQueries } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useState } from 'react'
import { explain } from '../../api/errors'
import { leadKeys, leadsApi, useDistricts, usePlaces, useUsage } from '../../api/leads'
import type { LeadArea, LeadDistrict } from '../../api/types'
import { useAdmin } from '../../app/guards'
import { Banner, Button, Card, EmptyState, ErrorState, Loading, Spinner } from '../../components/ui'
import { isSuperAdmin } from '../../lib/roles'
import { howLong } from '../../lib/time'
import { useNow } from '../../lib/useNow'
import { useDebounced } from '../../lib/useDebounced'
import { count, matchAreas, shownAreas } from './logic'
import { Results } from './Results'
import { placeKey, useLeads } from './store'
import { LiveStatus } from './LiveStatus'
import { useLiveUpdates } from './useLiveUpdates'

/** An area with India Post's district it's filed under (a city lists areas of several). */
export type AreaWithDistrict = LeadArea

/**
 * Pick one or more cities or districts, narrow the areas with the area search (chips; clearing it brings every area
 * back), tick areas and press Search: each area is searched on the map and its businesses join the list below.
 */
export function AreasTab() {
  const districts = useLeads((s) => s.districts)
  const hydrate = useLeads((s) => s.hydrate)
  const userId = useAdmin().userId
  // Areas searched earlier in this tab (before a reload) come back without asking the map again
  useEffect(() => {
    void hydrate(userId)
  }, [hydrate, userId])
  // New Clozest signups and the team's work show in searched areas by themselves (no map searches)
  useLiveUpdates()
  const areaQueries = useQueries({
    queries: districts.map((d) => ({
      queryKey: leadKeys.areas(d.kind, d.district, d.state),
      queryFn: () => leadsApi.areas(d.kind, d.district, d.state),
      staleTime: 60_000,
    })),
  })
  // A city and one of its districts may both be picked: each area once
  const seen = new Set<string>()
  const areas: AreaWithDistrict[] = areaQueries.flatMap((q) => q.data?.areas ?? []).filter((a) => !seen.has(a.pincode) && !!seen.add(a.pincode))
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

/**
 * Picks a place to view: adds the city or district (if not picked yet) and, when an area matched, puts that area in
 * the area search, ticked. Nothing is created: every area is already in the list.
 */
export function usePickPlace() {
  const { addDistrict, removeDistrict, setAreaFilter, select, knowAreas } = useLeads()
  return (d: LeadDistrict) => {
    const place = { kind: d.kind, district: d.district, state: d.state }
    // A city covers its districts: their chips go (their areas are the city's), so nothing is listed twice
    if (d.kind === 'CITY') {
      for (const x of useLeads.getState().districts) {
        if (x.kind === 'DISTRICT' && placeKey(x.state) === placeKey(d.state) && d.districts.some((n) => placeKey(n) === placeKey(x.district))) {
          // Its areas are the city's now: they keep their ticks and chips
          const pins = Object.entries(useLeads.getState().areaDistricts)
            .filter(([, owners]) => owners.some((o) => o.kind === x.kind && placeKey(o.district) === placeKey(x.district) && placeKey(o.state) === placeKey(x.state)))
            .map(([pin]) => pin)
          knowAreas(place, pins)
          removeDistrict(x)
        }
      }
    }
    addDistrict(place)
    if (d.pincode) {
      // Known as this place's at once: removing the place before its areas arrive also drops this tick
      knowAreas(place, [d.pincode])
      const now = useLeads.getState().areaFilter
      if (!now.includes(d.pincode)) setAreaFilter([...now, d.pincode])
      select([d.pincode], true)
    }
  }
}

const NONE: LeadDistrict[] = []

/** "City · Hyderabad, Medchal Malkajgiri, Ranga Reddy · 134 areas" / "District · Saharsa, Bihar · 13 areas". */
function placeLine(d: LeadDistrict, list: LeadDistrict[]) {
  // A result for one area opens its place with that area ticked: not a search of all its areas
  if (d.pincode) return `Opens ${d.district}${d.kind === 'CITY' ? ' (city)' : ''} with this area ticked`
  if (d.kind === 'CITY') return `City · ${d.districts.join(', ')} · ${count(d.pincodes)} areas`
  // "Hyderabad" the district next to Hyderabad the city: say it's only part of it
  const alsoCity = list.some((x) => x.kind === 'CITY' && x.district === d.district && x.state === d.state)
  return `${alsoCity ? 'District only' : 'District'} · ${d.state} · ${count(d.pincodes)} areas`
}

/**
 * The places matching what was typed: our own list first (cities, districts, pincodes, post offices: free); when it
 * has nothing and a name was typed, Mapbox's places ("Yapral": one map search, said so).
 */
function PlaceOptions({
  typed,
  q,
  onPick,
  empty,
  onOptions,
}: {
  typed: string
  q: string
  onPick: (d: LeadDistrict) => void
  empty: string
  /** The options shown now (for Enter to pick the first). */
  onOptions?: (list: LeadDistrict[]) => void
}) {
  const found = useDistricts(q)
  // A map look-up is paid: only once typing has paused a while (not one per letter of "yapral")
  const slowQ = useDebounced(q, 900)
  const settled = q === typed.trim()
  const nothingOurs = settled && found.isSuccess && found.data.length === 0
  // Asked for by a tap when our list had something (it may be a look-alike elsewhere: Madhapur the village)
  const [asked, setAsked] = useState<string | null>(null)
  const wantMap = (nothingOurs && slowQ === q) || asked === q
  const onMap = usePlaces(asked === q ? q : slowQ, wantMap)
  const list = useMemo(
    () => (asked === q && onMap.data ? onMap.data : found.data?.length ? found.data : (onMap.data ?? NONE)),
    [asked, q, found.data, onMap.data],
  )
  const fromMap = list === onMap.data && !!onMap.data
  useEffect(() => {
    onOptions?.(settled ? list : NONE)
    return () => onOptions?.(NONE) // closed: Enter has nothing to pick
  }, [list, settled, onOptions])
  if (q.length < 2) return <li role="presentation" className="p-2 text-sm text-muted">Type 2 or more letters or digits.</li>
  if (!settled || found.isPending) {
    return (
      <li role="presentation" className="p-2">
        <Spinner small label="Searching…" />
      </li>
    )
  }
  if (found.isError)
    return (
      <li role="presentation" className="p-2 text-sm text-bad">
        {explain(found.error)}
      </li>
    )
  if (!list.length) {
    if (nothingOurs && (onMap.isFetching || slowQ !== q)) {
      return (
        <li role="presentation" className="p-2">
          <Spinner small label="Looking it up on the map…" />
        </li>
      )
    }
    if (onMap.isError)
      return (
        <li role="presentation" className="p-2 text-sm text-bad">
          {explain(onMap.error)}
        </li>
      )
    return (
      <li role="presentation" className="p-2 text-sm text-muted">
        {empty}
      </li>
    )
  }
  return (
    <>
      {fromMap && (
        <li role="presentation" className="px-2 pt-1 text-xs text-muted">
          Found on the map (used 1 map search):
        </li>
      )}
      {list.map((d) => (
        <li key={`${d.kind}|${d.district}|${d.state}|${d.pincode ?? ''}`} role="option" aria-selected={false}>
          <button
            type="button"
            onClick={() => onPick(d)}
            className="flex min-h-12 w-full flex-col items-start justify-center rounded-xl px-3 py-1 text-left hover:bg-raised"
          >
            <span className="font-semibold [overflow-wrap:anywhere]">{d.matched ? `${d.matched} · ${d.district}` : `${d.district}, ${d.state}`}</span>
            <span className="text-sm text-muted [overflow-wrap:anywhere]">{placeLine(d, list)}</span>
          </button>
        </li>
      ))}
      {!fromMap && /\p{L}/u.test(q) && q.length >= 3 && (
        <li role="presentation" className="p-1">
          <button
            type="button"
            onClick={() => setAsked(q)}
            disabled={asked === q && onMap.isFetching}
            className="min-h-11 w-full rounded-xl px-2 text-left text-sm font-semibold text-link underline"
          >
            {asked === q && onMap.isFetching ? 'Looking it up on the map…' : `Not the one? Look up "${q}" on the map (uses 1 map search)`}
          </button>
          {asked === q && onMap.isSuccess && onMap.data.length === 0 && <p className="px-2 text-sm text-muted">The map doesn't know "{q}" either.</p>}
          {asked === q && onMap.isError && <p className="px-2 text-sm text-bad">{explain(onMap.error)}</p>}
        </li>
      )}
    </>
  )
}

/** A search box for any city, district, pincode, post office or place in India; the picked ones are chips with ×. */
function DistrictPicker() {
  const { districts, removeDistrict } = useLeads()
  const pickPlace = usePickPlace()
  const [typed, setTyped] = useState('')
  const q = useDebounced(typed.trim(), 300)
  const [options, setOptions] = useState<LeadDistrict[]>([])
  const listId = useId()
  const open = typed.trim().length >= 2
  const pick = (d: LeadDistrict) => {
    pickPlace(d)
    setTyped('')
  }
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
        placeholder="City, area, pincode, e.g. Hyderabad, Yapral, 500087"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          // Only what the list shows for what is typed now (not an older answer still on screen)
          // Only what the list shows for what is typed now (ours or the map's)
          if (e.key === 'Enter' && open && q === typed.trim() && options[0]) pick(options[0])
          if (e.key === 'Escape') setTyped('')
        }}
        className="min-h-12 rounded-xl border border-line bg-surface px-4 text-base text-ink placeholder:text-muted/60 focus:border-brand focus:outline-none"
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Matching places" className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          <PlaceOptions
            typed={typed}
            q={q}
            onPick={pick}
            onOptions={setOptions}
            empty={`Nothing in India matches "${typed.trim()}". Check the spelling, or try the pincode.`}
          />
        </ul>
      )}
      {districts.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Places picked">
          {districts.map((d) => (
            <li key={`${d.kind}|${d.district}|${d.state}`}>
              <span className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-brand bg-brand/15 pl-3 text-sm font-semibold">
                {d.district}
                {d.kind === 'CITY' ? ' (city)' : ''}, {d.state}
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
    </Card>
  )
}

/** The area search (chips), the areas list with ticks, and the Search button with its progress. */
function AreaPanel({ areas }: { areas: AreaWithDistrict[] }) {
  const me = useAdmin()
  const superAdmin = isSuperAdmin(me.adminRole)
  const { areaFilter, setAreaFilter, selected, toggle, select, clearSelection, scans, savedAt, confirmedAt, failed, progress, stopped, scanSelected, stop, searchAgain, clearSaved } = useLeads()
  const usage = useUsage()
  const liveUsage = useLeads((s) => s.usage) ?? usage.data ?? null
  const [typed, setTyped] = useState('')
  const elsewhereQ = useDebounced(typed.trim(), 300)
  const pickPlace = usePickPlace()
  const multiDistrict = new Set(areas.map((a) => a.district)).size > 1
  const [confirmBig, setConfirmBig] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [shownNote, setShownNote] = useState<string | null>(null)
  const listId = useId()
  // "searched 5 min ago" moves on by itself, and areas kept over a day are dropped while the page stays open
  const now = useNow(60_000)
  const dropOld = useLeads((s) => s.dropOld)
  const hydrating = useLeads((s) => s.hydrating)
  useEffect(() => dropOld(now), [now, dropOld])
  const suggestions = matchAreas(areas, typed, areaFilter)
  const shown = shownAreas(areas, areaFilter)
  const mine = areas.filter((a) => a.mine)
  const byPin = new Map(areas.map((a) => [a.pincode, a]))
  const allShownTicked = shown.length > 0 && shown.every((a) => selected.includes(a.pincode))
  // Ticked areas already searched in this tab are shown from what was kept: only the new ones ask the map
  const tickedSaved = selected.filter((p) => scans[p]).length
  const tickedNew = selected.length - tickedSaved
  // Only areas of the districts picked (a removed district's areas aren't shown, so not counted)
  const savedPins = Object.keys(scans).filter((p) => byPin.has(p))
  const oldest = savedPins.length ? Math.min(...savedPins.map((p) => savedAt[p] ?? now)) : null
  const plural = (n: number) => `${n} area${n === 1 ? '' : 's'}`
  const ago = (at: number | undefined) => {
    const text = howLong(new Date(at ?? now).toISOString(), now)
    return text === 'just now' ? text : `${text} ago`
  }
  const searchLabel = !selected.length
    ? 'Tick areas to search'
    : tickedNew === 0
      ? `Already shown below (${plural(tickedSaved)})`
      : tickedSaved === 0
        ? `Search ${plural(tickedNew)} on the map`
        : `Show ${plural(selected.length)} (${tickedSaved} saved, ${tickedNew} new)`
  // The big-search question goes away once it no longer applies
  useEffect(() => {
    if (confirmBig && tickedNew <= 10) setConfirmBig(false)
  }, [confirmBig, tickedNew])

  function press() {
    setShownNote(null)
    if (tickedNew > 10) return setConfirmBig(true)
    if (tickedNew === 0) {
      // Nothing to ask the map: point to where they already are
      setShownNote(`${plural(tickedSaved)} already searched: their businesses are in the list below.`)
      scanSelected()
      document.getElementById('lead-results')?.focus()
      document.getElementById('lead-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    scanSelected()
  }

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
        aria-expanded={typed.trim().length > 0}
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
          {suggestions.length === 0 && matchAreas(areas, typed, []).length > 0 ? (
            <li role="presentation" className="p-2 text-sm text-muted">
              Already in the area search above.
            </li>
          ) : suggestions.length === 0 ? (
            // Not in the places picked: anywhere in India (tapping one shows its city or district, that area ticked)
            <>
              <li role="presentation" className="px-2 pt-1 text-xs text-muted">
                Not in the places picked. Elsewhere in India:
              </li>
              <PlaceOptions
                typed={typed}
                q={elsewhereQ}
                onPick={(d) => {
                  pickPlace(d)
                  setTyped('')
                }}
                empty={`No area in India matches "${typed.trim()}". Check the spelling, or try the pincode.`}
              />
            </>
          ) : (
            suggestions.map((a) => (
              <li key={a.pincode} role="option" aria-selected={false}>
                <button type="button" onClick={() => add(a.pincode)} className="flex min-h-12 w-full items-center rounded-xl px-3 text-left hover:bg-raised">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-semibold">{a.pincode}</span> {a.places}
                    {multiDistrict && <span className="text-sm text-muted"> · {a.district}</span>}
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
        {savedPins.length > 0 && (
          <Button variant="secondary" className="min-h-11" onClick={() => setAreaFilter(savedPins)}>
            Searched ({savedPins.length})
          </Button>
        )}
        {selected.length > 0 && (
          <Button variant="ghost" className="min-h-11" onClick={clearSelection}>
            Untick all
          </Button>
        )}
      </div>

      {shown.length > 30 && !areaFilter.length && (
        <p className="text-sm text-muted">{count(shown.length)} areas. Type an area name or pincode in Search areas to find yours quickly.</p>
      )}
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
                    {running
                      ? ' · searching…'
                      : queued
                        ? ' · waiting'
                        : scanned
                          ? ` · ${count(scanned.shops.length)} found, searched ${ago(savedAt[a.pincode])}${
                              (confirmedAt[a.pincode] ?? 0) > (savedAt[a.pincode] ?? 0) + 60_000 ? `, statuses updated ${ago(confirmedAt[a.pincode])}` : ''
                            }`
                          : ''}
                  </span>
                  {failed[a.pincode] && <span className="text-xs text-bad">{failed[a.pincode]}</span>}
                </span>
              </label>
              {scanned && !progress && (
                <button
                  type="button"
                  aria-label={`Search again (uses map searches): ${a.pincode}`}
                  onClick={() => {
                    searchAgain([a.pincode])
                    // The button goes while it searches: keep the keyboard on Stop
                    requestAnimationFrame(() => document.getElementById('lead-stop')?.focus())
                  }}
                  className="ml-10 min-h-11 text-sm font-semibold text-link underline"
                >
                  Search again (uses map searches)
                </button>
              )}
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
            <Button id="lead-stop" variant="secondary" className="min-h-11" onClick={stop}>
              Stop
            </Button>
          </div>
        </div>
      ) : (
        <>
          {confirmBig && (
            <Banner tone="warn">
              <span className="block">
                {tickedNew} new areas use about {count(tickedNew * 40)} to {count(tickedNew * 150)} of this month's map searches
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
                  Yes, search {tickedNew}
                </Button>
                <Button variant="secondary" className="min-h-11" onClick={() => setConfirmBig(false)}>
                  Not now
                </Button>
              </span>
            </Banner>
          )}
          <Button id="lead-search" disabled={!selected.length || hydrating} onClick={press}>
            {hydrating ? 'Loading saved areas…' : searchLabel}
          </Button>
          {shownNote && (
            <p className="text-sm text-muted" role="status">
              {shownNote}
            </p>
          )}
        </>
      )}
      {savedPins.length > 0 && !progress && (
        <div className="flex flex-col gap-2 rounded-xl border border-line px-3 py-2">
          <p className="text-sm text-muted">
            {plural(savedPins.length)} saved on this page (oldest searched {ago(oldest ?? undefined)}). Saved until you close this page, up to 1 day: no map
            searches used. Clozest signups and the team's lead statuses update by themselves about every 30 seconds while you're on
            this screen. Search again only for businesses that are new or closed, or a changed phone number.
          </p>
          <LiveStatus />
          {confirmClear ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Clear saved results?">
              <span className="text-sm">Clear {plural(savedPins.length)}? Seeing them again uses map searches.</span>
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={() => {
                  clearSaved()
                  setConfirmClear(false)
                  setShownNote(null)
                  // The Search button is usually disabled now (nothing ticked): keep the keyboard on the area search
                  requestAnimationFrame(() => document.getElementById('area-search')?.focus())
                }}
              >
                Yes, clear
              </Button>
              <Button variant="ghost" className="min-h-11" onClick={() => setConfirmClear(false)}>
                Keep them
              </Button>
            </div>
          ) : (
            <Button variant="ghost" className="min-h-11 self-start" onClick={() => setConfirmClear(true)}>
              Clear saved results
            </Button>
          )}
        </div>
      )}
      {liveUsage && (
        <p className="text-xs text-muted">
          Map searches this month: {count(liveUsage.used)} of {count(liveUsage.cap)}. One area uses about 40 to 150.
        </p>
      )}
    </Card>
  )
}
