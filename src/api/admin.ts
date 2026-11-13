import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './errors'
import type {
  AddressIn,
  AdminMe,
  AdminShop,
  Covered,
  Dashboard,
  DecisionIn,
  MemberIn,
  Moved,
  ShopDetail,
  ShopGroup,
  ShopType,
  StrikeLookup,
  TeamMember,
  TestModeState,
  TicketCounts,
  TicketDetail,
  TicketStats,
  TicketSummary,
  TicketView,
  TimelineEntry,
  TimelineNext,
  TimelinePage,
} from './types'
import type { Decision } from '../lib/rules'

const A = '/api/v1/admin'

/** Which businesses a super admin's list shows: all, those nobody is assigned, or one agent's (their id). */
export type ShopFilter = 'ALL' | 'UNASSIGNED' | (string & {})

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
    // OWN_SHOP is about this shop, not this person's role: nothing to re-read
    if (e instanceof ApiError && (e.status === 403 || e.status === 404) && e.code !== 'OWN_SHOP') onRoleDoubt()
    throw e
  }
}

/** Every admin call, one line each, as the contract names them. */
export const adminApi = {
  me: () => api<AdminMe>('GET', `${A}/me`),
  dashboard: () => api<Dashboard>('GET', `${A}/dashboard`),
  /**
   * One page of a group's shops; `after` is the last shop of the page before (null: the first page). `who` (super
   * admins): UNASSIGNED for those waiting with no agent, or an agent's id; a field agent always gets their own.
   */
  shops: (type: ShopType, group: ShopGroup, q: string, after: AdminShop | null, signal?: AbortSignal, who: ShopFilter = 'ALL') => {
    const params = new URLSearchParams({ type, group })
    if (q.trim()) params.set('q', q.trim())
    if (who === 'UNASSIGNED') params.set('unassigned', 'true')
    else if (who !== 'ALL') params.set('assignedTo', who)
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
  /** Super admins: live salons with a new registration document to check, oldest change first (at most 100). */
  documentsToCheck: () => api<AdminShop[]>('GET', `${A}/shops/documents-to-check`),
  /** The document was checked: customers see "Registered". */
  checkDocument: (id: string, version: number) =>
    write<AdminShop>('POST', `${A}/shops/${encodeURIComponent(id)}/registration-document/check`, { version }),
  /** Take a wrong or expired document off the salon, with the reason the owner is told. */
  removeDocument: (id: string, version: number, reason: string) =>
    write<AdminShop>('POST', `${A}/shops/${encodeURIComponent(id)}/registration-document/remove`, { version, reason }),
  /** Refuse the owner's waiting address change request, with the reason he is told (Approve applies it instead). */
  declineAddressRequest: (id: string, version: number, reason: string) =>
    write<AdminShop>('POST', `${A}/shops/${encodeURIComponent(id)}/address-request/decline`, { version, reason }),
  /** Set the business's address and pin (no re-check: the field team checked it); the owner is told. */
  changeAddress: (id: string, version: number, address: AddressIn) =>
    write<AdminShop>('PATCH', `${A}/shops/${encodeURIComponent(id)}/address`, { version, ...address }),
  addNote: (id: string, note: string) =>
    write<TimelineEntry>('POST', `${A}/shops/${encodeURIComponent(id)}/notes`, { note }),
  /** Super admins: give a business waiting for a visit to this field agent. */
  assign: (id: string, adminId: string) => write<void>('POST', `${A}/shops/${encodeURIComponent(id)}/assign`, { adminId }),
  /** Super admins: every business waiting for one agent's visit goes to another (leave). */
  moveAll: (fromAdminId: string, toAdminId: string) => write<Moved>('POST', `${A}/assignments/move`, { fromAdminId, toAdminId }),

  lookupStrikes: (phone: string) => write<StrikeLookup>('POST', `${A}/salon/strikes/lookup`, { phone }),
  removeStrike: (appointmentId: string, reason: string) =>
    write<void>('POST', `${A}/salon/strikes/${encodeURIComponent(appointmentId)}/remove`, { reason }),

  /** A page of tickets, newest activity first; `after` is the previous page's last row (null: the first page). */
  tickets: (view: TicketView, assignee: string | null, after: TicketSummary | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ view })
    if (assignee) params.set('assignee', assignee)
    if (after) {
      // Exactly as received: the backend reads the instant back to the microsecond
      params.set('before', after.lastMessageAt)
      params.set('beforeId', after.id)
    }
    return api<TicketSummary[]>('GET', `${A}/tickets?${params}`, { signal })
  },
  /** Tickets by a number (CLZ-1042), mobile number or email (`q`), or one account's (`requester`). */
  searchTickets: (q: string | null, requester: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (requester) params.set('requester', requester)
    return api<TicketSummary[]>('GET', `${A}/tickets/search?${params}`, { signal })
  },
  /** Super admins: every open ticket of one person to another (null: shared out by the rule). */
  moveTickets: (fromUserId: string, toUserId: string | null) =>
    /** `stayed`: open ones nobody else could take (their own question, or nobody else in support). */
    write<{ moved: number; stayed: number }>('POST', `${A}/tickets/move`, { fromUserId, toUserId }),
  /** A resolved ticket opens again; nobody is emailed. */
  reopenTicket: (id: string, version: number) =>
    write<TicketDetail>('POST', `${A}/tickets/${encodeURIComponent(id)}/reopen`, { version }),
  ticketCounts: () => api<TicketCounts>('GET', `${A}/tickets/counts`),
  ticketStats: () => api<TicketStats>('GET', `${A}/tickets/stats`),
  ticket: (id: string) => api<TicketDetail>('GET', `${A}/tickets/${encodeURIComponent(id)}`),
  /** Emails the answer to them; `resolve` also resolves the ticket. */
  replyTicket: (id: string, seenSeq: number, body: string, resolve: boolean) =>
    write<TicketDetail>('POST', `${A}/tickets/${encodeURIComponent(id)}/reply`, { seenSeq, body, resolve }),
  /** Resolves without emailing anyone. */
  closeTicket: (id: string, seenSeq: number) =>
    write<TicketDetail>('POST', `${A}/tickets/${encodeURIComponent(id)}/close`, { seenSeq }),
  /** Super admins: give it to someone else (null = Unassigned). */
  assignTicket: (id: string, version: number, assigneeId: string | null) =>
    write<TicketDetail>('POST', `${A}/tickets/${encodeURIComponent(id)}/assign`, { version, assigneeId }),

  team: () => api<TeamMember[]>('GET', `${A}/team`),
  coverage: () => api<Covered[]>('GET', `${A}/team/coverage`),
  addMember: (member: MemberIn) => write<TeamMember>('POST', `${A}/team`, member),
  editMember: (userId: string, version: number, member: MemberIn) =>
    write<TeamMember>('PUT', `${A}/team/${encodeURIComponent(userId)}`, { version, ...member }),
  removeMember: (userId: string) => write<void>('DELETE', `${A}/team/${encodeURIComponent(userId)}`),

  testMode: () => api<TestModeState>('GET', `${A}/test-mode`),
  testModeOn: (hours: number) => write<TestModeState>('PUT', `${A}/test-mode`, { hours }),
  testModeOff: () => write<TestModeState>('DELETE', `${A}/test-mode`),
  addTestPhone: (phone: string, label: string) =>
    write<TestModeState>('POST', `${A}/test-mode/phones`, { phone, label }),
  removeTestPhone: (phone: string) => write<TestModeState>('DELETE', `${A}/test-mode/phones/${encodeURIComponent(phone)}`),
  addTestEmail: (email: string, label: string) =>
    write<TestModeState>('POST', `${A}/test-mode/emails`, { email, label }),
  removeTestEmail: (email: string) => write<TestModeState>('DELETE', `${A}/test-mode/emails/${encodeURIComponent(email)}`),
}

