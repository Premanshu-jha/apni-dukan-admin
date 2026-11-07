import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { adminApi, keys, useEarlierTimeline, useShopDetail } from '../../api/admin'
import { ADMIN_MESSAGES, explain, isApiError, isNetwork, wrongStatusText } from '../../api/errors'
import type { AdminShop, Change, ShopDetail as Detail, ShopStatus, TimelineEntry, TimelineNext } from '../../api/types'
import { Photo } from '../../components/Photo'
import { Banner, Button, Card, EmptyState, ErrorState, Loading, Page, Pill } from '../../components/ui'
import { CHECKLIST_LABELS, eventLabel, GROUP_LABELS, STATUS_LABELS, TYPE_LABELS } from '../../lib/labels'
import { directionsUrl, distanceLabel, telUrl } from '../../lib/links'
import { formatPhone } from '../../lib/phone'
import { DECISION_LABELS, decisionsFor, type Decision } from '../../lib/rules'
import { dateIst, dateTimeIst } from '../../lib/time'
import { type Conflict, DecisionSheet, type Draft, EMPTY_DRAFT, NoteSheet } from './DecisionSheet'

/** The status a decision leads to: after a lost answer, seeing it on a re-read means the decision went through. */
const RESULT: Record<Decision, ShopStatus> = {
  approve: 'APPROVED',
  reject: 'DRAFT',
  suspend: 'SUSPENDED',
  reinstate: 'PENDING_VISIT',
}

const DONE_TEXT: Record<Decision, string> = {
  approve: 'Approved. The shop is live now.',
  reject: 'Sent back to the owner with your reason.',
  suspend: 'Suspended. The owner sees your reason.',
  reinstate: 'Reinstated. It now waits for a re-check visit.',
}

