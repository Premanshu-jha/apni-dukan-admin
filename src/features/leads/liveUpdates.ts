import type { LeadAreaStatus, LeadScan, LeadSeen } from '../../api/types'

/**
 * Keeping searched areas up to date while the Leads page is open, without searching the map again: every
 * {@link CHECK_EVERY_MS} the page asks which of the pincodes it watches changed (a lead saved or signed up, a Clozest
 * salon registered or changed status), then brings up to {@link REFRESH_PER_CHECK} of the areas showing them up to
 * date from our own data. It watches the searched areas and the pincodes of the businesses shown in them: a business
 * the map files under the next pincode has its lead saved there. These are the pure parts; the store runs them.
 */

/** How often the page checks while it is on screen. */
export const CHECK_EVERY_MS = 30_000
/** Checks closer together than this are skipped (coming back to the tab right after a check): at most 4 a minute. */
export const MIN_GAP_MS = 15_000
/** Areas brought up to date per check (the rest on the next ones, longest waiting first). */
export const REFRESH_PER_CHECK = 5
/** Most pincodes one check asks about, and most businesses one refresh sends (the server's limits). */
export const MAX_AREAS = 300
export const MAX_SEEN = 3000
/** How long a check or refresh may take before it is given up (a stalled phone connection). */
export const REQUEST_TIMEOUT_MS = 15_000
/** "Up to date" only while the last good check is this recent; else the page says it can't check right now. */
export const FRESH_FOR_MS = 2 * 60_000
/** For an area saved before checks existed (no `asOf`): ask from the start, so it is brought up to date once. */
const LONG_AGO = '2000-01-01T00:00:00.000Z'

const later = (a: string | undefined, b: string): string => (a && Date.parse(a) > Date.parse(b) ? a : b)
export { later }

/** The time to ask from for a searched area: the later of its last check and its answer's `asOf`. */
export function sinceOf(scan: LeadScan, checkedAt: string | undefined): string {
  return later(checkedAt, scan.asOf ?? LONG_AGO)
}

const PINCODE = /^[1-9]\d{5}$/

/** The pincodes a searched area depends on: its own, and those of the businesses it shows. */
export function pincodesOf(scan: LeadScan): string[] {
  const out = new Set([scan.pincode])
  for (const s of scan.shops) if (PINCODE.test(s.pincode)) out.add(s.pincode)
  return [...out]
}

/**
 * What one check asks about: every pincode the searched areas depend on, each from the oldest time any area showing
 * it was brought up to date (or its own last check, if later), the longest waiting first, at most {@link MAX_AREAS}.
 */
export function watchList(scans: Record<string, LeadScan>, checkedAt: Record<string, string>): { pincode: string; since: string }[] {
  const since = new Map<string, string>()
  for (const scan of Object.values(scans)) {
    const areaSince = sinceOf(scan, checkedAt[scan.pincode])
    for (const pin of pincodesOf(scan)) {
      const had = since.get(pin)
      since.set(pin, had && Date.parse(had) < Date.parse(areaSince) ? had : areaSince)
    }
  }
  return [...since.entries()]
    .map(([pincode, s]) => ({ pincode, since: pincode in scans ? s : later(checkedAt[pincode], s) }))
    .sort((a, b) => Date.parse(a.since) - Date.parse(b.since) || a.pincode.localeCompare(b.pincode))
    .slice(0, MAX_AREAS)
}

/** The searched areas showing any of these changed pincodes, the longest waiting first. */
export function areasFor(changed: Set<string>, scans: Record<string, LeadScan>, checkedAt: Record<string, string>): string[] {
  return Object.values(scans)
    .filter((scan) => pincodesOf(scan).some((p) => changed.has(p)))
    .sort((a, b) => Date.parse(sinceOf(a, checkedAt[a.pincode])) - Date.parse(sinceOf(b, checkedAt[b.pincode])) || a.pincode.localeCompare(b.pincode))
    .map((s) => s.pincode)
}

const inIndia = (lat: number, lng: number) => lat >= 6 && lat <= 37.6 && lng >= 68 && lng <= 97.5

/** What the page sends of the businesses it shows (a saved lead without a point is matched by phone only). */
export function seenOf(scan: LeadScan): LeadSeen[] {
  return scan.shops.slice(0, MAX_SEEN).map((s) => {
    const point = inIndia(s.latitude, s.longitude)
    return {
      mapboxId: s.mapboxId, name: s.name.slice(0, 300), latitude: point ? s.latitude : null, longitude: point ? s.longitude : null,
      phone: s.phone, matchKey: s.matchKey ?? null,
    }
  })
}

/**
 * The area with what the server says now: each business's lead and Clozest salon, contacted leads it didn't show yet
 * (added at the end, marked as added by the team), the salons no business matched, and the new `asOf`. Everything else
 * (names, phones, hours) stays as the map gave it. `changed`: how many businesses look different now.
 */
export function applyRefresh(scan: LeadScan, now: LeadAreaStatus): { scan: LeadScan; changed: number } {
  const byId = new Map(now.shops.map((x) => [x.mapboxId, x]))
  const shown = new Set(scan.shops.map((x) => x.mapboxId))
  let changed = 0
  const shops = scan.shops.map((x) => {
    const u = byId.get(x.mapboxId)
    if (!u) return x
    if (JSON.stringify(u.lead) === JSON.stringify(x.lead) && JSON.stringify(u.clozest) === JSON.stringify(x.clozest)) return x
    changed++
    return { ...x, lead: u.lead, clozest: u.clozest }
  })
  const added = now.saved.filter((x) => !shown.has(x.mapboxId)).map((x) => ({ ...x, addedLive: true }))
  changed += added.length
  return { scan: { ...scan, shops: [...shops, ...added], clozestOnly: now.clozestOnly, asOf: now.asOf }, changed }
}
