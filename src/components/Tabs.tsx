/** A row of two or more tabs (Kirana / Salon). */
export function Tabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div role="tablist" aria-label={label} className="grid gap-1 rounded-2xl bg-surface p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-11 rounded-xl text-sm font-semibold transition ${o.value === value ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-raised'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
