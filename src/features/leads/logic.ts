import type { Lead, LeadArea, LeadDue, LeadIn, LeadKind, LeadPriority, LeadScan, LeadShop, LeadStatus, ShopStatus } from '../../api/types'

export const KIND_LABELS: Record<LeadKind, string> = {
  LADIES_PARLOUR: 'Ladies beauty parlour',
  UNISEX_SALON: 'Unisex & family salon',
  MENS_SALON: "Men's salon & barber",
  BRIDAL_MAKEUP: 'Bridal & makeup studio',
  MEHENDI: 'Mehendi artist',
  SPA_MASSAGE: 'Spa & massage',
  NAIL_LASH: 'Nail & lash studio',
  SKIN_HAIR_CLINIC: 'Skin & hair clinic',
  TATTOO: 'Tattoo studio',
  COSMETICS_SHOP: 'Cosmetics shop (check services)',
  OTHER: 'Other beauty service',
}

/** The dot colour of each kind on the map and in the list. */
export const KIND_COLOURS: Record<LeadKind, string> = {
  LADIES_PARLOUR: '#ff7aa8',
  UNISEX_SALON: '#7cc4ff',
  MENS_SALON: '#f2c46d',
  BRIDAL_MAKEUP: '#c9a7ff',
  MEHENDI: '#8bd17c',
  SPA_MASSAGE: '#4fd1c5',
  NAIL_LASH: '#ff9f6b',
  SKIN_HAIR_CLINIC: '#d9d9e0',
  TATTOO: '#9aa0a6',
  COSMETICS_SHOP: '#b08968',
  OTHER: '#6b7280',
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'Not contacted',
  NO_ANSWER: 'No answer',
  CALLED: 'Called',
  VISITED: 'Visited',
  INTERESTED: 'Interested',
  NOT_INTERESTED: 'Not interested',
}

export const PRIORITY_LABELS: Record<LeadPriority, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' }

/** "On Clozest" filter: every business, only Clozest salons (optionally one status), or only those not on Clozest. */
export type ClozestFilter = 'ALL' | 'ON' | 'OFF'

export interface Filters {
  text: string
  clozest: ClozestFilter
  /** With clozest ON: only salons with this status ('' = any). */
  clozestStatus: ShopStatus | ''
  /** 'SIGNED' = signed up through a lead. */
  status: LeadStatus | 'SIGNED' | ''
  kind: LeadKind | ''
  chain: '' | 'LOCAL' | 'CHAIN'
  pincode: string
  phoneOnly: boolean
  mineOnly: boolean
  sort: 'PRIORITY' | 'NAME' | 'AREA'
}

export const NO_FILTERS: Filters = {
  text: '',
  clozest: 'ALL',
  clozestStatus: '',
  status: '',
  kind: '',
  chain: '',
  pincode: '',
  phoneOnly: false,
  mineOnly: false,
  sort: 'PRIORITY',
}

/** A row of the list: a business found on the map, or a Clozest salon no business matched (salon only). */
export type Row =
  | { type: 'shop'; key: string; shop: LeadShop; area: string }
  | { type: 'salon'; key: string; salon: LeadScan['clozestOnly'][number]; area: string }