export const keys = {
  all: ['admin'] as const,
  me: ['admin', 'me'] as const,
  dashboard: ['admin', 'dashboard'] as const,
  shops: ['admin', 'shops'] as const,
  shopList: (type: ShopType, group: ShopGroup, q: string, who: ShopFilter = 'ALL') =>
    ['admin', 'shops', type, group, q.trim(), who] as const,
  shop: (id: string) => ['admin', 'shop', id] as const,
  /** Every shop page at once (an assignment or a Team change may change who visits any of them). */
  shopPages: ['admin', 'shop'] as const,
  /** Outside ['admin', 'shop', id]: refreshing the shop page doesn't ask the earlier entries again. */
  timeline: (id: string, start: TimelineNext | null) =>
    ['admin', 'timeline', id, start?.afterAt ?? null, start?.afterSeq ?? null] as const,
  team: ['admin', 'team'] as const,
  coverage: ['admin', 'team', 'coverage'] as const,
  testMode: ['admin', 'test-mode'] as const,
  documentsToCheck: ['admin', 'shops', 'documents-to-check'] as const,
  tickets: ['admin', 'tickets'] as const,
  ticketList: (view: TicketView, assignee: string | null) => ['admin', 'tickets', 'list', view, assignee] as const,
  ticketCounts: ['admin', 'tickets', 'counts'] as const,
  ticketSearch: (q: string, requester: string | null) => ['admin', 'tickets', 'search', q, requester] as const,
  ticketStats: ['admin', 'tickets', 'stats'] as const,
  ticket: (id: string) => ['admin', 'tickets', 'one', id] as const,
}

