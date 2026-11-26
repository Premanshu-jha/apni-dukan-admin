import { create } from 'zustand'
import { leadsApi, scanProblem } from '../../api/leads'
import type { Lead, LeadScan, LeadUsage, PlaceKind } from '../../api/types'
import { storage } from '../../lib/storage'
import { NO_FILTERS, type Filters } from './logic'
import { forgetAll, forgetScans, loadSaved, MAX_AGE_MS, saveScan } from './savedScans'

const DISTRICTS_KEY = 'ada.leads.districts'

/** Areas searched at the same time: enough to be quick, few enough not to crowd the server (it allows 4 per server). */
export const SCANS_AT_ONCE = 2

/** A picked city or district (remembered on this device). */
export interface District {
  /** CITY: all areas of its districts; DISTRICT (also what was saved before cities existed). */
  kind: PlaceKind
  district: string
  state: string
}

export interface ScanProgress {
  /** Pincodes still to search, in order. */
  queue: string[]
  running: string[]
  done: number
  total: number
}

interface LeadsState {
  /** The districts picked (remembered on this device: just names). */
  districts: District[]
  /** The areas typed into the area search (pincodes); empty = every area of the districts. */
  areaFilter: string[]
  /** The areas ticked for searching. */
  selected: string[]
  /**
   * Each searched area's answer, kept in this tab (also through reloads, see savedScans) until the tab is closed, for
   * a day at most: the map's results are for short-term use only.
   */
  scans: Record<string, LeadScan>
  /** When each area in {@link scans} was searched (ms): shown as "saved 2 h ago"; kept with it until the tab closes. */
  savedAt: Record<string, number>
  /** Whose saved searches were loaded into this tab (they are kept per person). */
  user: string | null
  /** True while this tab's kept areas are being read back (after a reload): the page shows loading, not "none". */
  hydrating: boolean
  /** Areas whose last search failed, with the reason. */
  failed: Record<string, string>
  progress: ScanProgress | null
  /** A problem that stopped the search (no key, cap reached, too many this hour). */
  stopped: string | null
  usage: LeadUsage | null
  filters: Filters

  addDistrict: (d: District) => void
  removeDistrict: (d: District) => void
  /** Which district each listed area belongs to (so removing a district drops its areas). */
  /** The picked places that list each area (a city and one of its districts can both list it). */
  areaDistricts: Record<string, District[]>
  knowAreas: (d: District, pincodes: string[]) => void
  setAreaFilter: (pincodes: string[]) => void
  toggle: (pincode: string) => void
  select: (pincodes: string[], on: boolean) => void
  clearSelection: () => void
  setFilters: (f: Partial<Filters>) => void
  resetFilters: () => void
  /** Searches the selected areas, {@link SCANS_AT_ONCE} at a time. */
  scanSelected: () => void
  stop: () => void
  /** Loads this tab's saved searches for the signed-in person (once per person). */
  hydrate: (user: string) => Promise<void>
  /** Searches these areas again even though they are saved (fresh results from the map). */
  searchAgain: (pincodes: string[]) => void
  /** "Clear saved results": forgets every searched area in this tab; the next search asks the map again. */
  clearSaved: () => void
  /** Drops kept areas older than a day (also while the tab stays open). */
  dropOld: (now?: number) => void
  /** A lead saved from the list: every area showing that business shows the new lead. */
  leadSaved: (mapboxId: string, lead: Lead) => void
  /** Sign-out: stops any search and forgets the results and the districts (a shared phone shows the next person none). */
  reset: () => void
}

/** How many times one area is tried again while the server is busy, before it is marked failed. */
export const BUSY_TRIES = 5

function savedDistricts(): District[] {
  const saved = storage.getJson<District[]>(DISTRICTS_KEY)
  return Array.isArray(saved)
    ? saved
        .filter((d) => d && typeof d.district === 'string' && typeof d.state === 'string')
        .map((d) => ({ kind: d.kind === 'CITY' ? ('CITY' as const) : ('DISTRICT' as const), district: d.district, state: d.state }))
        .slice(0, 10)
    : []
}

/** Said when a search was cut short by the month's cap (the area's answer is shown; the rest wait). */
export const CAP_REACHED = "This month's map searches are used up, so the search stopped. Ask a super admin to raise the monthly limit."