/** One shop for the field visit: what changed, photos, details, directions, call, decisions and the timeline. */
export function ShopDetail() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const detail = useShopDetail(id)
  const [open, setOpen] = useState<{ decision: Decision; version: number } | 'note' | null>(null)
  const [drafts, setDrafts] = useState<Partial<Record<Decision, Draft>>>({})
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * After a 409 the page on screen is out of date: its words, and the decision buttons stay off until a reload
   * succeeds. A failed reload keeps it (with why).
   */
  const [stale, setStale] = useState<{ text: string; reloadError: string | null } | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)

  if (detail.isPending) return <Page title="Shop" back><Loading /></Page>
  if (detail.isError && !detail.data) {
    return (
      <Page title="Shop" back="/">
        {isApiError(detail.error, 'NOT_FOUND') ? (
          <EmptyState title="No such shop" body="It may have been removed, or the link is wrong." />
        ) : (
          <ErrorState message={explain(detail.error)} onRetry={() => void detail.refetch()} />
        )}
      </Page>
    )
  }

  const data = detail.data
  const shop = data.shop
  const back = shop.group ? `/shops?type=${shop.type}&group=${shop.group}` : `/?type=${shop.type}`
  const tel = telUrl(shop.ownerPhone)

  /** Everything that shows this shop: its page, the lists and the counts. */
  function refreshAll() {
    void qc.invalidateQueries({ queryKey: keys.shop(id) })
    void qc.invalidateQueries({ queryKey: keys.shops })
    void qc.invalidateQueries({ queryKey: keys.dashboard })
  }

  /** Reads the shop again; true when it worked (the stale banner goes and the buttons come back). */
  async function reload(): Promise<boolean> {
    setReloading(true)
    const r = await detail.refetch()
    setReloading(false)
    if (r.isError) {
      setStale((st) => st && { ...st, reloadError: explain(r.error) })
      return false
    }
    setStale(null)
    return true
  }

  function decided(decision: Decision, updated: AdminShop) {
    qc.setQueryData<Detail>(keys.shop(id), (old) => (old ? { ...old, shop: updated } : old))
    setDrafts((d) => ({ ...d, [decision]: undefined }))
    setOpen(null)
    setStale(null)
    setWarning(null)
    setNotice(DONE_TEXT[decision])
    refreshAll()
  }

  async function conflicted(c: Conflict, error: unknown) {
    setOpen(null)
    setNotice(null)
    setWarning(null)
    // The dashboard and lists are out of date too, whoever changed the shop.
    void qc.invalidateQueries({ queryKey: keys.shops })
    void qc.invalidateQueries({ queryKey: keys.dashboard })
    if (c === 'SHOP_CHANGED') {
      // The page re-reads in the background, but the admin must look again before deciding: the buttons come back
      // only after Reload works.
      setStale({ text: ADMIN_MESSAGES.SHOP_CHANGED, reloadError: null })
      void qc.invalidateQueries({ queryKey: keys.shop(id) })
      return
    }
    // Someone else decided: show the shop as it is now straight away.
    const text = wrongStatusText(error)
    setStale({ text, reloadError: null })
    if (await reload()) setWarning(text)
  }

  /**
   * The decision's answer was lost (weak network, timeout): read the shop again. If it already shows the decision,
   * it went through; otherwise the form stays and says the phone is offline.
   */
  async function uncertain(decision: Decision): Promise<boolean> {
    try {
      const now = await adminApi.shop(id)
      if (now.shop.status !== RESULT[decision]) return false
      qc.setQueryData<Detail>(keys.shop(id), now)
      decided(decision, now.shop)
      return true
    } catch {
      return false
    }
  }

  const decisions = decisionsFor(shop.status)
  const current = open !== null && open !== 'note' ? open : null

  return (
    <Page
      title={`#${shop.shopCode} ${shop.name}`}
      back={back}
      footer={
        <div className="flex flex-wrap gap-2">
          {decisions.map((d) => (
            <Button
              key={d}
              variant={d === 'approve' || d === 'reinstate' ? 'primary' : d === 'reject' ? 'secondary' : 'danger'}
              className="flex-1"
              disabled={stale !== null}
              onClick={() => {
                setNotice(null)
                setWarning(null)
                setOpen({ decision: d, version: shop.version })
              }}
            >
              {DECISION_LABELS[d]}
            </Button>
          ))}
          <Button variant="ghost" className="flex-1 border border-line" onClick={() => setOpen('note')}>
            Add note
          </Button>
        </div>
      }
    >
      {stale && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          <p>{stale.text}</p>
          {stale.reloadError && <p>Couldn't reload: {stale.reloadError}</p>}
          <Button variant="secondary" busy={reloading} onClick={() => void reload()}>
            Reload
          </Button>
        </div>
      )}
      {warning && <Banner tone="warn">{warning}</Banner>}
      {notice && <Banner tone="good">{notice}</Banner>}
      {detail.isError && <Banner tone="warn">Couldn't refresh: {explain(detail.error)}</Banner>}

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={shop.status === 'APPROVED' ? 'good' : shop.status === 'SUSPENDED' ? 'bad' : 'warn'}>{STATUS_LABELS[shop.status]}</Pill>
        {shop.group && <Pill tone="muted">{GROUP_LABELS[shop.group]}</Pill>}
        <Pill tone="muted">{TYPE_LABELS[shop.type]}</Pill>
      </div>
      {shop.statusReason && (
        <p className="min-w-0 text-sm text-muted [overflow-wrap:anywhere]">
          The owner was told: <span className="text-ink">"{shop.statusReason}"</span>
        </p>
      )}

      {data.changes.length > 0 && <WhatChanged detail={data} />}

      <section aria-labelledby="photos" className="flex flex-col gap-2">
        <h2 id="photos" className="font-semibold">Photos</h2>
        <div className="grid grid-cols-2 gap-2">
          <Photo url={shop.shopPhotoUrl} label="Shop photo" />
          <Photo url={shop.ownerPhotoUrl} label="Owner photo" />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={directionsUrl(shop.latitude, shop.longitude)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 items-center justify-center rounded-xl bg-raised border border-line px-4 font-semibold"
        >
          Navigate
        </a>
        {tel ? (
          <a href={tel} className="flex min-h-12 items-center justify-center rounded-xl bg-raised border border-line px-4 font-semibold">
            Call owner
          </a>
        ) : (
          <span className="flex min-h-12 items-center justify-center rounded-xl border border-dashed border-line px-4 text-sm text-muted">
            No phone number
          </span>
        )}
      </div>

      <section aria-labelledby="details" className="flex flex-col gap-2">
        <h2 id="details" className="font-semibold">Details</h2>
        <Card>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <Row label="Owner">{shop.ownerName}</Row>
            <Row label="Phone">{shop.ownerPhone ? `+91 ${formatPhone(shop.ownerPhone)}` : '—'}</Row>
            <Row label="Address">{shop.addressLine}</Row>
            <Row label="Area">{shop.area}</Row>
            <Row label="City">{shop.city}</Row>
            <Row label="Pincode">{shop.pincode}</Row>
            <Row label="GSTIN">{shop.gstin || '—'}</Row>
            <Row label="Udyam">{shop.udyamNumber || '—'}</Row>
            <Row label="Registered">{dateIst(shop.createdAt)}</Row>
            {data.salon && <Row label="Barbers">{String(data.salon.barbers)}</Row>}
            {data.salon && <Row label="Services">{String(data.salon.services)}</Row>}
          </dl>
        </Card>
      </section>

      <Timeline id={id} first={data.timeline} next={data.timelineNext} />

      {current && (
        <DecisionSheet
          shop={shop}
          decision={current.decision}
          version={current.version}
          draft={drafts[current.decision] ?? EMPTY_DRAFT}
          onDraft={(d) => setDrafts((all) => ({ ...all, [current.decision]: d }))}
          onClose={() => setOpen(null)}
          onDone={(s) => decided(current.decision, s)}
          onConflict={(c, e) => void conflicted(c, e)}
          onUncertain={() => uncertain(current.decision)}
        />
      )}
      {open === 'note' && (
        <NoteSheet
          shop={shop}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null)
            setNotice('Note added.')
            void qc.invalidateQueries({ queryKey: keys.shop(id) })
          }}
        />
      )}
    </Page>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </>
  )
}

