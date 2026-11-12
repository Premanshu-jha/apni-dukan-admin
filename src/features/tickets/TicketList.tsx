import { Link, useSearchParams } from 'react-router'
import { useTicketList, useTicketStats } from '../../api/admin'
import { explain, isNetwork } from '../../api/errors'
import type { TicketSummary, TicketView } from '../../api/types'
import { useAdmin } from '../../app/guards'
import { Banner, Button, Card, Chip, EmptyState, ErrorState, Loading, Page, Pill } from '../../components/ui'
import { isSuperAdmin } from '../../lib/roles'
import { howLong } from '../../lib/time'
import { useNow } from '../../lib/useNow'
import { isTicketView, SOURCE_LABELS, STATUS_LABELS, STATUS_TONES, VIEW_LABELS } from './labels'

const VIEWS: TicketView[] = ['OPEN', 'WAITING', 'RESOLVED']

/**
 * /tickets: a support person's own tickets (waiting on us first, then waiting on them, then resolved). A super
 * admin sees everyone's, can show Unassigned or one person's (?who=), and the counts per person on top.
 * The view and the person are in the address, so Back from a ticket comes back to the same list.
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
    </Page>
  )
}

function Row({ t, now, showAssignee }: { t: TicketSummary; now: number; showAssignee: boolean }) {
  return (
    <Link to={`/tickets/${t.id}`} className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4 hover:bg-raised">
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
