import type { ReviewReason } from '../../api/types'
import { Pill } from '../../components/ui'
import { languageName, REVIEW_REASON_LABELS, readsText, reviewReasonLabel } from '../../lib/labels'

/**
 * The fixed reasons the owner is told (each in their language), ticked by the team in English. At least one is
 * needed; Other needs a note.
 */
export function ReasonPicker({
  id,
  options,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string
  options: ReviewReason[]
  value: ReviewReason[]
  onChange: (codes: ReviewReason[]) => void
  error?: string | null
  disabled?: boolean
}) {
  function toggle(code: ReviewReason) {
    // Kept in the list's order, whatever order they were ticked in
    const next = value.includes(code) ? value.filter((c) => c !== code) : [...value, code]
    onChange(options.filter((c) => next.includes(c)))
  }
  return (
    <fieldset id={id} className="flex flex-col gap-2" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-2 text-sm font-medium text-muted">What the owner must fix (tick at least one)</legend>
      {options.map((c) => (
        <label key={c} className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-brand"
            checked={value.includes(c)}
            disabled={disabled}
            onChange={() => toggle(c)}
          />
          <span>{REVIEW_REASON_LABELS[c]}</span>
        </label>
      ))}
      {error && (
        <p id={`${id}-error`} className="text-sm text-bad">
          {error}
        </p>
      )}
    </fieldset>
  )
}

/**
 * Above the owner's note: the language the owner reads and that the note goes as written (not translated), so the
 * ticks, which the owner reads in their language, come first. Nothing when no language is saved.
 */
export function ReadsHint({ language }: { language: string | null | undefined }) {
  const reads = readsText(language)
  if (!reads) return null
  return (
    <div className="text-sm">
      <p className="font-medium">{reads}</p>
      <p className="text-muted">
        The note is shown as written; the owner reads {languageName(language)}: write simply or in their language. Prefer the ticks.
      </p>
    </div>
  )
}

/** What the owner was told: the reasons ticked (in English here; the owner read them in their language), then the note. */
export function ToldReasons({ codes, note }: { codes: readonly string[]; note: string | null }) {
  return (
    <>
      {codes.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Reasons ticked">
          {codes.map((c) => (
            <li key={c}>
              <Pill tone="warn">{reviewReasonLabel(c)}</Pill>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-ink [overflow-wrap:anywhere]">"{note}"</p>}
    </>
  )
}