/**
 * The timeline: the shop page's first 50 entries, then "Show earlier entries" for 50 more at a time
 * (GET /admin/shops/{id}/timeline from `timelineNext`). As the shop list's "Show more shops": an offline tap or a
 * failed page keeps what is shown and says so; focus moves to the first new entry; `aria-busy` while loading.
 */
function Timeline({ id, first, next }: { id: string; first: TimelineEntry[]; next: TimelineNext | null }) {
  const [shown, setShown] = useState(false)
  // How many pages of earlier entries the admin asked for (each tap one more)
  const [wanted, setWanted] = useState(0)
  const earlier = useEarlierTimeline(id, next, shown)
  const listRef = useRef<HTMLOListElement | null>(null)
  // Index of the first entry the next page brings (set when "Show earlier entries" is tapped)
  const focusIndex = useRef<number | null>(null)
  const failed = earlier.isFetchNextPageError || (earlier.isError && !earlier.data)
  const pages = earlier.data?.pages.length ?? 0
  /*
   * A note or decision pushes the first 50 down, so `timelineNext` changes and the earlier entries start again under
   * a new key. Until that key has as many pages as the admin had loaded (or there are no more), the timeline as it
   * was stays on screen (first 50 and earlier pages together: one consistent list, nothing missing or twice), so
   * neither the entries nor the scroll position jump. Catch-up pages are asked one after the other below.
   */
  const catchingUp = shown && next !== null && !failed && pages < wanted && (pages === 0 || earlier.hasNextPage)
  const fresh = [...newestFirst(first), ...newestFirst(earlier.data?.pages.flatMap((p) => p.items) ?? [])]
  const lastShown = useRef<TimelineEntry[]>(fresh)
  const entries = catchingUp && lastShown.current.length > fresh.length ? lastShown.current : fresh
  lastShown.current = entries
  const loaded = entries.length
  const [offlineAt, setOfflineAt] = useState<number | null>(null)
  const offlineTap = offlineAt !== null && offlineAt === loaded
  const loading = earlier.isFetchingNextPage || (shown && earlier.isPending && earlier.fetchStatus === 'fetching')
  // Not yet asked, loading, more to come, or the first earlier page failed (tapping again retries it)
  const more = next !== null && (!shown || earlier.isPending || earlier.hasNextPage || (earlier.isError && !earlier.data))

  // Catch up after the key changed: the next page, until there are as many as before
  const { hasNextPage, isFetching, fetchNextPage } = earlier
  useEffect(() => {
    if (pages > 0 && pages < wanted && hasNextPage && !isFetching && !failed) void fetchNextPage()
  }, [pages, wanted, hasNextPage, isFetching, failed, fetchNextPage])

  useEffect(() => {
    if (focusIndex.current === null || loading || catchingUp) return
    if (loaded > focusIndex.current) listRef.current?.querySelector<HTMLElement>(`[data-index="${focusIndex.current}"]`)?.focus()
    focusIndex.current = null
  }, [loaded, loading, catchingUp])

  function showEarlier() {
    if (loading || catchingUp) return
    if (!navigator.onLine) {
      setOfflineAt(loaded)
      return
    }
    setOfflineAt(null)
    focusIndex.current = loaded
    setWanted(pages + 1)
    if (!shown) setShown(true)
    else if (earlier.isError && !earlier.data) void earlier.refetch()
    else void earlier.fetchNextPage()
  }

  return (
    <section aria-labelledby="timeline" className="flex flex-col gap-2">
      <h2 id="timeline" className="font-semibold">Timeline</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet.</p>
      ) : (
        <ol ref={listRef} className="flex flex-col gap-2" aria-label="Timeline, newest first" aria-busy={loading}>
          {entries.map((e, i) => (
            // Drawn only near the screen (the browser skips entries far off it but keeps them in the page)
            <li
              key={`${e.at}-${i}`}
              data-index={i}
              tabIndex={-1}
              className="[content-visibility:auto] [contain-intrinsic-size:auto_96px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <TimelineItem entry={e} />
            </li>
          ))}
        </ol>
      )}
      {(failed || offlineTap) && (
        <p role="alert" className="text-sm text-bad">
          {offlineTap || isNetwork(earlier.error)
            ? "You're offline or the server can't be reached. Connect and tap Show earlier entries again."
            : "Couldn't load earlier entries. Tap Show earlier entries to try again."}
        </p>
      )}
      {more && (
        // aria-busy, not disabled: a disabled button would drop the keyboard focus while it loads
        <Button variant="secondary" aria-busy={loading} onClick={showEarlier}>
          {loading ? 'Loading earlier entries…' : 'Show earlier entries'}
        </Button>
      )}
    </section>
  )
}

