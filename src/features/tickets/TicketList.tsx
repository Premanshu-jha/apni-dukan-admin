import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { adminApi, useAway, useTicketList, useTicketSearch, useTicketStats } from '../../api/admin'
import { explain, isNetwork } from '../../api/errors'
import type { TicketSummary, TicketView } from '../../api/types'
import { useAdmin } from '../../app/guards'
import { Banner, Button, Card, Chip, EmptyState, ErrorState, Field, Loading, Page, Pill } from '../../components/ui'
import { useDebounced } from '../../lib/useDebounced'
import { isSuperAdmin, isSupport } from '../../lib/roles'
import { MarkAway } from '../team/MarkAway'
import { howLong } from '../../lib/time'
import { useNow } from '../../lib/useNow'
import { isTicketView, SOURCE_LABELS, STATUS_LABELS, STATUS_TONES, VIEW_LABELS } from './labels'

const VIEWS: TicketView[] = ['OPEN', 'WAITING', 'RESOLVED']

/**
 * /tickets: a support person's own tickets (waiting on us first, then waiting on them, then resolved). A super
 * admin sees everyone's, can show Unassigned or one person's (?who=), and the counts per person on top.
 * The view, the person and the search are in the address, so Back from a ticket comes back to the same list. A
 * search box finds a ticket by its number, a mobile number or an email (?q=); ?requester= lists one person's tickets
 * ("N other tickets from them"; a support person sees only their own).
 */
