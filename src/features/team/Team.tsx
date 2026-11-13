import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { adminApi, keys, useAway, useCoverage, useTeam } from '../../api/admin'
import { explain } from '../../api/errors'
import type { Moved, TeamMember } from '../../api/types'
import { useAdmin } from '../../app/guards'
import { Tabs } from '../../components/Tabs'
import { MarkAway } from './MarkAway'
import { Banner, Button, Card, Chip, EmptyState, ErrorState, Field, Loading, Page, Pill, Sheet } from '../../components/ui'
import { DESIGNATION_LABELS, ROLE_LABELS } from '../../lib/labels'
import { formatPhone } from '../../lib/phone'
import { dateIst } from '../../lib/time'

type View = 'members' | 'coverage'

/**
 * Team (super admins only): who can use this site, with Add / Edit / Remove, and "Move waiting visits" for a field
 * agent going on leave; the Coverage tab shows which pincodes are covered by whom.
 */
export function Team() {
  const [params] = useSearchParams()
  const view: View = params.get('view') === 'coverage' ? 'coverage' : 'members'
  const location = useLocation()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null)
  // Shown once: the history entry forgets it, so a reload or coming Back doesn't show it again
  useEffect(() => {
    if (location.state) navigate({ search: location.search }, { replace: true, state: null })
  }, [location.state, location.search, navigate])

  return (
    <Page title="Team">
      <Tabs
        label="Team view"
        value={view}
        options={[
          { value: 'members', label: 'Members' },
          { value: 'coverage', label: 'Coverage' },
        ]}
        onChange={(v) => {
          setNotice(null)
          // Replacing the entry also forgets the notice the form left in it, so Back doesn't show it again
          navigate({ search: v === 'coverage' ? '?view=coverage' : '' }, { replace: true, state: null })
        }}
      />
      {notice && <Banner tone={notice.startsWith('⚠ ') ? 'bad' : 'good'}>{notice.replace(/^⚠ /, '')}</Banner>}
      {view === 'members' ? <Members onNotice={setNotice} /> : <Coverage />}
    </Page>
  )
}

