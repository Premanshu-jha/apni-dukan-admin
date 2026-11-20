import { useRef, useState } from 'react'
import { adminApi } from '../../api/admin'
import { explain, fieldError, isApiError, isNetwork } from '../../api/errors'
import type { AdminShop, ChecklistItem, ReviewReason, TimelineEntry } from '../../api/types'
import { Banner, Button, Sheet, TextArea } from '../../components/ui'
import { CHECKLIST_LABELS, checklistFor, fixReasonsFor, reviewReasonsFor } from '../../lib/labels'
import {
  checkDecision,
  checkNote,
  clean,
  codePoints,
  DECISION_LABELS,
  NOTE_MAX,
  needsReason,
  optional,
  REASON_MAX,
  reasonFromChecklist,
  type Decision,
  usesReasonCodes,
} from '../../lib/rules'
import { ReadsHint, ReasonPicker } from './ReasonPicker'

/** What the admin has typed for a decision; kept by the page so a reload after a 409 doesn't lose it. */
export interface Draft {
  checklist: ChecklistItem[]
  /** Send back and Ask to fix: the reasons the owner is told (in their language). */
  reasonCodes: ReviewReason[]
  reason: string
  /** The reason was typed by hand: ticking items no longer rewrites it. */
  reasonEdited: boolean
  note: string
}

export const EMPTY_DRAFT: Draft = { checklist: [], reasonCodes: [], reason: '', reasonEdited: false, note: '' }

/** A refusal the page handles itself (it reloads the shop). */
export type Conflict = 'SHOP_CHANGED' | 'WRONG_STATUS'

const CONFIRM_TEXT: Record<Decision, string> = {
  approve: 'The business goes live: customers can find it.',
  reinstate: 'The business comes back for a visit: it waits in "Re-check after edit" until someone approves it.',
  reject: 'The owner gets it back to fix, with the reasons you tick.',
  suspend: 'The business disappears for customers. The owner sees your reason.',
  'ask-to-fix': 'The business stays live and waits here. The owner sees the reasons you tick and fixes it in the app.',
}

/**
 * Approve, Send back, Ask to fix, Suspend or Reinstate one shop, for the version on screen when the sheet opened. Send
 * back and Ask to fix ask for one or more fixed reasons (the owner reads them in their language) and an optional note
 * for the owner (needed with Other); Suspend asks for a checklist and a reason the owner sees (2–200). Each takes an
 * optional internal note (up to 500); Approve and Reinstate only confirm. A double tap sends once.
 */