export function TicketList() {
  const me = useAdmin()
  const superAdmin = isSuperAdmin(me.adminRole)
  const [params, setParams] = useSearchParams()
  const asked = params.get('view')
  const view: TicketView = isTicketView(asked) && (asked !== 'UNASSIGNED' || superAdmin) ? asked : 'OPEN'
  const who = superAdmin ? params.get('who') : null
  const list = useTicketList(view, view === 'UNASSIGNED' ? null : who)
  const stats = useTicketStats(superAdmin)
  const now = useNow(60_000)
  const rows = list.data?.pages.flat() ?? []
  const whoName = who ? stats.data?.people.find((p) => p.userId === who)?.name ?? 'One person' : null
  const requester = params.get('requester')
  const [text, setText] = useState(params.get('q') ?? '')
  const typed = useDebounced(text.trim(), 400)
  // Only what the backend can find: a ticket number, a full mobile number, an email (not a half-typed number or a name)
  const findable = isFindable(typed)
  const q = findable ? typed : ''
  const searching = q.length > 0 || requester !== null
  const found = useTicketSearch(q, requester)

  // The search is in the address (replacing it): Back from a ticket comes back to the same results. Only a change of
  // what was typed writes it; the address changing by itself (the Tickets tab, a link) empties or fills the box.
  const written = useRef(params.get('q') ?? '')
  const inAddress = params.get('q') ?? ''
  useEffect(() => {
    if (typed === written.current) return
    written.current = typed
    setParams((now) => {
      const p = new URLSearchParams(now)
      if (typed) {
        p.set('q', typed)
        p.delete('requester')   // a new search leaves "one person's tickets"
      } else p.delete('q')
      return p
    }, { replace: true })
  }, [typed, setParams])
  useEffect(() => {
    if (inAddress === written.current) return
    written.current = inAddress
    setText(inAddress)
  }, [inAddress])

  function go(next: { view?: TicketView; who?: string | null }) {
    const p = new URLSearchParams(params)
    if (next.view) p.set('view', next.view)
    if (next.who !== undefined) {
      if (next.who) p.set('who', next.who)
      else p.delete('who')
    }
    setParams(p, { replace: true })
  }

  return (
    <Page title={superAdmin ? 'Support tickets' : 'My tickets'}>
      {isSupport(me.adminRole, me.designation) && <SelfAway />}
      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <Field
          id="ticket-search"
          label="Find a ticket"
          placeholder="CLZ-1042, a mobile number or an email"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {typed && !findable && (
          <p className="pt-1 text-sm text-muted">
            Type a ticket number (CLZ-1042), a full 10-digit mobile number or an email. Names can't be searched.
          </p>
        )}
      </form>
      {searching ? (
        <section aria-label="Search results" className="flex flex-col gap-2">
          {requester && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="[overflow-wrap:anywhere]">
                Every ticket from {found.data?.[0]?.requester ?? 'this person'}
                {superAdmin ? '' : ' that is yours'}.
              </span>
              <button type="button" className="min-h-9 text-link underline" onClick={() => {
                const p = new URLSearchParams(params)
                p.delete('requester')
                setParams(p, { replace: true })
              }}>
                Back to the list
              </button>
            </p>
          )}
          {found.isPending ? (
            <Loading />
          ) : found.isError && !found.data ? (
            <Banner tone="bad">{explain(found.error)}</Banner>
          ) : (found.data ?? []).length === 0 ? (
            <EmptyState title="No tickets found" body={superAdmin ? 'Check the number, mobile or email.' : 'Only your own tickets are searched.'} />
          ) : (
            <ul className={`flex flex-col gap-2 ${found.isPlaceholderData ? 'opacity-50' : ''}`}>
              {found.data!.map((t) => (
                <li key={t.id}>
                  <Row t={t} now={now} showAssignee={superAdmin} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
      <>
      {superAdmin && stats.data && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">By person</h2>
          {stats.data.people.length === 0 ? (
            <p className="text-sm text-muted">Nobody is in support yet. Add a support person on the Team page; until then tickets wait in Unassigned.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 font-medium">Person</th>
                  <th className="py-1 text-right font-medium">Waiting on us</th>
                  <th className="py-1 text-right font-medium">Waiting on them</th>
                  <th className="py-1 text-right font-medium">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {stats.data.people.map((p) => (
                  <tr key={p.userId} className="border-t border-line">
                    <td className="py-1">
                      <button type="button" className="min-h-9 text-left text-link underline [overflow-wrap:anywhere]" onClick={() => go({ who: p.userId, view: view === 'UNASSIGNED' ? 'OPEN' : view })}>
                        {p.name}
                      </button>
                      {!p.support && <span className="text-xs text-muted"> (super admin)</span>}
                    </td>
                    <td className="py-1 text-right tabular-nums">{p.open}</td>
                    <td className="py-1 text-right tabular-nums">{p.waiting}</td>
                    <td className="py-1 text-right tabular-nums">{p.resolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {stats.data.unassigned > 0 && (
            <Button variant="secondary" className="text-sm" onClick={() => go({ view: 'UNASSIGNED', who: null })}>
              {stats.data.unassigned} unassigned: show them
            </Button>
          )}
        </Card>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Which tickets">
        {[...VIEWS, ...(superAdmin ? (['UNASSIGNED'] as TicketView[]) : [])].map((v) => (
          <Chip key={v} selected={view === v} onClick={() => go({ view: v })}>
            {VIEW_LABELS[v]}
          </Chip>
        ))}
      </div>
      {superAdmin && who && view !== 'UNASSIGNED' && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Showing <strong>{whoName}</strong>'s tickets.
          </span>
          <button type="button" className="min-h-9 text-link underline" onClick={() => go({ who: null })}>
            Show everyone's
          </button>
        </p>
      )}

      {list.isPending ? (
        <Loading />
      ) : list.isError && !list.data ? (
        <ErrorState message={explain(list.error)} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={view === 'OPEN' ? 'Nothing waiting on you' : `No tickets here`}
          body={view === 'OPEN' ? 'New questions from customers and salons show up here.' : undefined}
        />
      ) : (
        <>
          {list.isError && <Banner tone="warn">{isNetwork(list.error) ? "You're offline: this list may be out of date." : explain(list.error)}</Banner>}
          {/* The old view's rows while the new one loads: dimmed, so nobody taps them for the new one */}
          <ul className={`flex flex-col gap-2 ${list.isPlaceholderData ? 'opacity-50' : ''}`} aria-busy={list.isPlaceholderData}>
            {rows.map((t) => (
              <li key={t.id}>
                <Row t={t} now={now} showAssignee={superAdmin} />
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <Button variant="secondary" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              Show more tickets
            </Button>
          )}
        </>
      )}
      </>
      )}
    </Page>
  )
}

/** What the search can find: a ticket number (4+ digits, or "CLZ" and digits), a full mobile number, an email. */
export function isFindable(text: string): boolean {
  if (text.includes('@')) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)
  if (/clz\s*-?\s*\d/i.test(text)) return true
  const digits = text.replace(/\D/g, '')
  if (/^[\d\s+()-]+$/.test(text)) return /^\d{4,9}$/.test(text.trim()) || digits.length >= 10
  return false
}

function Row({ t, now, showAssignee }: { t: TicketSummary; now: number; showAssignee: boolean }) {
  const location = useLocation()
  return (
    <Link to={`/tickets/${t.id}`} state={{ back: location.pathname + location.search }} className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4 hover:bg-raised">
      <span className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold tabular-nums">{t.number}</span>
        <Pill tone={STATUS_TONES[t.status]}>{STATUS_LABELS[t.status]}</Pill>
        <span className="text-muted">{SOURCE_LABELS[t.source]}</span>
      </span>
      <span className="font-semibold [overflow-wrap:anywhere]">{t.subject}</span>
      <span className="text-sm text-muted [overflow-wrap:anywhere]">
        {t.requester} · {howLong(t.lastMessageAt, now) === 'just now' ? 'just now' : `${howLong(t.lastMessageAt, now)} ago`}
        {showAssignee && ` · ${t.assigneeName ?? 'Unassigned'}`}
      </span>
    </Link>
  )
}

/**
 * A support person's own away switch (leave, sick), on their tickets page: away, a line saying so with "I'm back";
 * otherwise a small "Going on leave?" that asks first.
 */
function SelfAway() {
  const me = useAdmin()
  const qc = useQueryClient()
  const away = useAway(true)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const since = away.data?.find((a) => a.userId === me.userId)?.since
  async function back() {
    if (busy) return
    setBusy(true)
    try {
      await adminApi.setAway(me.userId, false)
      await qc.invalidateQueries({ queryKey: ['admin', 'tickets'] })
      setNotice({ tone: 'good', text: 'Welcome back: new tickets come to you again.' })
    } catch (e) {
      setNotice({ tone: 'bad', text: explain(e) })
    } finally {
      setBusy(false)
    }
  }
  if (away.isPending) return null
  if (away.isError && !away.data) return <p className="text-sm text-warn">Couldn't check whether you're marked away.</p>
  return (
    <>
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      {since ? (
        <Banner tone="warn">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>You're marked away: no new tickets come to you.</span>
            <Button variant="secondary" className="text-sm" busy={busy} onClick={() => void back()}>
              I'm back
            </Button>
          </span>
        </Banner>
      ) : (
        <button type="button" className="self-start text-sm text-link underline" onClick={() => setAsking(true)}>
          Going on leave? Mark yourself away
        </button>
      )}
      {asking && (
        <MarkAway
          member={{ userId: me.userId, name: me.name ?? '', phone: me.phone ?? '' }}
          self
          onClose={() => setAsking(false)}
          onDone={(text) => {
            setAsking(false)
            setNotice({ tone: 'good', text })
          }}
        />
      )}
    </>
  )
}
