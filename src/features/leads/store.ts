import { create } from 'zustand'
import { leadsApi, scanProblem } from '../../api/leads'
import type { Lead, LeadScan, LeadUsage } from '../../api/types'
import { storage } from '../../lib/storage'
import { NO_FILTERS, type Filters } from './logic'

const DISTRICTS_KEY = 'ada.leads.districts'

/** Areas searched at the same time: enough to be quick, few enough not to crowd the server (it allows 4 per server). */
export const SCANS_AT_ONCE = 2

export interface District {
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
   * Each searched area's answer, kept only while the page is open in this tab (the map's results may not be stored):
   * a reload starts empty.
   */
  scans: Record<string, LeadScan>
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
  areaDistricts: Record<string, District>
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
  /** A lead saved from the list: every area showing that business shows the new lead. */
  leadSaved: (mapboxId: string, lead: Lead) => void
  /** Sign-out: stops any search and forgets the results and the districts (a shared phone shows the next person none). */
  reset: () => void
}

/** How many times one area is tried again while the server is busy, before it is marked failed. */
export const BUSY_TRIES = 5

function savedDistricts(): District[] {
  const saved = storage.getJson<District[]>(DISTRICTS_KEY)
  return Array.isArray(saved) ? saved.filter((d) => d && typeof d.district === 'string' && typeof d.state === 'string').slice(0, 10) : []
}

/** Said when a search was cut short by the month's cap (the area's answer is shown; the rest wait). */
export const CAP_REACHED = "This month's map searches are used up, so the search stopped. Ask a super admin to raise the monthly limit."

const same = (a: District, b: District) => a.district === b.district && a.state === b.state

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
      set((s) => ({ scans: { ...s.scans, [pincode]: scan }, failed, usage: scan.usage, selected: s.selected.filter((x) => x !== pincode) }))
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
        const d = get().areaDistricts[pincode]
        const stillPicked = !d || get().districts.some((x) => same(x, d))
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

  return {
    districts: savedDistricts(),
    areaFilter: [],
    selected: [],
    scans: {},
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
      // Its areas go too: not ticked, not in the area search, not waiting to be searched
      const gone = new Set(Object.entries(get().areaDistricts).filter(([, x]) => same(x, d)).map(([pin]) => pin))
      set((s) => ({
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
        for (const pin of pincodes) areaDistricts[pin] = d
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

    scanSelected: () => {
      const s = get()
      if (s.progress || !s.selected.length) return
      controller = new AbortController()
      busy = {}
      const signal = controller.signal
      set({ stopped: null, progress: { queue: [...s.selected], running: [], done: 0, total: s.selected.length } })
      for (let i = 0; i < SCANS_AT_ONCE; i++) void next(signal)
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
        return { scans }
      }),
    reset: () => {
      controller?.abort()
      controller = null
      busy = {}
      storage.remove(DISTRICTS_KEY)
      set({ districts: [], areaFilter: [], selected: [], scans: {}, failed: {}, progress: null, stopped: null, usage: null, filters: NO_FILTERS, areaDistricts: {} })
    },
  }
})
