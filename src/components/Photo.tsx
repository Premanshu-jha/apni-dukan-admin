import { useEffect, useRef, useState } from 'react'

/**
 * A photo from the backend (its link lasts a few minutes). Tap to see it full screen. A link that has run out
 * says so instead of showing a broken image.
 */
export function Photo({ url, label, className = '' }: { url: string | null; label: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState<string | null>(null)
  const thumb = useRef<HTMLButtonElement>(null)
  const close = useRef<HTMLButtonElement>(null)

  // While enlarged: focus stays on Close (the only control), Escape closes from anywhere, and focus goes back to
  // the thumbnail afterwards.
  useEffect(() => {
    if (!open) return
    const opener = thumb.current
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        close.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [open])

  if (!url) {
    return (
      <div className={`flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-line p-2 text-center text-sm text-muted ${className}`}>
        No {label.toLowerCase()}
      </div>
    )
  }
  if (broken === url) {
    return (
      <div className={`flex aspect-[4/3] items-center justify-center rounded-xl border border-line p-2 text-center text-sm text-muted ${className}`}>
        {label}: the link ran out. Pull to reload the page.
      </div>
    )
  }
  return (
    <>
      <button
        ref={thumb}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${label}, tap to enlarge`}
        className={`block w-full overflow-hidden rounded-xl border border-line ${className}`}
      >
        <img src={url} alt={label} onError={() => setBroken(url)} className="aspect-[4/3] w-full bg-raised object-cover" />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={() => setOpen(false)}>
          <div className="flex items-center justify-between p-2">
            <p className="min-w-0 px-2 font-semibold [overflow-wrap:anywhere]">{label}</p>
            <button ref={close} type="button" onClick={() => setOpen(false)} className="min-h-12 rounded-xl px-4 text-ink hover:bg-raised">
              Close
            </button>
          </div>
          <img src={url} alt={`${label}, large`} className="min-h-0 flex-1 object-contain" />
        </div>
      )}
    </>
  )
}