function Members({ onNotice }: { onNotice: (text: string | null) => void }) {
  const me = useAdmin()
  const qc = useQueryClient()
  const team = useTeam()
  const [removing, setRemoving] = useState<TeamMember | null>(null)
  const [moving, setMoving] = useState<TeamMember | null>(null)
  const [movingTickets, setMovingTickets] = useState<TeamMember | null>(null)
  const [markingAway, setMarkingAway] = useState<TeamMember | null>(null)
  const [backBusy, setBackBusy] = useState<string | null>(null)
  const awayList = useAway(true)
  const awaySince = new Map((awayList.data ?? []).map((a) => [a.userId, a.since]))
  async function back(m: TeamMember) {
    if (backBusy) return
    setBackBusy(m.userId)
    try {
      await adminApi.setAway(m.userId, false)
      // The button stays busy until the lists say so: a second tap never sends it twice
      await Promise.all([qc.invalidateQueries({ queryKey: ['admin', 'tickets'] }), qc.invalidateQueries({ queryKey: keys.team })])
      onNotice(`${m.name || 'They'} ${m.name ? 'is' : 'are'} back: new tickets go to them again.`)
    } catch (e) {
      onNotice(`⚠ ${explain(e)}`)
    } finally {
      setBackBusy(null)
    }
  }
  const agents = (team.data ?? []).filter((m) => m.designation === 'FIELD_AGENT')

  return (
    <>
      <Link to="/team/new" className="flex min-h-12 items-center justify-center rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:brightness-110">
        Add a member
      </Link>
      {team.isPending ? (
        <Loading />
      ) : team.isError && !team.data ? (
        <ErrorState message={explain(team.error)} onRetry={() => void team.refetch()} />
      ) : team.data.length === 0 ? (
        <EmptyState title="No one on the team yet" />
      ) : (
        <>
        {awayList.isError && !awayList.data && (
          <Banner tone="warn">Couldn't check who is away, so the away buttons are hidden. Try again in a moment.</Banner>
        )}
        <ul className="flex flex-col gap-2" aria-label="Team">
          {team.data.map((m) => (
            <li key={m.userId}>
              <Card className="flex flex-col gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-semibold [overflow-wrap:anywhere]">
                    {m.name || 'No name yet'}
                    {m.userId === me.userId && <span className="text-muted"> (you)</span>}
                  </p>
                  <p className="text-sm text-muted">+91 {formatPhone(m.phone)}</p>
                  {m.email && (
                    <p className="text-sm text-muted [overflow-wrap:anywhere]">
                      {m.email}
                      {!m.emailVerified && <span> · not confirmed yet</span>}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Pill tone={m.adminRole === 'SUPER_ADMIN' ? 'brand' : 'muted'}>
                      {m.designation ? DESIGNATION_LABELS[m.designation] : ROLE_LABELS[m.adminRole]}
                    </Pill>
                    on the team since {dateIst(m.since)}
                  </div>
                  {m.designation === 'SUPPORT' && (
                    <p className="text-sm text-muted">
                      {m.openTickets ?? 0} open {(m.openTickets ?? 0) === 1 ? 'ticket' : 'tickets'}
                      {awaySince.has(m.userId) && (
                        <span className="font-semibold text-warn"> · Away since {dateIst(awaySince.get(m.userId)!)}: gets no new tickets</span>
                      )}
                    </p>
                  )}
                  {m.designation === 'FIELD_AGENT' && (
                    <p className="text-sm">
                      {m.pincodes.length === 0 ? (
                        <span className="text-warn">No pincodes yet: gets no businesses</span>
                      ) : (
                        <span className="text-muted [overflow-wrap:anywhere]">
                          {m.pincodes.length} {m.pincodes.length === 1 ? 'pincode' : 'pincodes'}: {m.pincodes.slice(0, 6).join(', ')}
                          {m.pincodes.length > 6 ? ` +${m.pincodes.length - 6} more` : ''}
                        </span>
                      )}
                      <span className="text-muted"> · {m.pendingVisits} waiting</span>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/team/${m.userId}`}
                    aria-label={`Edit ${m.name || m.phone}`}
                    className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-line bg-raised px-4 text-sm font-semibold hover:bg-line"
                  >
                    Edit
                  </Link>
                  {m.designation === 'SUPPORT' && (m.openTickets ?? 0) > 0 && (
                    <Button variant="secondary" className="flex-1 text-sm" onClick={() => setMovingTickets(m)} aria-label={`Move ${m.name || m.phone}'s open tickets`}>
                      Move open tickets
                    </Button>
                  )}
                  {m.designation === 'SUPPORT' &&
                    awayList.data &&
                    (awaySince.has(m.userId) ? (
                      <Button variant="secondary" className="flex-1 text-sm" busy={backBusy === m.userId} onClick={() => void back(m)} aria-label={`Back from away: ${m.name || m.phone}`}>
                        Back from away
                      </Button>
                    ) : (
                      <Button variant="secondary" className="flex-1 text-sm" onClick={() => setMarkingAway(m)} aria-label={`Mark away: ${m.name || m.phone}`}>
                        Mark away
                      </Button>
                    ))}
                  {m.designation === 'FIELD_AGENT' && m.pendingVisits > 0 && (
                    <Button variant="secondary" className="flex-1 text-sm" onClick={() => setMoving(m)} aria-label={`Move ${m.name || m.phone}'s waiting visits`}>
                      Move waiting visits
                    </Button>
                  )}
                  {m.userId !== me.userId && (
                    <Button variant="danger" className="flex-1 text-sm" onClick={() => setRemoving(m)} aria-label={`Remove ${m.name || m.phone}`}>
                      Remove
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
        </>
      )}

      {markingAway && (
        <MarkAway
          member={markingAway}
          self={false}
          onClose={() => setMarkingAway(null)}
          onDone={(text) => {
            setMarkingAway(null)
            onNotice(text)
          }}
        />
      )}
      {removing && (
        <RemoveMember
          member={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null)
            onNotice(`${removing.name || `+91 ${formatPhone(removing.phone)}`} is off the team and was signed out.`)
            void qc.invalidateQueries({ queryKey: keys.team })
            void qc.invalidateQueries({ queryKey: keys.coverage })
            void qc.invalidateQueries({ queryKey: keys.shops })
            void qc.invalidateQueries({ queryKey: keys.shopPages })
            void qc.invalidateQueries({ queryKey: keys.dashboard })
          }}
          onRefused={() => void qc.invalidateQueries({ queryKey: keys.team })}
        />
      )}
      {moving && (
        <MoveVisits
          from={moving}
          agents={agents.filter((a) => a.userId !== moving.userId)}
          onClose={() => setMoving(null)}
          onRefused={() => void qc.invalidateQueries({ queryKey: keys.team })}
          onDone={(to, r) => {
            setMoving(null)
            const who = to.name || `+91 ${formatPhone(to.phone)}`
            const stayed = r.stayed ? ` ${r.stayed} stayed with ${moving.name || 'them'}: ${to.name || 'the new agent'} works there.` : ''
            // A retry after a lost answer finds them already moved
            onNotice(
              r.moved === 0 && r.stayed === 0
                ? `No waiting visits were left to move: they may already be with ${who}.`
                : `Moved ${r.moved} waiting ${r.moved === 1 ? 'visit' : 'visits'} to ${who}.${stayed}`,
            )
            void qc.invalidateQueries({ queryKey: keys.team })
            void qc.invalidateQueries({ queryKey: keys.shops })
            void qc.invalidateQueries({ queryKey: keys.shopPages })
            void qc.invalidateQueries({ queryKey: keys.dashboard })
          }}
        />
      )}
      {movingTickets && (
        <MoveTickets
          from={movingTickets}
          others={(team.data ?? []).filter((x) => x.designation === 'SUPPORT' && x.userId !== movingTickets.userId && !awaySince.has(x.userId))}
          onClose={() => setMovingTickets(null)}
          onDone={(toName, moved, stayed) => {
            const who = movingTickets.name || 'them'
            setMovingTickets(null)
            const left = stayed > 0 ? ` ${stayed} stayed with ${who}: nobody else could take ${stayed === 1 ? 'it' : 'them'} (their own question, or nobody else in support).` : ''
            onNotice(moved === 0 && stayed === 0 ? 'No open tickets were left to move.' : `Moved ${moved} open ${moved === 1 ? 'ticket' : 'tickets'} to ${toName}.${left}`)
            void qc.invalidateQueries({ queryKey: keys.team })
            void qc.invalidateQueries({ queryKey: keys.tickets })
          }}
        />
      )}
    </>
  )
}

/** A support person is away: every open ticket of theirs to one other support person, or shared out by the rule. */
function MoveTickets({ from, others, onClose, onDone }: {
  from: TeamMember
  others: TeamMember[]
  onClose: () => void
  onDone: (toName: string, moved: number, stayed: number) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  // One tap chooses, a second confirms: a slip on a phone never moves every ticket to the wrong person
  const [chosen, setChosen] = useState<TeamMember | 'share' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const who = from.name || `+91 ${formatPhone(from.phone)}`
  async function move(to: TeamMember | null) {
    setBusy(to?.userId ?? 'share')
    setError(null)
    try {
      const r = await adminApi.moveTickets(from.userId, to?.userId ?? null)
      onDone(to ? to.name || `+91 ${formatPhone(to.phone)}` : 'the other support people', r.moved, r.stayed)
    } catch (e) {
      setError(e)
      setBusy(null)
    }
  }
  return (
    <Sheet open title={`Move ${who}'s ${from.openTickets} open ${from.openTickets === 1 ? 'ticket' : 'tickets'}`} onClose={busy ? () => {} : onClose}>
      <div className="flex flex-col gap-2">
        <p className="text-muted">For when they're away. New tickets still come to them while they're in support; change their designation to stop that.</p>
        {error !== null && <Banner tone="bad">{explain(error)}</Banner>}
        {chosen !== null ? (
          <>
            <p className="font-semibold [overflow-wrap:anywhere]">
              Move all {from.openTickets} to {chosen === 'share' ? 'the other support people, shared out' : chosen.name || `+91 ${formatPhone(chosen.phone)}`}?
            </p>
            <Button busy={busy !== null} onClick={() => void move(chosen === 'share' ? null : chosen)}>
              Yes, move them
            </Button>
            <Button variant="secondary" disabled={busy !== null} onClick={() => setChosen(null)}>
              Choose someone else
            </Button>
          </>
        ) : (
          <>
            {others.length > 1 && (
              <Button onClick={() => setChosen('share')}>Share among the other support people</Button>
            )}
            {others.map((o) => (
              <Button key={o.userId} variant="secondary" onClick={() => setChosen(o)}>
                {o.name || `+91 ${formatPhone(o.phone)}`} · {o.openTickets ?? 0} open
              </Button>
            ))}
            {others.length === 0 && (
              <p className="text-sm text-muted">Nobody else is in support yet: close this, then "Add a member" with the designation Support.</p>
            )}
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </Sheet>
  )
}

function RemoveMember({
  member,
  onClose,
  onDone,
  onRefused,
}: {
  member: TeamMember
  onClose: () => void
  onDone: () => void
  onRefused: () => void
}) {
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const who = member.name || `+91 ${formatPhone(member.phone)}`

  async function remove() {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await adminApi.removeMember(member.userId)
      onDone()
    } catch (err) {
      setError(err)
      onRefused()
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Sheet open title={`Remove ${who}?`} onClose={busy ? () => {} : onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-muted">
          They lose access to this site and are signed out at once.
          {member.pendingVisits > 0 && ' Their waiting visits go to other field agents covering those pincodes, or to Unassigned.'}
          {(member.openTickets ?? 0) > 0 && ' Their open support tickets go to the other support people, or to Unassigned.'}
        </p>
        {error !== null && <Banner tone="bad">{explain(error)}</Banner>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" className="flex-1" busy={busy} onClick={remove}>
            Remove
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/** "Move waiting visits": every business waiting for this agent goes to the agent chosen here (leave). */
function MoveVisits({
  from,
  agents,
  onClose,
  onDone,
  onRefused,
}: {
  from: TeamMember
  agents: TeamMember[]
  onClose: () => void
  onDone: (to: TeamMember, result: Moved) => void
  onRefused: () => void
}) {
  const sending = useRef(false)
  const [to, setTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const who = from.name || `+91 ${formatPhone(from.phone)}`

  async function move() {
    const target = agents.find((a) => a.userId === to)
    if (!target || sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      onDone(target, await adminApi.moveAll(from.userId, target.userId))
    } catch (err) {
      setError(err)
      onRefused()   // the list may be out of date (an agent removed meanwhile)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Sheet open title={`Move ${who}'s ${from.pendingVisits} waiting ${from.pendingVisits === 1 ? 'visit' : 'visits'}`} onClose={busy ? () => {} : onClose}>
      <div className="flex flex-col gap-4">
        {agents.length === 0 ? (
          <p className="text-muted">There's no other field agent yet. Add one on the Team page first.</p>
        ) : (
          <>
            <p className="text-muted">To which field agent? They get one message about the move.</p>
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto" role="group" aria-label="Move to">
              {agents.map((a) => (
                <Chip key={a.userId} selected={to === a.userId} onClick={() => setTo(a.userId)}>
                  {a.name || `+91 ${formatPhone(a.phone)}`} · {a.pendingVisits} waiting
                </Chip>
              ))}
            </div>
          </>
        )}
        {error !== null && <Banner tone="bad">{explain(error)}</Banner>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button className="flex-1" busy={busy} disabled={!agents.some((a) => a.userId === to)} onClick={move}>
            Move
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/** Which pincodes are covered by whom, searchable; field agents with no pincodes are named (they get nothing). */
function Coverage() {
  const coverage = useCoverage()
  const team = useTeam()
  const [q, setQ] = useState('')
  const typed = q.replace(/\D/g, '')
  const shown = useMemo(() => (coverage.data ?? []).filter((c) => c.pincode.startsWith(typed)), [coverage.data, typed])
  const idle = (team.data ?? []).filter((m) => m.designation === 'FIELD_AGENT' && m.pincodes.length === 0)

  if (coverage.isPending) return <Loading />
  if (coverage.isError && !coverage.data) return <ErrorState message={explain(coverage.error)} onRetry={() => void coverage.refetch()} />
  return (
    <>
      {idle.length > 0 && (
        <Banner tone="warn">
          No pincodes yet, so no businesses: {idle.map((m) => m.name || `+91 ${formatPhone(m.phone)}`).join(', ')}. Edit them to add some.
        </Banner>
      )}
      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <Field id="coverage-search" label="Find a pincode" inputMode="numeric" autoComplete="off" placeholder="5000" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      {coverage.data.length === 0 ? (
        <EmptyState title="No pincodes covered yet" body="Every business goes to Unassigned until a field agent covers its pincode." />
      ) : shown.length === 0 ? (
        <EmptyState title="Nobody covers it" body={`No field agent covers a pincode starting ${typed}. Businesses there go to Unassigned.`} />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Coverage">
          {shown.map((c) => (
            <li key={c.pincode}>
              <Card className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{c.pincode}</span>
                <span className="min-w-0 text-right text-sm text-muted [overflow-wrap:anywhere]">
                  {c.agents.map((a) => a.name || `+91 ${formatPhone(a.phone)}`).join(', ')}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