/** Newest first (the backend sends it so; sorted again in case). */
function newestFirst(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

/** Since the last approved version: old → new for each field, how far the pin moved, old and new photos. */
function WhatChanged({ detail }: { detail: Detail }) {
  const { shop } = detail
  return (
    <section aria-labelledby="changed" className="flex flex-col gap-2 rounded-2xl border border-warn/40 bg-warn/5 p-4">
      <h2 id="changed" className="font-semibold text-warn">What changed</h2>
      <p className="text-sm text-muted">Since it was last approved. Check these on the visit.</p>
      <ul className="flex flex-col gap-3">
        {detail.changes.map((c) => (
          <li key={c.field}>
            <ChangeRow change={c} detail={detail} shop={shop} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ChangeRow({ change, detail, shop }: { change: Change; detail: Detail; shop: AdminShop }) {
  if (change.field === 'ownerPhoto' || change.field === 'shopPhoto') {
    const owner = change.field === 'ownerPhoto'
    const what = owner ? 'owner photo' : 'shop photo'
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{change.label}</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Before</span>
            <Photo url={owner ? detail.previousOwnerPhotoUrl : detail.previousShopPhotoUrl} label={`Old ${what}`} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Now</span>
            <Photo url={owner ? shop.ownerPhotoUrl : shop.shopPhotoUrl} label={`New ${what}`} />
          </div>
        </div>
      </div>
    )
  }
  if (change.field === 'location') {
    return (
      <div className="text-sm">
        <p className="font-medium">{change.label}</p>
        <p>{detail.pinMovedMetres !== null ? `Pin moved ${distanceLabel(detail.pinMovedMetres)}` : 'Pin moved'}</p>
        {(change.before || change.after) && (
          <p className="text-muted">
            {change.before ?? '—'} → {change.after ?? '—'}
          </p>
        )}
      </div>
    )
  }
  return (
    <div className="min-w-0 text-sm [overflow-wrap:anywhere]">
      <p className="font-medium">{change.label}</p>
      <p>
        <span className="text-muted line-through">{change.before || '(empty)'}</span>
        <span aria-hidden> → </span>
        <span className="sr-only"> changed to </span>
        <span className="text-ink">{change.after || '(empty)'}</span>
      </p>
    </div>
  )
}

function TimelineItem({ entry }: { entry: TimelineEntry }) {
  return (
    <Card className="flex min-w-0 flex-col gap-2 text-sm [overflow-wrap:anywhere]">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{eventLabel(entry)}</p>
        <time dateTime={entry.at} className="shrink-0 text-xs text-muted">
          {dateTimeIst(entry.at)}
        </time>
      </div>
      {entry.checklist.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Checklist">
          {entry.checklist.map((c) => (
            <li key={c}>
              <Pill tone="warn">{CHECKLIST_LABELS[c] ?? c}</Pill>
            </li>
          ))}
        </ul>
      )}
      {entry.reason && (
        <p>
          <span className="text-muted">Owner was told: </span>"{entry.reason}"
        </p>
      )}
      {entry.note && (
        <div className="rounded-xl border border-dashed border-brand/50 bg-brand/5 px-3 py-2">
          <p className="mb-1 text-xs font-semibold text-brand">Only admins see this</p>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{entry.note}</p>
        </div>
      )}
    </Card>
  )
}
