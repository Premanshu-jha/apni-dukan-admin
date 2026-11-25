import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTeam } from '../../api/admin'
import { explain, fieldError, isApiError } from '../../api/errors'
import { leadKeys, leadsApi, useLeadHistory } from '../../api/leads'
import type { Lead, LeadEvent, LeadShop, LeadStatus } from '../../api/types'
import { useAdmin } from '../../app/guards'
import { Banner, Button, Chip, Sheet, Spinner, Switch, TextArea } from '../../components/ui'
import { isSuperAdmin } from '../../lib/roles'
import { dateIst, dateOnly, dateTimeIst } from '../../lib/time'
import { LEAD_STATUS_LABELS, leadIn } from './logic'
import { todayIso } from './Leads'

const STATUSES: LeadStatus[] = ['NEW', 'NO_ANSWER', 'CALLED', 'VISITED', 'INTERESTED', 'NOT_INTERESTED']

/** Statuses where someone spoke to the owner: only then can the owner have agreed to WhatsApp. */
const SPOKEN: ReadonlySet<LeadStatus> = new Set(['CALLED', 'VISITED', 'INTERESTED', 'NOT_INTERESTED'])

/** What each status means, shown under the chips. */
const STATUS_HINTS: Record<LeadStatus, string> = {
  NEW: 'Nobody has tried this business yet.',
  NO_ANSWER: 'You tried, but nobody picked up or the shop was shut. Set a call-back date.',
  CALLED: 'You spoke to the owner on the phone.',
  VISITED: 'You went to the shop and met them.',
  INTERESTED: 'They want to join Clozest. Help them sign up.',
  NOT_INTERESTED: 'They said no for now. Add why in the note.',
}

type Field = 'status' | 'note' | 'followUpOn' | 'assignedTo' | 'whatsappOk'

/** YYYY-MM-DD, days after the given one. */
function plusDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Update a lead: status, note, call-back date, who works on it, and the owner's WhatsApp consent. The history is
 * below. A save made on old data (someone else saved meanwhile) shows what they saved and keeps what you typed, so
 * you can check and save again.
 */
