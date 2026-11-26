import type { LeadScan } from '../../api/types'

/**
 * Searched areas kept in this browser tab, so a reload or a visit to another page doesn't search the map again.
 *
 * Mapbox allows its results for short-term use only, so they live in this tab's sessionStorage: the browser itself
 * wipes it when the tab is closed (and a new tab starts empty). On top of that they are kept for at most
 * {@link MAX_AGE_MS}, only for the person who searched, and sign-out removes them. A whole city doesn't fit in
 * sessionStorage as plain text (about 5 MB), so each area is stored gzip-compressed (about a tenth of the size); when
 * storage is full anyway, the oldest areas make room, and if that isn't enough the area just isn't kept.
 *
 * Every call fails quietly (private windows, storage blocked): the page then works as before, searching again after a
 * reload.
 */

/** How long a searched area may be reused. */
export const MAX_AGE_MS = 24 * 3600_000

const PREFIX = 'ada.leads.scan.'
/** Bumped by {@link forgetAll}: a save still compressing when everything was forgotten (sign-out, Clear) is dropped. */
let generation = 0

interface Stored {
  user: string
  savedAt: number
  /** The scan as JSON: gzip + base64 ("z:") when the browser can compress, else plain ("j:"). */
  data: string
}

export interface SavedScan {
  pincode: string
  user: string
  savedAt: number
  scan: LeadScan
}

const canZip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'

async function zip(text: string): Promise<string> {
  if (!canZip) return `j:${text}`
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `z:${btoa(bin)}`
}

async function unzip(data: string): Promise<string> {
  if (data.startsWith('j:')) return data.slice(2)
  const bin = atob(data.slice(2))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

function keys(): string[] {
  try {
    const out: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k?.startsWith(PREFIX)) out.push(k)
    }
    return out
  } catch {
    return []
  }
}

function read(key: string): Stored | null {
  try {
    const raw = sessionStorage.getItem(key)
    const v = raw ? (JSON.parse(raw) as Stored) : null
    return v && typeof v.user === 'string' && typeof v.savedAt === 'number' && typeof v.data === 'string' ? v : null
  } catch {
    return null
  }
}

function remove(key: string) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* blocked */
  }
}

/** This tab's searched areas for this person, newer than {@link MAX_AGE_MS}; older or unreadable ones are removed. */
export async function loadSaved(user: string, now: number = Date.now()): Promise<SavedScan[]> {
  const out: SavedScan[] = []
  for (const key of keys()) {
    const v = read(key)
    if (!v || now - v.savedAt >= MAX_AGE_MS) {
      remove(key)
      continue
    }
    if (v.user !== user) continue
    try {
      const scan = JSON.parse(await unzip(v.data)) as LeadScan
      if (scan && scan.pincode === key.slice(PREFIX.length) && Array.isArray(scan.shops)) {
        out.push({ pincode: scan.pincode, user, savedAt: v.savedAt, scan })
      } else {
        remove(key)
      }
    } catch {
      remove(key)
    }
  }
  return out
}

/** The latest save asked for per area: a slower, older save finishing after a newer one is dropped. */
const latest: Record<string, number> = {}
let saves = 0

/**
 * Keeps one searched area for this tab (replacing an older search of it); full storage makes room from the oldest.
 * Called often (every update of an area while the page is open), so the other areas are read only when storage is
 * full.
 */
export async function saveScan(user: string, scan: LeadScan, savedAt: number = Date.now()): Promise<void> {
  const started = generation
  const mine = ++saves
  latest[scan.pincode] = mine
  let value: string
  try {
    value = JSON.stringify({ user, savedAt, data: await zip(JSON.stringify(scan)) } satisfies Stored)
  } catch {
    return
  }
  if (generation !== started || latest[scan.pincode] !== mine) return
  const key = PREFIX + scan.pincode
  let others: { k: string; at: number }[] | null = null
  for (;;) {
    try {
      sessionStorage.setItem(key, value)
      return
    } catch {
      // Oldest first: what goes when storage is full
      others ??= keys()
        .filter((k) => k !== key)
        .map((k) => ({ k, at: read(k)?.savedAt ?? 0 }))
        .sort((a, b) => a.at - b.at)
      const oldest = others.shift()
      if (!oldest) return // blocked, or this one area alone is too big: just not kept
      remove(oldest.k)
    }
  }
}

/** Forgets some searched areas. */
export function forgetScans(pincodes: string[]) {
  pincodes.forEach((p) => remove(PREFIX + p))
}

/** Forgets every searched area kept in this tab ("Clear saved results", sign-out). */
export function forgetAll() {
  generation++
  keys().forEach(remove)
}