/** Every business of the scanned areas, each once (two overlapping areas can list the same one), and the extra salons. */
export function rowsOf(scans: LeadScan[]): Row[] {
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const s of scans) {
    for (const shop of s.shops) {
      if (seen.has(shop.mapboxId)) continue
      seen.add(shop.mapboxId)
      rows.push({ type: 'shop', key: shop.mapboxId, shop, area: s.pincode })
    }
    for (const salon of s.clozestOnly) {
      const key = `salon:${salon.shopId ?? `${salon.name}@${salon.latitude},${salon.longitude}`}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ type: 'salon', key, salon, area: s.pincode })
    }
  }
  return rows
}

function clozestStatusOf(r: Row): ShopStatus | null {
  return r.type === 'salon' ? r.salon.status : (r.shop.clozest?.status ?? null)
}

function nameOf(r: Row): string {
  return r.type === 'salon' ? r.salon.name : r.shop.name
}

/** The rows the filters keep, in the chosen order. `me`: the signed-in person's id (for "Mine"). */
export function filterRows(rows: Row[], f: Filters, me: string): Row[] {
  const text = f.text.trim().toLowerCase()
  const out = rows.filter((r) => {
    const onClozest = clozestStatusOf(r) !== null
    if (f.clozest === 'ON' && (!onClozest || (f.clozestStatus && clozestStatusOf(r) !== f.clozestStatus))) return false
    if (f.clozest === 'OFF' && onClozest) return false
    if (f.pincode && r.area !== f.pincode) return false
    if (r.type === 'salon') {
      // A salon on its own has no lead, kind, phone or address: a filter on any of those leaves it out
      if (f.status || f.kind || f.chain || f.phoneOnly || f.mineOnly) return false
      return !text || r.salon.name.toLowerCase().includes(text)
    }
    const s = r.shop
    if (text && !`${s.name} ${s.address ?? ''} ${s.phone ?? ''}`.toLowerCase().includes(text)) return false
    if (f.status === 'SIGNED' && !s.lead?.signedUpAt) return false
    if (f.status && f.status !== 'SIGNED' && (s.lead?.status ?? 'NEW') !== f.status) return false
    if (f.kind && s.kind !== f.kind) return false
    if (f.chain === 'LOCAL' && s.chain) return false
    if (f.chain === 'CHAIN' && !s.chain) return false
    if (f.phoneOnly && !s.phone) return false
    if (f.mineOnly && s.lead?.assignedTo?.id !== me) return false
    return true
  })
  const score = (r: Row) => (r.type === 'shop' ? r.shop.score : -1)
  out.sort((a, b) =>
    f.sort === 'NAME'
      ? nameOf(a).localeCompare(nameOf(b))
      : f.sort === 'AREA'
        ? a.area.localeCompare(b.area) || score(b) - score(a)
        : score(b) - score(a) || nameOf(a).localeCompare(nameOf(b)),
  )
  return out
}

export interface Summary {
  businesses: number
  local: number
  withPhone: number
  onClozest: number
  high: number
  contacted: number
  signedUp: number
}

export function summarize(rows: Row[]): Summary {
  const sum: Summary = { businesses: 0, local: 0, withPhone: 0, onClozest: 0, high: 0, contacted: 0, signedUp: 0 }
  for (const r of rows) {
    if (r.type === 'salon') {
      sum.onClozest++
      continue
    }
    const s = r.shop
    sum.businesses++
    if (!s.chain) sum.local++
    if (s.phone) sum.withPhone++
    if (s.clozest) sum.onClozest++
    if (s.priority === 'HIGH') sum.high++
    if (s.lead && s.lead.status !== 'NEW' && s.lead.status !== 'NO_ANSWER') sum.contacted++
    if (s.lead?.signedUpAt) sum.signedUp++
  }
  return sum
}

export interface AreaRow {
  pincode: string
  places: string
  businesses: number
  local: number
  withPhone: number
  openAllWeek: number
  onClozest: number
  contacted: number
  /** Local businesses with a phone that nobody contacted and aren't on Clozest: who to call next. */
  toReach: number
}

/** Each scanned area's numbers, busiest first. */
export function areaRows(scans: LeadScan[]): AreaRow[] {
  return scans
    .map((s) => {
      const row: AreaRow = {
        pincode: s.pincode,
        places: s.places,
        businesses: 0,
        local: 0,
        withPhone: 0,
        openAllWeek: 0,
        onClozest: s.clozestOnly.length,
        contacted: 0,
        toReach: 0,
      }
      for (const shop of s.shops) {
        row.businesses++
        if (!shop.chain) row.local++
        if (shop.phone) row.withPhone++
        if (shop.hours && shop.hours.days >= 7) row.openAllWeek++
        if (shop.clozest) row.onClozest++
        // As the backend counts: no answer isn't contacted (it is still to reach)
        const contacted = shop.lead != null && shop.lead.status !== 'NEW' && shop.lead.status !== 'NO_ANSWER'
        if (contacted) row.contacted++
        if (!shop.chain && shop.phone && !contacted && !shop.clozest) row.toReach++
      }
      return row
    })
    .sort((a, b) => b.businesses - a.businesses || a.pincode.localeCompare(b.pincode))
}

/** Each kind and how many of it, most first. */
export function kindCounts(rows: Row[]): Array<{ kind: LeadKind; count: number }> {
  const counts = new Map<LeadKind, number>()
  for (const r of rows) if (r.type === 'shop') counts.set(r.shop.kind, (counts.get(r.shop.kind) ?? 0) + 1)
  return [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count)
}

/**
 * The areas matching what was typed in the area search: by pincode (digits) or place name, any word; at most 20,
 * those not chosen yet.
 */
export function matchAreas<T extends LeadArea>(areas: T[], typed: string, chosen: string[]): T[] {
  const q = typed.trim().toLowerCase()
  if (!q) return []
  const digits = /^\d+$/.test(q)
  return areas
    .filter((a) => !chosen.includes(a.pincode) && (digits ? a.pincode.startsWith(q) : a.places.toLowerCase().includes(q)))
    .slice(0, 20)
}

/** The areas the list shows: the chosen ones when any are chosen, else all. */
export function shownAreas<T extends LeadArea>(areas: T[], chosen: string[]): T[] {
  return chosen.length ? areas.filter((a) => chosen.includes(a.pincode)) : areas
}

/** What to save for a shop: the team's fields as edited, the business's details from the map, the version shown. */
export function leadIn(
  shop: Pick<LeadShop, 'name' | 'phone' | 'latitude' | 'longitude' | 'pincode' | 'onMapbox'>,
  lead: Lead | null,
  edit: { status: LeadStatus; note: string; assignedTo: string | null; followUpOn: string | null; whatsappOk: boolean },
): LeadIn {
  const mobile = shop.phone && /^[6-9]\d{9}$/.test(shop.phone) ? shop.phone : null
  const hasPoint = shop.onMapbox || (shop.latitude !== 0 && shop.longitude !== 0)
  return {
    status: edit.status,
    note: edit.note.trim(),
    assignedTo: edit.assignedTo,
    followUpOn: edit.followUpOn || null,
    whatsappOk: edit.whatsappOk && edit.status !== 'NEW' && mobile !== null,
    pincode: shop.pincode,
    name: shop.name || null,
    phone: mobile,
    latitude: hasPoint ? shop.latitude : null,
    longitude: hasPoint ? shop.longitude : null,
    version: lead?.version ?? null,
  }
}

/** A follow-up as the editor sees it (its saved details stand in for the map's). */
export function dueAsShop(d: LeadDue): Pick<LeadShop, 'name' | 'phone' | 'latitude' | 'longitude' | 'pincode' | 'onMapbox'> {
  return { name: d.name ?? '', phone: d.phone, latitude: d.latitude ?? 0, longitude: d.longitude ?? 0, pincode: d.pincode, onMapbox: false }
}

/** "10:00–20:00 · 7 days", or null. */
export function hoursText(h: LeadShop['hours']): string | null {
  if (!h) return null
  const t = (x: string) => `${x.slice(0, 2)}:${x.slice(2)}`
  return `${t(h.opens)}–${t(h.closes)} · ${h.days} day${h.days === 1 ? '' : 's'}`
}

/** "12,345" in Indian grouping. */
export function count(n: number): string {
  return n.toLocaleString('en-IN')
}

/** Tab-separated rows for pasting into a sheet (the team's own call list). */
export function copyText(rows: Row[], places: Record<string, string>): string {
  const head = ['Business', 'Kind', 'Local/Chain', 'Pincode', 'Area', 'Phone', 'Address', 'Priority', 'On Clozest', 'Status', 'Assigned to', 'Follow-up', 'Note']
  const clean = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')
  const lines = rows.map((r) => {
    if (r.type === 'salon') return [r.salon.name, '', '', r.area, places[r.area] ?? '', '', '', '', r.salon.status, '', '', '', ''].map(clean).join('\t')
    const s = r.shop
    return [
      s.name,
      KIND_LABELS[s.kind],
      s.chain ? 'Chain' : 'Local',
      r.area,
      places[r.area] ?? '',
      s.phone,
      s.address,
      PRIORITY_LABELS[s.priority],
      s.clozest?.status ?? '',
      s.lead?.signedUpAt ? 'Signed up' : LEAD_STATUS_LABELS[s.lead?.status ?? 'NEW'],
      s.lead?.assignedTo?.name ?? '',
      s.lead?.followUpOn ?? '',
      s.lead?.note ?? '',
    ]
      .map(clean)
      .join('\t')
  })
  return [head.join('\t'), ...lines].join('\n')
}
