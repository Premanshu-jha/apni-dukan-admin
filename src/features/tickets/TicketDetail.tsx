import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { adminApi, keys, useTicket, useTicketStats } from '../../api/admin'
import { ApiError, explain, isNetwork } from '../../api/errors'
import type { TicketDetail as Detail } from '../../api/types'
import { useAdmin } from '../../app/guards'
import { Banner, Button, Card, EmptyState, ErrorState, Loading, Page, Pill, Sheet, TextArea } from '../../components/ui'
import { isSuperAdmin } from '../../lib/roles'
import { storage } from '../../lib/storage'
import { dateTimeIst } from '../../lib/time'
import { draftKey, EVENT_LABELS, SOURCE_LABELS, STATUS_LABELS, STATUS_TONES } from './labels'

/** Longest reply the backend takes (TicketService.REPLY_MAX). */
const REPLY_MAX = 5000
/** Answers that mean the ticket on screen is out of date: read it again. */
const STALE_CODES = ['NEW_MESSAGE', 'NOT_YOURS', 'REQUESTER_GONE', 'TICKET_CHANGED']

/** The length the backend counts (MessageText.clean): spaces before line breaks dropped, at most 2 empty lines. */
function cleanedLength(text: string): number {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t ]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().length
}

/** A 404 (or 400 for an address that isn't a ticket id): gone, moved away, or never there. */
function isGone(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 400)
}

/**
 * /tickets/:id: who asked (their account, business and latest bookings), the conversation, and the reply box. A
 * reply is emailed to them; "Send & resolve" also resolves it. A super admin can move it to someone else. What is
 * typed is kept in this browser (per person) until it is sent, so leaving the page or a refusal never loses it.
 */
/** Where the arrow goes: the list (with its view or search) the ticket was opened from, else all tickets. */
function useBackTo(): string {
  const state = useLocation().state as { back?: unknown } | null
  return typeof state?.back === 'string' && state.back.startsWith('/tickets') ? state.back : '/tickets'
}

export function TicketDetail() {
  const backTo = useBackTo()
  const { id = '' } = useParams()
  const me = useAdmin()
  const ticket = useTicket(id)
  if (ticket.isPending) return <Page back={backTo} title="Ticket"><Loading /></Page>
  // Gone even with an older copy on screen: it was given to someone else (or never existed)
  if (ticket.isError && isGone(ticket.error)) {
    return (
      <Page back={backTo} title="Ticket">
        {isSuperAdmin(me.adminRole) ? (
          <EmptyState title="Ticket not found" body="Check the link, or find it in the tickets list." />
        ) : (
          <EmptyState title="This ticket isn't yours" body="It was given to someone else, or the link is wrong." />
        )}
      </Page>
    )
  }
  if (ticket.isError && !ticket.data) {
    return (
      <Page back={backTo} title="Ticket">
        <ErrorState message={explain(ticket.error)} onRetry={() => void ticket.refetch()} />
      </Page>
    )
  }
  return <Loaded d={ticket.data!} stale={ticket.isError} refetch={() => void ticket.refetch()} />
}