export function LeadSheet({
  mapboxId,
  shop,
  title,
  lead: initial,
  onClose,
  onSaved,
}: {
  mapboxId: string
  shop: Pick<LeadShop, 'name' | 'phone' | 'latitude' | 'longitude' | 'pincode' | 'onMapbox'>
  title: string
  lead: Lead | null
  onClose: () => void
  onSaved: (lead: Lead) => void
}) {
  const me = useAdmin()
  const superAdmin = isSuperAdmin(me.adminRole)
  const qc = useQueryClient()
  const [base, setBase] = useState<Lead | null>(initial)
  const [status, setStatus] = useState<LeadStatus>(initial?.status ?? 'NEW')
  const [note, setNote] = useState(initial?.note ?? '')
  const [followUpOn, setFollowUpOn] = useState(initial?.followUpOn ?? '')
  // A field agent saving a new lead takes it by default (they're the one working on it)
  const [assignedTo, setAssignedTo] = useState<string | null>(initial ? (initial.assignedTo?.id ?? null) : superAdmin ? null : me.userId)
  const [whatsappOk, setWhatsappOk] = useState(initial?.whatsappOk ?? false)
  /** Fields the person changed here: after a conflict, the others take what was saved meanwhile. */
  const [touched, setTouched] = useState<ReadonlySet<Field>>(new Set())
  const [askDiscard, setAskDiscard] = useState(false)
  const touch = (f: Field) => setTouched((t) => new Set(t).add(f))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [conflict, setConflict] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const team = useTeam(superAdmin)
  const history = useLeadHistory(mapboxId, showHistory && base !== null)

  const mobile = !!shop.phone && /^[6-9]\d{9}$/.test(shop.phone)
  const canConsent = SPOKEN.has(status) && mobile
  const someoneElse = !superAdmin && base?.assignedTo && base.assignedTo.id !== me.userId ? base.assignedTo : null
  const signedUp = !!base?.signedUpAt
  const today = todayIso()
  // Once tried, a lead can't go back to "Not contacted"
  const statuses = base && base.status !== 'NEW' ? STATUSES.filter((x) => x !== 'NEW') : STATUSES
  const dirty = touched.size > 0

  /** A tap outside or Escape: with changes, ask first, so a slip doesn't lose them. */
  function requestClose() {
    if (dirty && !busy) setAskDiscard(true)
    else onClose()
  }

  async function save() {
    setBusy(true)
    setError(null)
    setConflict(false)
    try {
      const saved = await leadsApi.save(mapboxId, leadIn(shop, base, { status, note, assignedTo, followUpOn: followUpOn || null, whatsappOk: canConsent && whatsappOk }))
      onSaved(saved)
      void qc.invalidateQueries({ queryKey: leadKeys.all })
      onClose()
    } catch (e) {
      if (isApiError(e, 'LEAD_CHANGED')) {
        const now = (e.details.lead as Lead | undefined) ?? null
        setBase(now)
        setConflict(true)
        // What you didn't change here follows what they saved; what you changed stays for you to check
        if (now) {
          if (!touched.has('status')) setStatus(now.status)
          if (!touched.has('note')) setNote(now.note)
          if (!touched.has('followUpOn')) setFollowUpOn(now.followUpOn ?? '')
          if (!touched.has('assignedTo')) setAssignedTo(now.assignedTo?.id ?? null)
          if (!touched.has('whatsappOk')) setWhatsappOk(now.whatsappOk)
          onSaved(now)
        }
      } else {
        setError(e)
      }
    } finally {
      setBusy(false)
    }
  }

  const fieldTeam = (team.data ?? []).filter((m) => m.adminRole === 'SUPER_ADMIN' || m.designation === 'FIELD_AGENT')

  return (
    <Sheet open title={title} onClose={requestClose}>
      <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pb-1">
        {askDiscard && (
          <Banner tone="warn">
            <span className="block">You have changes that aren't saved.</span>
            <span className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={() => setAskDiscard(false)}>
                Keep editing
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Discard changes
              </Button>
            </span>
          </Banner>
        )}
        {base?.signedUpAt && (
          <Banner tone="good">
            Signed up on Clozest on {dateIst(base.signedUpAt)}
            {base.creditedTo ? ` · credit: ${base.creditedTo.name ?? 'someone who left'}` : ''}
          </Banner>
        )}
        {conflict && (
          <Banner tone="warn">
            Someone else changed this lead just now
            {base?.updatedBy?.name ? ` (${base.updatedBy.name})` : ''}: it is now "{base ? LEAD_STATUS_LABELS[base.status] : 'gone'}". Your changes are still here: check them and press
            Save again.
          </Banner>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-muted">Status</legend>
          <div className="flex flex-wrap gap-2">
            {statuses.map((s) => (
              <Chip
                key={s}
                selected={status === s}
                disabled={signedUp && s !== status}
                onClick={() => {
                  setStatus(s)
                  touch('status')
                }}
              >
                {LEAD_STATUS_LABELS[s]}
              </Chip>
            ))}
          </div>
          <p className="text-sm text-muted">{signedUp ? 'It signed up, so its status stays as it is. You can still add notes.' : STATUS_HINTS[status]}</p>
          {status !== 'NEW' && !shop.name && <p className="text-sm text-bad">This lead has no name saved, so it can't be marked contacted.</p>}
        </fieldset>

        <TextArea
          id="lead-note"
          label="Note"
          hint="Who you spoke to, what they said, when to call. Only the team sees it."
          maxLength={500}
          value={note}
          error={fieldError(error, 'note')}
          onChange={(e) => {
            setNote(e.target.value)
            touch('note')
          }}
        />

        <div className="flex flex-col gap-2">
          <label htmlFor="lead-follow-up" className="text-sm font-medium text-muted">
            Call back on
          </label>
          <div className="flex gap-2">
            <input
              id="lead-follow-up"
              type="date"
              min={today}
              value={followUpOn}
              onChange={(e) => {
                setFollowUpOn(e.target.value)
                touch('followUpOn')
              }}
              className="min-h-12 flex-1 rounded-xl border border-line bg-surface px-4 text-base text-ink"
            />
            {followUpOn && (
              <Button
                variant="ghost"
                onClick={() => {
                  setFollowUpOn('')
                  touch('followUpOn')
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['Tomorrow', 1],
                ['In 3 days', 3],
                ['Next week', 7],
              ] as const
            ).map(([label, days]) => (
              <Chip
                key={label}
                selected={followUpOn === plusDays(today, days)}
                onClick={() => {
                  setFollowUpOn(plusDays(today, days))
                  touch('followUpOn')
                }}
              >
                {label}
              </Chip>
            ))}
          </div>
          {followUpOn && followUpOn < today && <p className="text-sm text-warn">Overdue since {dateOnly(followUpOn)}: call them, then pick a new day.</p>}
          {fieldError(error, 'followUpOn') && <p className="text-sm text-bad">Pick today or a later day (within a year).</p>}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-muted">Who works on it</legend>
          {superAdmin ? (
            <select
              aria-label="Assigned to"
              value={assignedTo ?? ''}
              onChange={(e) => {
                setAssignedTo(e.target.value || null)
                touch('assignedTo')
              }}
              className="min-h-12 rounded-xl border border-line bg-surface px-4 text-base text-ink"
            >
              <option value="">Nobody yet</option>
              {base?.assignedTo && !fieldTeam.some((m) => m.userId === base.assignedTo!.id) && (
                <option value={base.assignedTo.id}>{base.assignedTo.name ?? 'Someone who left the team'}</option>
              )}
              {fieldTeam.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === me.userId ? `Me (${m.name ?? 'no name'})` : (m.name ?? `+91 ${m.phone}`)}
                </option>
              ))}
            </select>
          ) : someoneElse ? (
            <p className="text-sm">
              {someoneElse.name ?? 'Someone on the team'} <span className="text-muted">(only a super admin can give it to someone else)</span>
            </p>
          ) : (
            <div className="flex gap-2">
              <Chip
                selected={assignedTo === me.userId}
                onClick={() => {
                  setAssignedTo(me.userId)
                  touch('assignedTo')
                }}
              >
                Me
              </Chip>
              <Chip
                selected={assignedTo === null}
                onClick={() => {
                  setAssignedTo(null)
                  touch('assignedTo')
                }}
              >
                Nobody yet
              </Chip>
            </div>
          )}
        </fieldset>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Owner agreed to WhatsApp messages from Clozest</p>
            <p className="text-sm text-muted">
              {canConsent
                ? 'Tick only if the owner said yes. We record when and who, so offers can be sent later.'
                : mobile
                  ? 'Speak to the owner first (call or visit), then ask.'
                  : 'Needs a mobile number on the lead.'}
            </p>
            {base?.whatsappOk && base.whatsappOkAt && (
              <p className="text-xs text-muted">
                Recorded {dateIst(base.whatsappOkAt)}
                {base.whatsappOkBy?.name ? ` by ${base.whatsappOkBy.name}` : ''}
              </p>
            )}
          </div>
          <Switch
            label="Owner agreed to WhatsApp messages"
            checked={canConsent && whatsappOk}
            disabled={!canConsent}
            onChange={(v) => {
              setWhatsappOk(v)
              touch('whatsappOk')
            }}
          />
        </div>

        {error != null && !conflict && <Banner tone="bad">{saveProblem(error)}</Banner>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" busy={busy} disabled={status !== 'NEW' && !shop.name} onClick={() => void save()}>
            Save
          </Button>
        </div>

        {base && (
          <div className="flex flex-col gap-2">
            <button type="button" className="min-h-11 self-start text-sm font-semibold text-link underline" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? 'Hide history' : 'Show history'}
            </button>
            {showHistory &&
              (history.isPending ? (
                <Spinner small label="Loading history" />
              ) : history.isError ? (
                <p className="text-sm text-bad">{explain(history.error)}</p>
              ) : (
                <ol className="flex flex-col gap-1 text-sm" aria-label="History">
                  {history.data.map((h, i) => (
                    <li key={i} className="text-muted [overflow-wrap:anywhere]">
                      <span className="text-ink">{dateTimeIst(h.at)}</span> · {h.by?.name ?? (h.field === 'SIGNED_UP' ? 'Clozest' : 'Someone')}: {eventText(h)}
                    </li>
                  ))}
                </ol>
              ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}

function saveProblem(e: unknown): string {
  if (isApiError(e, 'LEAD_SIGNED_UP')) return 'This business signed up on Clozest meanwhile, so its status stays as it is. Close and open it again.'
  if (isApiError(e, 'ASSIGNED_TO_SOMEONE_ELSE')) return 'Only a super admin can give this lead to someone else, or take it from them.'
  if (isApiError(e, 'VALIDATION_FAILED')) {
    if (fieldError(e, 'name')) return "This lead has no name, so it can't be marked contacted."
    if (fieldError(e, 'whatsappOk')) return 'WhatsApp consent needs someone who spoke to the owner, and a mobile number.'
    if (fieldError(e, 'status')) return "Once someone tried this business, it can't go back to Not contacted. Pick No answer instead."
    if (fieldError(e, 'followUpOn')) return 'Pick today or a later day for the call-back (within a year).'
    if (fieldError(e, 'assignedTo')) return "That person isn't on the field team any more. Pick someone else."
    if (fieldError(e, 'pincode')) return "This area isn't in India Post's list any more."
  }
  return explain(e)
}

/** One history line in plain words. */
export function eventText(h: LeadEvent): string {
  const s = (v: string | null) => (v && v in LEAD_STATUS_LABELS ? LEAD_STATUS_LABELS[v as LeadStatus] : v)
  switch (h.field) {
    case 'STATUS':
      return h.oldValue ? `${s(h.oldValue)} → ${s(h.newValue)}` : `saved as ${s(h.newValue)}`
    case 'NOTE':
      return h.newValue ? `note: "${h.newValue}"` : 'cleared the note'
    case 'ASSIGNED':
      return h.newValue ? `gave it to ${h.newValue}` : `${h.oldValue ?? 'nobody'} let go of it`
    case 'FOLLOW_UP':
      return h.newValue ? `call back on ${dateOnly(h.newValue)}` : 'cleared the call-back date'
    case 'WHATSAPP':
      return h.newValue === 'true' ? 'owner agreed to WhatsApp' : 'WhatsApp consent removed'
    case 'PHONE':
      return h.newValue ? `phone changed to ${h.newValue} (WhatsApp consent needs asking again)` : 'phone removed'
    case 'SIGNED_UP':
      return `signed up on Clozest as "${h.newValue}"`
  }
}