export function DecisionSheet({
  shop,
  decision,
  version,
  draft,
  onDraft,
  onClose,
  onDone,
  onConflict,
  onUncertain,
  extra,
}: {
  shop: AdminShop
  decision: Decision
  version: number
  draft: Draft
  onDraft: (d: Draft) => void
  onClose: () => void
  onDone: (shop: AdminShop) => void
  onConflict: (c: Conflict, error: unknown) => void
  /** The answer was lost: the page re-reads the shop; true when the decision is seen to have gone through. */
  onUncertain: () => Promise<boolean>
  /** More to say before confirming (Approve with the owner's address request: it is applied too). */
  extra?: string
}) {
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [shown, setShown] = useState(false)
  const withCodes = usesReasonCodes(decision)
  /** Suspend: the checklist and a reason the owner must be given. */
  const withReason = needsReason(decision) && !withCodes
  const errors = checkDecision(decision, draft.reason, draft.note, draft.reasonCodes)
  const label = DECISION_LABELS[decision]

  function toggle(item: ChecklistItem) {
    const checklist = draft.checklist.includes(item) ? draft.checklist.filter((c) => c !== item) : [...draft.checklist, item]
    onDraft({ ...draft, checklist, reason: draft.reasonEdited ? draft.reason : reasonFromChecklist(checklist) })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setShown(true)
    if (sending.current || errors.reasonCodes || errors.reason || errors.note) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const updated = await adminApi.decide(shop.id, decision, {
        version,
        ...(withReason ? { reason: clean(draft.reason), checklist: draft.checklist } : {}),
        ...(withCodes ? { reasonCodes: draft.reasonCodes, reason: optional(draft.reason) } : {}),
        note: optional(draft.note),
      })
      onDone(updated)
    } catch (err) {
      if (isApiError(err, 'SHOP_CHANGED') || isApiError(err, 'WRONG_STATUS')) onConflict(err.code as Conflict, err)
      else if (isNetwork(err) && (await onUncertain())) return
      else setError(err)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Sheet open title={`${label}: #${shop.shopCode} ${shop.name}`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} noValidate className="flex max-h-[75dvh] flex-col gap-4 overflow-y-auto">
        <p className="text-sm text-muted">{CONFIRM_TEXT[decision]}</p>
        {extra && <p className="text-sm font-medium">{extra}</p>}
        {withCodes && (
          <ReasonPicker
            id="decision-reasons"
            // A live re-check is mostly about photos and the video: those first, so Submit isn't far below
            options={decision === 'ask-to-fix' ? fixReasonsFor(shop.type) : reviewReasonsFor(shop.type)}
            value={draft.reasonCodes}
            onChange={(reasonCodes) => onDraft({ ...draft, reasonCodes })}
            disabled={busy}
            error={(shown && errors.reasonCodes) || fieldError(error, 'reasonCodes')}
          />
        )}
        {withCodes && <ReadsHint language={shop.ownerLanguage} />}
        {withCodes && (
          <TextArea
            id="decision-reason"
            label={draft.reasonCodes.includes('OTHER') ? 'Note for the owner' : 'Note for the owner (optional)'}
            value={draft.reason}
            maxLength={REASON_MAX + 50}
            onChange={(e) => onDraft({ ...draft, reason: e.target.value, reasonEdited: true })}
            hint={`The owner sees this under the reasons, as you write it. ${codePoints(clean(draft.reason))}/${REASON_MAX}`}
            error={(shown && errors.reason) || fieldError(error, 'reason')}
          />
        )}
        {withReason && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-muted">What was wrong (tick all that apply)</legend>
            {checklistFor(shop.type).map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-brand"
                  checked={draft.checklist.includes(c)}
                  onChange={() => toggle(c)}
                />
                <span>{CHECKLIST_LABELS[c]}</span>
              </label>
            ))}
          </fieldset>
        )}
        {withReason && (
          <TextArea
            id="decision-reason"
            label="Reason for the owner"
            value={draft.reason}
            maxLength={REASON_MAX + 50}
            onChange={(e) => onDraft({ ...draft, reason: e.target.value, reasonEdited: true })}
            hint={`The owner sees this. ${codePoints(clean(draft.reason))}/${REASON_MAX}`}
            error={(shown && errors.reason) || fieldError(error, 'reason')}
          />
        )}
        <TextArea
          id="decision-note"
          label="Internal note (optional)"
          value={draft.note}
          onChange={(e) => onDraft({ ...draft, note: e.target.value })}
          hint={`Only admins see this. Optional; 2 to ${NOTE_MAX}. ${codePoints(clean(draft.note))}/${NOTE_MAX}`}
          error={(shown && errors.note) || fieldError(error, 'note')}
        />
        {error !== null && <Banner tone="bad">{explain(error)}</Banner>}
        {/* Stays in reach on a phone while the reasons scroll */}
        <div className="sticky bottom-0 -mb-px flex gap-2 border-t border-line bg-surface pt-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={decision === 'approve' || decision === 'reinstate' || decision === 'ask-to-fix' ? 'primary' : 'danger'}
            className="flex-1"
            busy={busy}
          >
            {label}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

/** Add a note to the timeline (any status). Only admins see it. */
export function NoteSheet({
  shop,
  onClose,
  onDone,
}: {
  shop: AdminShop
  onClose: () => void
  onDone: (entry: TimelineEntry) => void
}) {
  const sending = useRef(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const problem = checkNote(note)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setShown(true)
    if (sending.current || problem) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      onDone(await adminApi.addNote(shop.id, clean(note)))
    } catch (err) {
      setError(err)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Sheet open title={`Add a note: #${shop.shopCode}`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextArea
          id="note"
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint={`Only admins see this. ${codePoints(clean(note))}/${NOTE_MAX}`}
          error={(shown && problem) || fieldError(error, 'note')}
        />
        {error !== null && <Banner tone="bad">{explain(error)}</Banner>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" busy={busy}>
            Add note
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