function Loaded({ d, stale, refetch }: { d: Detail; stale: boolean; refetch: () => void }) {
  const backTo = useBackTo()
  const me = useAdmin()
  const qc = useQueryClient()
  const superAdmin = isSuperAdmin(me.adminRole)
  const t = d.ticket
  const key = draftKey(me.userId, t.id)
  const [text, setText] = useState(() => storage.get(key) ?? '')
  const [busy, setBusy] = useState<'reply' | 'resolve' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Close without reply: what they had read when the sheet opened (a message arriving meanwhile must stop it)
  const [closing, setClosing] = useState<number | null>(null)
  const [moving, setMoving] = useState(false)
  // The last message of theirs this person has seen: one arriving (the 30 s re-read) while they type is read first
  const [seen, setSeen] = useState(d.lastIncomingSeq)
  const unread = d.lastIncomingSeq > seen
  const sending = useRef(false)
  const [reopening, setReopening] = useState(false)

  /** Closed by mistake: open it again; nobody is emailed. */
  async function reopen() {
    setReopening(true)
    setError(null)
    setNotice(null)
    try {
      took(await adminApi.reopenTicket(t.id, d.version))
      setNotice('Opened again. Nobody was emailed.')
    } catch (e) {
      setError(e)
      if (e instanceof ApiError && STALE_CODES.includes(e.code)) refetch()
    } finally {
      setReopening(false)
    }
  }

  useEffect(() => {
    if (text.trim()) storage.set(key, text)
    else storage.remove(key)
  }, [text, key])

  // Nothing typed yet: there is nothing to have missed, so the latest message counts as seen
  useEffect(() => {
    if (!text.trim()) setSeen(d.lastIncomingSeq)
  }, [d.lastIncomingSeq, text])

  function took(next: Detail) {
    qc.setQueryData(keys.ticket(t.id), next)
    setSeen(next.lastIncomingSeq)
    void qc.invalidateQueries({ queryKey: keys.tickets })
  }

  async function send(resolve: boolean) {
    if (sending.current || !text.trim() || unread) return
    sending.current = true
    setBusy(resolve ? 'resolve' : 'reply')
    setError(null)
    setNotice(null)
    try {
      took(await adminApi.replyTicket(t.id, seen, text.trim(), resolve))
      setText('')
      setNotice(resolve ? 'Sent and resolved. They get your reply by email.' : 'Sent. They get your reply by email.')
    } catch (e) {
      setError(e)
      if (e instanceof ApiError && STALE_CODES.includes(e.code)) refetch()
    } finally {
      sending.current = false
      setBusy(null)
    }
  }

  const length = cleanedLength(text)
  const tooLong = length > REPLY_MAX
  const canReply = d.requesterEmail !== null
  const hasPhone = d.profile.some((s) => s.lines.some((l) => l.startsWith('Phone: ')))

  // Notices and refusals sit right above the buttons that caused them, not out of sight at the top
  const feedback = (
    <>
      {notice && <Banner tone="good">{notice}</Banner>}
      {error !== null && (
        <Banner tone="bad">{isNetwork(error) ? "You're offline. Your reply is kept here: send it again when you're back." : explain(error)}</Banner>
      )}
    </>
  )

  return (
    <Page
      back={backTo}
      title={t.number}
      footer={
        canReply ? (
          <div className="flex flex-col gap-2">
            {feedback}
            {unread && (
              <Banner tone="warn">
                They wrote again while you were typing: read it above.{' '}
                <button type="button" className="min-h-9 font-semibold underline" onClick={() => setSeen(d.lastIncomingSeq)}>
                  I've read it
                </button>
              </Banner>
            )}
            <TextArea
              id="ticket-reply"
              label={t.status === 'RESOLVED' ? 'Reply (opens it again)' : 'Your reply (emailed to them)'}
              rows={text.trim() ? 4 : 2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              error={tooLong ? `At most ${REPLY_MAX} characters (now ${length}).` : undefined}
              placeholder="Hi, we've checked this and…"
            />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" busy={busy === 'reply'} disabled={!length || tooLong || unread || busy !== null} onClick={() => void send(false)}>
                Send reply
              </Button>
              <Button className="flex-1" busy={busy === 'resolve'} disabled={!length || tooLong || unread || busy !== null} onClick={() => void send(true)}>
                Send &amp; resolve
              </Button>
            </div>
          </div>
        ) : notice || error !== null ? (
          <div className="flex flex-col gap-2">{feedback}</div>
        ) : undefined
      }
    >
      {stale && <Banner tone="warn">Couldn't refresh this ticket just now. What you see may be out of date.</Banner>}
      {!d.senderVerified && (
        <Banner tone="warn">
          We couldn't prove this email came from {d.requesterEmail ?? 'them'}: it may be from someone else. Don't change
          anything for them or share details until you've confirmed who it is.
        </Banner>
      )}
      {d.emailsFailed > 0 && (
        <Banner tone="bad">
          {d.emailsFailed === 1 ? 'One of our emails' : `${d.emailsFailed} of our emails`} to them couldn't be sent. Reach them another way
          {hasPhone ? ' (their phone is below)' : ''}.
        </Banner>
      )}
      {d.emailsWaiting > 0 && <Banner tone="info">An email to them is on its way.</Banner>}
      {!canReply && <Banner tone="warn">They deleted their account, so there's no address to reply to. Close the ticket when you're done.</Banner>}

      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={STATUS_TONES[t.status]}>{STATUS_LABELS[t.status]}</Pill>
          <span className="text-sm text-muted">
            {SOURCE_LABELS[t.source]} · {dateTimeIst(t.createdAt)}
          </span>
        </div>
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{t.subject}</h2>
        <p className="text-sm text-muted">
          With: <span className="text-ink">{t.assigneeName ?? 'Unassigned'}</span>
          {t.assigneeId === me.userId && ' (you)'}
        </p>
        <div className="flex flex-wrap gap-2">
          {superAdmin && (
            <Button variant="secondary" className="flex-1 text-sm" onClick={() => setMoving(true)}>
              Give to someone else
            </Button>
          )}
          {t.status !== 'RESOLVED' ? (
            <Button variant="secondary" className="flex-1 text-sm" onClick={() => setClosing(seen)}>
              Close without reply
            </Button>
          ) : (
            <Button variant="secondary" className="flex-1 text-sm" busy={reopening} onClick={() => void reopen()}>
              Open again (no email)
            </Button>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-semibold">Who asked</h2>
        <p className="[overflow-wrap:anywhere]">
          <strong>{t.requester}</strong>
          {d.requesterEmail && <span className="text-muted"> · {d.requesterEmail}</span>}
        </p>
        {d.requesterId === null && d.requesterEmail && (
          <p className="text-sm text-muted">
            {d.senderVerified ? "No Clozest account uses this email, so there's no profile to show." : 'Not matched to an account: the sender is unproven.'}
          </p>
        )}
        {d.earlierTickets > 0 && d.requesterId && (
          <Link to={`/tickets?requester=${encodeURIComponent(d.requesterId)}`} className="text-sm text-link underline">
            {d.earlierTickets} other {d.earlierTickets === 1 ? 'ticket' : 'tickets'} from them
          </Link>
        )}
        {d.profile.map((s) => (
          <div key={s.title} className="flex flex-col gap-1 border-t border-line pt-2">
            <h3 className="text-sm font-semibold text-muted">{s.title}</h3>
            <ul className="flex flex-col gap-0.5 text-sm">
              {s.lines.map((l) => (
                <li key={l} className="[overflow-wrap:anywhere]">
                  {l.startsWith('Phone: ') ? (
                    <>
                      Phone:{' '}
                      <a className="text-link underline" href={`tel:+91${l.slice(7).replace(/\D/g, '')}`}>
                        {l.slice(7)}
                      </a>
                    </>
                  ) : (
                    l
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>

      <section aria-label="Conversation" className="flex flex-col gap-2">
        {d.messages.map((m) => (
          <div
            key={m.seq}
            className={`flex flex-col gap-1 rounded-2xl border p-3 ${m.direction === 'OUT' ? 'ml-6 border-brand/40 bg-brand/10' : 'mr-6 border-line bg-surface'}`}
          >
            <p className="text-xs text-muted">
              {m.direction === 'OUT' ? `${m.author} (support)` : m.author} · {dateTimeIst(m.at)}
              {m.direction === 'IN' && m.senderVerified === false && ' · sender not proven'}
            </p>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>
            {m.attachments > 0 && (
              <p className="text-xs text-muted">
                📎 {m.attachments} {m.attachments === 1 ? 'file' : 'files'} attached: open the email in the support Gmail inbox to see {m.attachments === 1 ? 'it' : 'them'}.
              </p>
            )}
          </div>
        ))}
      </section>

      <details className="rounded-2xl border border-line bg-surface p-3">
        <summary className="min-h-9 cursor-pointer font-semibold">History</summary>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {d.events.map((e, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">
              <span className="text-muted">{dateTimeIst(e.at)}</span> · {EVENT_LABELS[e.event] ?? e.event}
              {e.actor && ` by ${e.actor}`}
              {e.detail && `: ${e.detail}`}
            </li>
          ))}
        </ul>
      </details>

      {closing !== null && (
        <CloseSheet
          d={d}
          seen={closing}
          onClose={() => setClosing(null)}
          onStale={refetch}
          onDone={(next) => {
            took(next)
            setClosing(null)
            setNotice('Closed. Nobody was emailed.')
          }}
        />
      )}
      {moving && (
        <MoveSheet
          d={d}
          onClose={() => setMoving(false)}
          onStale={refetch}
          onDone={(next) => {
            took(next)
            setMoving(false)
            setNotice(`Given to ${next.ticket.assigneeName ?? 'Unassigned'}.`)
          }}
        />
      )}
    </Page>
  )
}

function CloseSheet({ d, seen, onClose, onStale, onDone }: { d: Detail; seen: number; onClose: () => void; onStale: () => void; onDone: (next: Detail) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  async function close() {
    setBusy(true)
    setError(null)
    try {
      onDone(await adminApi.closeTicket(d.ticket.id, seen))
    } catch (e) {
      setError(e)
      if (e instanceof ApiError && STALE_CODES.includes(e.code)) onStale()
      setBusy(false)
    }
  }
  return (
    <Sheet open title={`Close ${d.ticket.number} without a reply?`} onClose={busy ? () => {} : onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-muted">It's marked resolved and nobody is emailed. For spam or a mistaken email. If they write again, it opens again.</p>
        {error !== null && <Banner tone="bad">{explain(error)}</Banner>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Keep it open
          </Button>
          <Button className="flex-1" busy={busy} onClick={() => void close()}>
            Close it
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

function MoveSheet({ d, onClose, onStale, onDone }: { d: Detail; onClose: () => void; onStale: () => void; onDone: (next: Detail) => void }) {
  const me = useAdmin()
  const stats = useTicketStats(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const people = (stats.data?.people ?? []).filter((p) => p.support && p.userId !== d.ticket.assigneeId && p.userId !== d.requesterId)
  async function give(to: string | null) {
    setBusy(to ?? 'none')
    setError(null)
    try {
      // The version on screen now (re-read after a refusal, so the next tap works)
      onDone(await adminApi.assignTicket(d.ticket.id, d.version, to))
    } catch (e) {
      setError(e)
      if (e instanceof ApiError && STALE_CODES.includes(e.code)) onStale()
      setBusy(null)
    }
  }
  return (
    <Sheet open title={`Give ${d.ticket.number} to`} onClose={busy ? () => {} : onClose}>
      <div className="flex flex-col gap-2">
        {error !== null && <Banner tone="bad">{explain(error)}</Banner>}
        {stats.isPending && <Loading />}
        {people.map((p) => (
          <Button key={p.userId} variant="secondary" busy={busy === p.userId} disabled={busy !== null} onClick={() => void give(p.userId)}>
            {p.name} · {p.open + p.waiting} not resolved
          </Button>
        ))}
        {d.ticket.assigneeId !== me.userId && d.requesterId !== me.userId && (
          <Button variant="secondary" busy={busy === me.userId} disabled={busy !== null} onClick={() => void give(me.userId)}>
            Me
          </Button>
        )}
        {d.ticket.assigneeId !== null && (
          <Button variant="secondary" busy={busy === 'none'} disabled={busy !== null} onClick={() => void give(null)}>
            Unassigned
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
          Cancel
        </Button>
      </div>
    </Sheet>
  )
}