/**
 * How often the dashboard, the document list and the shop lists are read again while the tab is in front (and at
 * once when it comes back), so a salon or document that arrives while one sits open shows up without a reload.
 */
export const LIST_REFRESH_MS = 30_000

/** Pages of a shop list kept fresh on the timer: beyond this, re-reading every loaded page each time costs too much. */
const REFRESHED_PAGES = 2

export function useDocumentsToCheck(enabled: boolean) {
  return useQuery({ queryKey: keys.documentsToCheck, queryFn: adminApi.documentsToCheck, enabled, staleTime: 10_000, refetchInterval: LIST_REFRESH_MS })
}

/** Who is signed in and whether test mode is on. Re-read every minute and on focus, so the banner stays true. */
export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: adminApi.me, refetchInterval: 60_000, staleTime: 15_000 })
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard, queryFn: adminApi.dashboard, staleTime: 10_000, refetchInterval: LIST_REFRESH_MS })
}

/** Shops per page from the backend (ShopReviewStore.PAGE); a shorter page is the last one. */
export const SHOPS_PAGE = 50

/**
 * A group's shops, longest waiting first, a page at a time. The next page starts after the last shop's statusSince
 * and id (keyset paging), so a group with thousands of shops is never loaded at once. A new search, group or type
 * is a new key: it starts again from the first page.
 */
export function useShopList(type: ShopType, group: ShopGroup, q: string, who: ShopFilter = 'ALL') {
  return useInfiniteQuery({
    queryKey: keys.shopList(type, group, q, who),
    initialPageParam: null as AdminShop | null,
    queryFn: ({ pageParam, signal }) => adminApi.shops(type, group, q, pageParam, signal, who),
    getNextPageParam: (last: AdminShop[]) => (last.length < SHOPS_PAGE ? undefined : last[last.length - 1]),
    // Keep the last answer on screen while a new search is on its way.
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    // Every loaded page is read again each time, so only while one or two are loaded (a long scroll still refreshes
    // when the tab comes back)
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 0) <= REFRESHED_PAGES ? LIST_REFRESH_MS : false),
  })
}

/**
 * A shop's page. Its photo links last a few minutes, so it is re-read every 4 minutes while open (not every 30
 * seconds like the lists: each read signs new links, so the photos would load again and a playing video restart).
 */
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

/** The team (super admins only), or nothing while `enabled` is false (a field agent never asks). */
export function useTeam(enabled = true) {
  return useQuery({ queryKey: keys.team, queryFn: adminApi.team, enabled })
}

export function useCoverage() {
  return useQuery({ queryKey: keys.coverage, queryFn: adminApi.coverage })
}

export function useTestMode() {
  return useQuery({ queryKey: keys.testMode, queryFn: adminApi.testMode })
}

/** Tickets per page from the backend (TicketService.PAGE); a shorter page is the last one. */
export const TICKETS_PAGE = 50

/** A ticket list, newest activity first, a page at a time; refreshed every 30 seconds while in front. */
export function useTicketList(view: TicketView, assignee: string | null) {
  return useInfiniteQuery({
    queryKey: keys.ticketList(view, assignee),
    initialPageParam: null as TicketSummary | null,
    queryFn: ({ pageParam, signal }) => adminApi.tickets(view, assignee, pageParam, signal),
    getNextPageParam: (last: TicketSummary[]) => (last.length < TICKETS_PAGE ? undefined : last[last.length - 1]),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 0) <= REFRESHED_PAGES ? LIST_REFRESH_MS : false),
  })
}

/** The menu badge: my tickets waiting on us (and Unassigned for super admins). */
export function useTicketCounts(enabled: boolean) {
  return useQuery({ queryKey: keys.ticketCounts, queryFn: adminApi.ticketCounts, enabled, staleTime: 10_000, refetchInterval: LIST_REFRESH_MS })
}

export function useTicketStats(enabled: boolean) {
  return useQuery({ queryKey: keys.ticketStats, queryFn: adminApi.ticketStats, enabled, staleTime: 10_000, refetchInterval: LIST_REFRESH_MS })
}

/** A ticket, re-read every 30 seconds while open, so a new message from them shows up. */
export function useTicket(id: string) {
  return useQuery({ queryKey: keys.ticket(id), queryFn: () => adminApi.ticket(id), refetchInterval: LIST_REFRESH_MS })
}

/** A search (or one person's tickets): asked only once something is typed or chosen. */
export function useTicketSearch(q: string, requester: string | null) {
  return useQuery({
    queryKey: keys.ticketSearch(q, requester),
    queryFn: ({ signal }) => adminApi.searchTickets(q || null, requester, signal),
    enabled: q.length > 0 || requester !== null,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  })
}