/** Names compared as the backend does (case and dots don't matter: "Y.s.r." saved before is "Y.S.R." now). */
export const placeKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const same = (a: District, b: District) => a.kind === b.kind && placeKey(a.district) === placeKey(b.district) && placeKey(a.state) === placeKey(b.state)

let controller: AbortController | null = null
/** Times each area was sent back by a busy server in this search. */
let busy: Record<string, number> = {}

export const useLeads = create<LeadsState>((set, get) => {
  /** Takes the next area off the queue and searches it; the queue drains SCANS_AT_ONCE at a time. */
  async function next(signal: AbortSignal): Promise<void> {
    const p = get().progress
    if (!p || signal.aborted) return
    const pincode = p.queue[0]
    if (!pincode || get().stopped) {
      // Nothing left for this worker: the search ends once the last one running has answered
      if (!p.running.length) set({ progress: null })
      return
    }
    set({ progress: { ...p, queue: p.queue.slice(1), running: [...p.running, pincode] } })
    let retryAfter: number | undefined
    try {
      const scan = await leadsApi.scan(pincode, signal)
      const failed = { ...get().failed }
      delete failed[pincode]
      const at = Date.now()
      set((s) => ({ scans: { ...s.scans, [pincode]: scan }, savedAt: { ...s.savedAt, [pincode]: at }, failed, usage: scan.usage, selected: s.selected.filter((x) => x !== pincode) }))
      const user = get().user
      if (user) void saveScan(user, scan, at)
      if (scan.capReached) set({ stopped: CAP_REACHED })
    } catch (e) {
      if (signal.aborted) return
      const problem = scanProblem(e)
      busy[pincode] = (busy[pincode] ?? 0) + 1
      if (problem.stop) set({ stopped: problem.message })
      else if (problem.retryAfter !== undefined && busy[pincode] <= BUSY_TRIES) retryAfter = Math.max(1, problem.retryAfter)
      else set((s) => ({ failed: { ...s.failed, [pincode]: problem.message } }))
    } finally {
      const now = get().progress
      if (now) {
        // Not put back if its district was removed while it was being searched
        const owners = get().areaDistricts[pincode]
        // Unknown (picked before its areas arrived): still picked; known but no picked place lists it: removed
        const stillPicked = owners === undefined || owners.some((o) => get().districts.some((x) => same(x, o)))
        const requeue = retryAfter !== undefined && !signal.aborted && stillPicked
        set({
          progress: {
            ...now,
            running: now.running.filter((x) => x !== pincode),
            queue: requeue ? [...now.queue, pincode] : now.queue,
            done: requeue ? now.done : now.done + 1,
          },
        })
      }
    }
    if (retryAfter !== undefined) await new Promise((r) => setTimeout(r, retryAfter! * 1000))
    const after = get().progress
    if (after && !after.queue.length && !after.running.length) {
      set({ progress: null })
      return
    }
    await next(signal)
  }

  /** Searches these areas, {@link SCANS_AT_ONCE} at a time (ticked or not). */
  function start(pincodes: string[]) {
    if (get().progress || get().hydrating || !pincodes.length) return
    controller = new AbortController()
    busy = {}
    const signal = controller.signal
    set({ stopped: null, progress: { queue: [...pincodes], running: [], done: 0, total: pincodes.length } })
    for (let i = 0; i < SCANS_AT_ONCE; i++) void next(signal)
  }

  return {
    districts: savedDistricts(),
    areaFilter: [],
    selected: [],
    scans: {},
    savedAt: {},
    user: null,
    hydrating: false,
    failed: {},
    progress: null,
    stopped: null,
    usage: null,
    filters: NO_FILTERS,

    addDistrict: (d) => {
      if (get().districts.some((x) => same(x, d))) return
      const districts = [...get().districts, d].slice(-10)
      storage.setJson(DISTRICTS_KEY, districts)
      set({ districts })
    },
    removeDistrict: (d) => {
      const districts = get().districts.filter((x) => !same(x, d))
      storage.setJson(DISTRICTS_KEY, districts)
      // Its areas go too (not ticked, not in the area search, not waiting to be searched), unless another picked
      // place still lists them
      const owners: Record<string, District[]> = {}
      for (const [pin, list] of Object.entries(get().areaDistricts)) owners[pin] = list.filter((x) => !same(x, d))
      const gone = new Set(Object.keys(owners).filter((pin) => owners[pin].length === 0 && get().areaDistricts[pin].length > 0))
      set((s) => ({
        areaDistricts: owners,
        districts,
        selected: s.selected.filter((x) => !gone.has(x)),
        areaFilter: s.areaFilter.filter((x) => !gone.has(x)),
        progress: s.progress ? { ...s.progress, queue: s.progress.queue.filter((x) => !gone.has(x)), total: s.progress.total - s.progress.queue.filter((x) => gone.has(x)).length } : null,
      }))
    },
    areaDistricts: {},
    knowAreas: (d, pincodes) =>
      set((s) => {
        const areaDistricts = { ...s.areaDistricts }
        for (const pin of pincodes) {
          const had = areaDistricts[pin] ?? []
          if (!had.some((x) => same(x, d))) areaDistricts[pin] = [...had, d]
        }
        return { areaDistricts }
      }),
    setAreaFilter: (areaFilter) => set({ areaFilter }),
    toggle: (pincode) =>
      set((s) => ({ selected: s.selected.includes(pincode) ? s.selected.filter((x) => x !== pincode) : [...s.selected, pincode] })),
    select: (pincodes, on) =>
      set((s) => ({ selected: on ? [...new Set([...s.selected, ...pincodes])] : s.selected.filter((x) => !pincodes.includes(x)) })),
    clearSelection: () => set({ selected: [] }),
    setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
    resetFilters: () => set({ filters: NO_FILTERS }),

    hydrate: async (user) => {
      if (get().user === user) return
      set({ user, hydrating: true })
      const saved = await loadSaved(user)
      if (get().user !== user) return
      set({ hydrating: false })
      if (!saved.length) return
      set((s) => {
        const scans = { ...s.scans }
        const savedAt = { ...s.savedAt }
        for (const x of saved) {
          // A search made in this tab meanwhile is newer: keep it
          if (!scans[x.pincode]) {
            scans[x.pincode] = x.scan
            savedAt[x.pincode] = x.savedAt
          }
        }
        return { scans, savedAt }
      })
    },
    // Only these areas, whatever else is ticked; what was kept stays shown until the fresh answer replaces it
    searchAgain: (pincodes) => start(pincodes),
    clearSaved: () => {
      if (get().progress) return
      forgetAll()
      set({ scans: {}, savedAt: {} })
    },
    dropOld: (now = Date.now()) => {
      const old = Object.keys(get().savedAt).filter((p) => now - get().savedAt[p] >= MAX_AGE_MS)
      if (!old.length) return
      set((s) => {
        const scans = { ...s.scans }
        const savedAt = { ...s.savedAt }
        old.forEach((p) => {
          delete scans[p]
          delete savedAt[p]
        })
        return { scans, savedAt }
      })
      forgetScans(old)
    },

    scanSelected: () => {
      get().dropOld()
      const s0 = get()
      if (s0.progress || s0.hydrating || !s0.selected.length) return
      // Areas already searched and kept are shown as they are: only the others ask the map
      const fresh = s0.selected.filter((p) => !s0.scans[p])
      set({ selected: fresh })
      start(fresh)
    },
    stop: () => {
      controller?.abort()
      controller = null
      set({ progress: null })
    },
    leadSaved: (mapboxId, lead) =>
      set((s) => {
        const scans: Record<string, LeadScan> = {}
        for (const [pin, scan] of Object.entries(s.scans)) {
          scans[pin] = scan.shops.some((x) => x.mapboxId === mapboxId)
            ? { ...scan, shops: scan.shops.map((x) => (x.mapboxId === mapboxId ? { ...x, lead } : x)) }
            : scan
        }
        const user = s.user
        if (user) for (const [pin, scan] of Object.entries(scans)) if (scan !== s.scans[pin]) void saveScan(user, scan, s.savedAt[pin] ?? Date.now())
        return { scans }
      }),
    reset: () => {
      controller?.abort()
      controller = null
      busy = {}
      storage.remove(DISTRICTS_KEY)
      forgetAll()
      set({ user: null, hydrating: false, savedAt: {}, districts: [], areaFilter: [], selected: [], scans: {}, failed: {}, progress: null, stopped: null, usage: null, filters: NO_FILTERS, areaDistricts: {} })
    },
  }
})
