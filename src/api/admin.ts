import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './errors'
import type {
  AdminMe,
  AdminShop,
  Dashboard,
  DecisionIn,
  ShopDetail,
  ShopGroup,
  ShopType,
  StrikeLookup,
  TeamMember,
  TestModeState,
  TimelineEntry,
  TimelineNext,
  TimelinePage,
} from './types'
import type { Decision } from '../lib/rules'

const A = '/api/v1/admin'

/** Called when a write is refused with 403 or 404: maybe this person's role changed. Set by the app. */
let onRoleDoubt: () => void = () => {}
export function whenRoleMayHaveChanged(fn: () => void) {
  onRoleDoubt = fn
}

/**
 * Every admin write goes through here (the screens call adminApi directly, not useMutation). A 403 (not an admin,
 * SUPER_ADMIN_ONLY) or 404 (taken off the team, or a missing shop) re-reads /admin/me at once, so the guards move
 * the person on; the error still goes to the screen.
 */
async function write<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await api<T>(method, path, body === undefined ? {} : { body })
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) onRoleDoubt()
    throw e
  }
}

/** Every admin call, one line each, as the contract names them. */
export const adminApi = {
  me: () => api<AdminMe>('GET', `${A}/me`),
  dashboard: () => api<Dashboard>('GET', `${A}/dashboard`),
  /** One page of a group's shops; `after` is the last shop of the page before (null: the first page). */
  shops: (type: ShopType, group: ShopGroup, q: string, after: AdminShop | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ type, group })
    if (q.trim()) params.set('q', q.trim())
    if (after) {
      // Exactly as received: the backend reads the instant back to the microsecond
      params.set('afterSince', after.statusSince)
      params.set('afterId', after.id)
    }
    return api<AdminShop[]>('GET', `${A}/shops?${params}`, { signal })
  },
  shop: (id: string) => api<ShopDetail>('GET', `${A}/shops/${encodeURIComponent(id)}`),
  /** The timeline entries after `after` (the shop page's `timelineNext`, or a page's `next`), exactly as received. */
  timeline: (id: string, after: TimelineNext, signal?: AbortSignal) =>
    api<TimelinePage>(
      'GET',
      `${A}/shops/${encodeURIComponent(id)}/timeline?${new URLSearchParams({ afterAt: after.afterAt, afterSeq: String(after.afterSeq) })}`,
      { signal },
    ),
  decide: (id: string, decision: Decision, body: DecisionIn) =>
    write<AdminShop>('POST', `${A}/shops/${encodeURIComponent(id)}/${decision}`, body),
  addNote: (id: string, note: string) =>
    write<TimelineEntry>('POST', `${A}/shops/${encodeURIComponent(id)}/notes`, { note }),

  lookupStrikes: (phone: string) => write<StrikeLookup>('POST', `${A}/salon/strikes/lookup`, { phone }),
  removeStrike: (appointmentId: string, reason: string) =>
    write<void>('POST', `${A}/salon/strikes/${encodeURIComponent(appointmentId)}/remove`, { reason }),

  team: () => api<TeamMember[]>('GET', `${A}/team`),
  addMember: (phone: string) => write<TeamMember>('POST', `${A}/team`, { phone }),
  removeMember: (userId: string) => write<void>('DELETE', `${A}/team/${encodeURIComponent(userId)}`),

  testMode: () => api<TestModeState>('GET', `${A}/test-mode`),
  testModeOn: (hours: number) => write<TestModeState>('PUT', `${A}/test-mode`, { hours }),
  testModeOff: () => write<TestModeState>('DELETE', `${A}/test-mode`),
  addTestPhone: (phone: string, label: string) =>
    write<TestModeState>('POST', `${A}/test-mode/phones`, { phone, label }),
  removeTestPhone: (phone: string) => write<TestModeState>('DELETE', `${A}/test-mode/phones/${encodeURIComponent(phone)}`),
}

export const keys = {
  all: ['admin'] as const,
  me: ['admin', 'me'] as const,
  dashboard: ['admin', 'dashboard'] as const,
  shops: ['admin', 'shops'] as const,
  shopList: (type: ShopType, group: ShopGroup, q: string) => ['admin', 'shops', type, group, q.trim()] as const,
  shop: (id: string) => ['admin', 'shop', id] as const,
  /** Outside ['admin', 'shop', id]: refreshing the shop page doesn't ask the earlier entries again. */
  timeline: (id: string, start: TimelineNext | null) =>
    ['admin', 'timeline', id, start?.afterAt ?? null, start?.afterSeq ?? null] as const,
  team: ['admin', 'team'] as const,
  testMode: ['admin', 'test-mode'] as const,
}

/** Who is signed in and whether test mode is on. Re-read every minute and on focus, so the banner stays true. */
export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: adminApi.me, refetchInterval: 60_000, staleTime: 15_000 })
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard, queryFn: adminApi.dashboard, staleTime: 10_000 })
}

/** Shops per page from the backend (ShopReviewStore.PAGE); a shorter page is the last one. */
export const SHOPS_PAGE = 50

/**
 * A group's shops, longest waiting first, a page at a time. The next page starts after the last shop's statusSince
 * and id (keyset paging), so a group with thousands of shops is never loaded at once. A new search, group or type
 * is a new key: it starts again from the first page.
 */
export function useShopList(type: ShopType, group: ShopGroup, q: string) {
  return useInfiniteQuery({
    queryKey: keys.shopList(type, group, q),
    initialPageParam: null as AdminShop | null,
    queryFn: ({ pageParam, signal }) => adminApi.shops(type, group, q, pageParam, signal),
    getNextPageParam: (last: AdminShop[]) => (last.length < SHOPS_PAGE ? undefined : last[last.length - 1]),
    // Keep the last answer on screen while a new search is on its way.
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}

/** A shop's page. Its photo links last a few minutes, so it is re-read every 4 minutes while open. */
export function useShopDetail(id: string) {
  return useQuery({ queryKey: keys.shop(id), queryFn: () => adminApi.shop(id), refetchInterval: 4 * 60_000 })
}

/**
 * A shop's earlier timeline entries, 50 a page, after the shop page's first 50 (`start` = its `timelineNext`). Asked
 * only once "Show earlier entries" is tapped (`enabled`). Keyed by `start`: when new entries push the first 50 down
 * (a note, a decision), the shop page's `timelineNext` changes and the earlier entries start again from there, so
 * nothing is missing between the two or shown twice. Old entries don't change, so loaded pages are never asked again
 * (no refetch on focus); the memory grows only with the admin's taps.
 */
export function useEarlierTimeline(id: string, start: TimelineNext | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: keys.timeline(id, start),
    initialPageParam: start,
    queryFn: ({ pageParam, signal }) => adminApi.timeline(id, pageParam!, signal),
    getNextPageParam: (last: TimelinePage) => last.next ?? undefined,
    enabled: enabled && start !== null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useTeam() {
  return useQuery({ queryKey: keys.team, queryFn: adminApi.team })
}

export function useTestMode() {
  return useQuery({ queryKey: keys.testMode, queryFn: adminApi.testMode })
}
