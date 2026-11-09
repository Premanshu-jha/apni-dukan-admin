import { useEffect, useRef, useState } from 'react'
import { addPincodes, isPincode, looksLikeAList, MAX_PINCODES, typedPincode } from '../lib/pincodes'
import { Button } from './ui'

/**
 * The pincodes a field agent covers, like a to-do list: type a pincode and tap Add (or press Enter), and it becomes
 * a chip with × to remove it. Only digits can be typed, 6 at most, and Add waits for a valid one. Pasting several
 * at once ("500072, 500085 500049") adds each valid one and says which aren't pincodes. A pincode already in the
 * list isn't added twice: its chip lights up instead. `coveredBy` names others who cover a pincode (a note under its
 * chip; sharing is allowed).
 */
export function PincodeInput({
  id,
  value,
  onChange,
  draft,
  onDraft,
  coveredBy = {},
  error,
}: {
  id: string
  value: string[]
  onChange: (next: string[]) => void
  /** What is typed in the box, kept by the form, so a pincode typed but not yet added isn't lost on Save. */
  draft: string
  onDraft: (text: string) => void
  coveredBy?: Record<string, string[]>
  error?: string
}) {
  const setDraft = onDraft
  const [problem, setProblem] = useState<string | null>(null)
  const [flash, setFlash] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!flash.length) return
    const t = setTimeout(() => setFlash([]), 1500)
    return () => clearTimeout(t)
  }, [flash])

  function add(text: string) {
    const r = addPincodes(value, text)
    if (r.added.length) onChange(r.next)
    setFlash(r.duplicates)
    const problems = [
      r.invalid.length
        ? `${r.invalid.map((p) => `"${p}"`).join(', ')} ${r.invalid.length === 1 ? "isn't a valid pincode" : "aren't valid pincodes"} (6 digits, not starting with 0).`
        : '',
      r.overLimit ? `At most ${MAX_PINCODES} pincodes: ${r.overLimit} not added.` : '',
    ].filter(Boolean)
    setProblem(problems.length ? problems.join(' ') : null)
    setDraft('')
    input.current?.focus()
  }

  const canAdd = isPincode(draft)
  const shown = error ?? problem ?? undefined
  const hintId = `${id}-hint`

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-muted">
          Pincodes they cover
        </label>
        <span className="text-sm text-muted" aria-live="polite">
          {value.length} {value.length === 1 ? 'pincode' : 'pincodes'}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          id={id}
          ref={input}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="500072"
          value={draft}
          aria-invalid={shown ? true : undefined}
          aria-describedby={hintId}
          onChange={(e) => setDraft(typedPincode(e.target.value))}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (!looksLikeAList(text)) return
            e.preventDefault()
            add(text)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()   // never submits the whole form
            if (canAdd) add(draft)
          }}
          className={`min-h-12 min-w-0 flex-1 rounded-xl border bg-surface px-4 text-base text-ink placeholder:text-muted/60 focus:border-brand focus:outline-none ${shown ? 'border-bad' : 'border-line'}`}
        />
        <Button variant="secondary" disabled={!canAdd} onClick={() => add(draft)} aria-label="Add pincode">
          Add
        </Button>
      </div>
      <p id={hintId} aria-live="polite" className={`text-sm ${shown ? 'text-bad' : 'text-muted'}`}>
        {shown ?? 'Type a 6-digit pincode and tap Add. You can paste several at once.'}
      </p>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Pincodes added">
          {value.map((p) => (
            <li key={p} className="flex flex-col gap-1">
              <span
                data-flash={flash.includes(p) || undefined}
                className={`inline-flex min-h-10 items-center gap-1 rounded-xl border pl-3 text-sm font-semibold transition ${flash.includes(p) ? 'border-brand bg-brand/20 ring-2 ring-brand' : 'border-line bg-raised'}`}
              >
                {p}
                <button
                  type="button"
                  aria-label={`Remove ${p}`}
                  onClick={() => {
                    onChange(value.filter((x) => x !== p))
                    input.current?.focus()   // the button goes away: keep the keyboard in the pincode box
                  }}
                  className="flex min-h-10 min-w-10 items-center justify-center rounded-xl text-muted hover:text-ink"
                >
                  ×
                </button>
              </span>
              {coveredBy[p]?.length ? (
                <span className="max-w-40 text-xs text-muted [overflow-wrap:anywhere]">also covered by {coveredBy[p].join(', ')}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
