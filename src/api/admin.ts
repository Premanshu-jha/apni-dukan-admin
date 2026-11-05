import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './client'
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
} from './types'
import type { Decision } from '../lib/rules'

const A = '/api/v1/admin'

/** Every admin call, one line each, as the contract names them. */
export const adminApi = {
  me: () => api<AdminMe>('GET', `${A}/me`),
  dashboard: () => api<Dashboard>('GET', `${A}/dashboard`),
  shops: (type: ShopType, group: ShopGroup, q: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ type, group })
    if (q.trim()) params.set('q', q.trim())
    return api<AdminShop[]>('GET', `${A}/shops?${params}`, { signal })
  },
  shop: (id: string) => api<ShopDetail>('GET', `${A}/shops/${encodeURIComponent(id)}`),
  decide: (id: string, decision: Decision, body: DecisionIn) =>
    api<AdminShop>('POST', `${A}/shops/${encodeURIComponent(id)}/${decision}`, { body }),
  addNote: (id: string, note: string) =>
    api<TimelineEntry>('POST', `${A}/shops/${encodeURIComponent(id)}/notes`, { body: { note } }),

  lookupStrikes: (phone: string) => api<StrikeLookup>('POST', `${A}/salon/strikes/lookup`, { body: { phone } }),
  removeStrike: (appointmentId: string, reason: string) =>
    api<void>('POST', `${A}/salon/strikes/${encodeURIComponent(appointmentId)}/remove`, { body: { reason } }),

  team: () => api<TeamMember[]>('GET', `${A}/team`),
  addMember: (phone: string) => api<TeamMember>('POST', `${A}/team`, { body: { phone } }),
  removeMember: (userId: string) => api<void>('DELETE', `${A}/team/${encodeURIComponent(userId)}`),

  testMode: () => api<TestModeState>('GET', `${A}/test-mode`),
  testModeOn: (hours: number) => api<TestModeState>('PUT', `${A}/test-mode`, { body: { hours } }),
  testModeOff: () => api<TestModeState>('DELETE', `${A}/test-mode`),
  addTestPhone: (phone: string, label: string) =>
    api<TestModeState>('POST', `${A}/test-mode/phones`, { body: { phone, label } }),
  removeTestPhone: (phone: string) => api<TestModeState>('DELETE', `${A}/test-mode/phones/${encodeURIComponent(phone)}`),
}

export const keys = {
  all: ['admin'] as const,
  me: ['admin', 'me'] as const,
  dashboard: ['admin', 'dashboard'] as const,
  shops: ['admin', 'shops'] as const,
  shopList: (type: ShopType, group: ShopGroup, q: string) => ['admin', 'shops', type, group, q.trim()] as const,
  shop: (id: string) => ['admin', 'shop', id] as const,
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

export function useShopList(type: ShopType, group: ShopGroup, q: string) {
  return useQuery({
    queryKey: keys.shopList(type, group, q),
    queryFn: ({ signal }) => adminApi.shops(type, group, q, signal),
    // Keep the last answer on screen while a new search is on its way.
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}

/** A shop's page. Its photo links last a few minutes, so it is re-read every 4 minutes while open. */
export function useShopDetail(id: string) {
  return useQuery({ queryKey: keys.shop(id), queryFn: () => adminApi.shop(id), refetchInterval: 4 * 60_000 })
}

export function useTeam() {
  return useQuery({ queryKey: keys.team, queryFn: adminApi.team })
}

export function useTestMode() {
  return useQuery({ queryKey: keys.testMode, queryFn: adminApi.testMode })
}
