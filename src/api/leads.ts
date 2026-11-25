import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './errors'
import type { Lead, LeadAreas, LeadDistrict, LeadDue, LeadEvent, LeadFunnel, LeadIn, LeadScan, LeadUsage } from './types'

const L = '/api/v1/admin/leads'

/** The Leads page's calls (field agents and super admins), as the backend's AdminLeadsController names them. */
export const leadsApi = {
  districts: (q: string, signal?: AbortSignal) => api<LeadDistrict[]>('GET', `${L}/districts?${new URLSearchParams({ q })}`, { signal }),
  areas: (district: string, state: string) => api<LeadAreas>('GET', `${L}/areas?${new URLSearchParams({ district, state })}`),
  /** Searches one area live on the map (paid Mapbox requests: only on a press, never prefetched). */
  scan: (pincode: string, signal?: AbortSignal) => api<LeadScan>('POST', `${L}/scan/${encodeURIComponent(pincode)}`, { signal }),
  save: (mapboxId: string, body: LeadIn) => api<Lead>('PUT', `${L}/${encodeURIComponent(mapboxId)}`, { body }),
  history: (mapboxId: string) => api<LeadEvent[]>('GET', `${L}/${encodeURIComponent(mapboxId)}/history`),
  due: (everyone: boolean) => api<LeadDue[]>('GET', `${L}/due${everyone ? '?everyone=true' : ''}`),
  /** The leads given to you that were tried and haven't signed up (saved details: no map search). */
  mine: (everyone: boolean) => api<LeadDue[]>('GET', `${L}/mine${everyone ? '?everyone=true' : ''}`),
  funnel: (district: string, state: string) => api<LeadFunnel>('GET', `${L}/funnel?${new URLSearchParams({ district, state })}`),
  usage: () => api<LeadUsage>('GET', `${L}/usage`),
}

export const leadKeys = {
  all: ['admin', 'leads'] as const,
  districts: (q: string) => ['admin', 'leads', 'districts', q] as const,
  areas: (district: string, state: string) => ['admin', 'leads', 'areas', district, state] as const,
  history: (id: string) => ['admin', 'leads', 'history', id] as const,
  due: (everyone: boolean) => ['admin', 'leads', 'due', everyone] as const,
  mine: (everyone: boolean) => ['admin', 'leads', 'mine', everyone] as const,
  funnel: (district: string, state: string) => ['admin', 'leads', 'funnel', district, state] as const,
  usage: ['admin', 'leads', 'usage'] as const,
}

/** Districts for what was typed (from 2 characters), kept a while: the list never changes. */
export function useDistricts(q: string) {
  const typed = q.trim()
  return useQuery({
    queryKey: leadKeys.districts(typed.toLowerCase()),
    queryFn: ({ signal }) => leadsApi.districts(typed, signal),
    enabled: typed.length >= 2,
    staleTime: 60 * 60_000,
  })
}

export function useAreas(district: string, state: string) {
  return useQuery({ queryKey: leadKeys.areas(district, state), queryFn: () => leadsApi.areas(district, state), staleTime: 60_000 })
}

export function useLeadHistory(mapboxId: string, enabled: boolean) {
  return useQuery({ queryKey: leadKeys.history(mapboxId), queryFn: () => leadsApi.history(mapboxId), enabled })
}

/** Follow-ups due; refreshed every 5 minutes while in front (someone may add one for you). */
export function useDue(everyone: boolean) {
  return useQuery({ queryKey: leadKeys.due(everyone), queryFn: () => leadsApi.due(everyone), staleTime: 30_000, refetchInterval: 5 * 60_000 })
}

export function useMine(everyone: boolean, enabled: boolean) {
  return useQuery({ queryKey: leadKeys.mine(everyone), queryFn: () => leadsApi.mine(everyone), enabled, staleTime: 30_000 })
}

export function useFunnel(district: string, state: string, enabled: boolean) {
  return useQuery({ queryKey: leadKeys.funnel(district, state), queryFn: () => leadsApi.funnel(district, state), enabled, staleTime: 60_000 })
}

export function useUsage() {
  return useQuery({ queryKey: leadKeys.usage, queryFn: leadsApi.usage, staleTime: 60_000 })
}

/** What to tell the person when a scan fails, by the backend's code; `stop`: no point scanning the other areas. */
export function scanProblem(e: unknown): { message: string; stop: boolean; retryAfter?: number } {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'MAPBOX_OFF':
        return { message: "Searching the map isn't set up yet. Ask a super admin to add the Mapbox key.", stop: true }
      case 'MAPBOX_REFUSED':
        return { message: 'Mapbox refused our key. Ask a super admin to check the Mapbox key.', stop: true }
      case 'MAPBOX_UNAVAILABLE':
        return { message: "The map isn't answering right now. This area is tried again in a minute.", stop: false, retryAfter: e.retryAfterSeconds ?? 60 }
      case 'MAPBOX_CAP_REACHED':
        return { message: "This month's map searches are used up. Ask a super admin to raise the monthly limit.", stop: true }
      case 'TOO_MANY_REQUESTS': {
        const minutes = e.retryAfterSeconds ? Math.max(1, Math.ceil(e.retryAfterSeconds / 60)) : null
        return { message: `You have searched many areas this hour. ${minutes ? `Search again in ${minutes} minute${minutes === 1 ? '' : 's'}.` : 'Wait a while, then search again.'}`, stop: true }
      }
      case 'SCAN_BUSY':
        return { message: 'Many areas are being searched right now.', stop: false, retryAfter: e.retryAfterSeconds ?? 5 }
      case 'AREA_NOT_ON_MAP':
        return { message: "This pincode isn't on the map, so it can't be searched.", stop: false }
      case 'AREA_NOT_FOUND':
        return { message: "This pincode isn't in India Post's list.", stop: false }
    }
    if (e.status === 401) return { message: 'You were signed out. Sign in again to search.', stop: true }
    if (e.status === 404 || e.status === 403) return { message: "You can't search leads any more. Reload the page.", stop: true }
  }
  return { message: "Couldn't search this area (no connection?). Try it again.", stop: false }
}
