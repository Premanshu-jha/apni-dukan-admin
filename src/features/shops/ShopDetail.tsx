import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { keys, useShopDetail } from '../../api/admin'
import { explain, isApiError } from '../../api/errors'
import type { AdminShop, Change, ShopDetail as Detail, TimelineEntry } from '../../api/types'
import { Photo } from '../../components/Photo'
import { Banner, Button, Card, EmptyState, ErrorState, Loading, Page, Pill } from '../../components/ui'
import { CHECKLIST_LABELS, eventLabel, GROUP_LABELS, STATUS_LABELS, TYPE_LABELS } from '../../lib/labels'
import { directionsUrl, distanceLabel, telUrl } from '../../lib/links'
import { formatPhone } from '../../lib/phone'
import { DECISION_LABELS, decisionsFor, type Decision } from '../../lib/rules'
import { dateIst, dateTimeIst } from '../../lib/time'
import { type Conflict, DecisionSheet, type Draft, EMPTY_DRAFT, NoteSheet } from './DecisionSheet'

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
  const [conflict, setConflict] = useState<Conflict | null>(null)
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

  async function reload() {
    setReloading(true)
    await detail.refetch()
    setReloading(false)
    setConflict(null)
  }

  function decided(decision: Decision, updated: AdminShop) {
    qc.setQueryData<Detail>(keys.shop(id), (old) => (old ? { ...old, shop: updated } : old))
    setDrafts((d) => ({ ...d, [decision]: undefined }))
    setOpen(null)
    setConflict(null)
    setNotice(DONE_TEXT[decision])
    refreshAll()
  }

  function conflicted(c: Conflict) {
    setOpen(null)
    setNotice(null)
    setConflict(c)
    // The status moved on: show it as it is now straight away (its buttons change with it).
    if (c === 'WRONG_STATUS') refreshAll()
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
              onClick={() => {
                setNotice(null)
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
      {conflict === 'SHOP_CHANGED' && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          <p>The owner changed something; reload and check again</p>
          <Button variant="secondary" busy={reloading} onClick={reload}>
            Reload
          </Button>
        </div>
      )}
      {conflict === 'WRONG_STATUS' && (
        <Banner tone="warn">This shop's status changed meanwhile, so that can't be done now. Here is how it is now.</Banner>
      )}
      {notice && <Banner tone="good">{notice}</Banner>}
      {detail.isError && <Banner tone="warn">Couldn't refresh: {explain(detail.error)}</Banner>}

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={shop.status === 'APPROVED' ? 'good' : shop.status === 'SUSPENDED' ? 'bad' : 'warn'}>{STATUS_LABELS[shop.status]}</Pill>
        {shop.group && <Pill tone="muted">{GROUP_LABELS[shop.group]}</Pill>}
        <Pill tone="muted">{TYPE_LABELS[shop.type]}</Pill>
      </div>
      {shop.statusReason && (
        <p className="text-sm text-muted">
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

      <section aria-labelledby="timeline" className="flex flex-col gap-2">
        <h2 id="timeline" className="font-semibold">Timeline</h2>
        {data.timeline.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ol className="flex flex-col gap-2" aria-label="Timeline, newest first">
            {newestFirst(data.timeline).map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <TimelineItem entry={e} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {current && (
        <DecisionSheet
          shop={shop}
          decision={current.decision}
          version={current.version}
          draft={drafts[current.decision] ?? EMPTY_DRAFT}
          onDraft={(d) => setDrafts((all) => ({ ...all, [current.decision]: d }))}
          onClose={() => setOpen(null)}
          onDone={(s) => decided(current.decision, s)}
          onConflict={conflicted}
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
      <dd className="break-words">{children}</dd>
    </>
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
    <div className="text-sm">
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
    <Card className="flex flex-col gap-2 text-sm">
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
          <p className="whitespace-pre-wrap">{entry.note}</p>
        </div>
      )}
    </Card>
  )
}
