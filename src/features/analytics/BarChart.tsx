import { useCallback, useId, useRef, useState } from 'react'

/** The one bar colour: brand blue, checked against the dark surface (lightness band and 3:1 contrast). */
export const BAR = '#6b7fff'

export interface Bar {
  /** the label under the bar and in the tooltip (a day, a month, an hour) */
  label: string
  value: number
  /** the tooltip's text; the label and the value when not given */
  tip?: string
}

/**
 * A single-series column chart in SVG, drawn at the width it is shown at (so its text stays readable on a phone):
 * thin bars (at most 24px) with a 4px rounded end, square at the baseline, a hairline baseline and a few round-number
 * ticks; a value below zero (a month refunded more than it took) goes below the line. Hover or tap a bar for its
 * value; "Show as a table" lists them all (for screen readers and keyboards too: the bars themselves aren't tab stops).
 * One series only, so no legend: the title names it.
 */
export function BarChart({
  title,
  bars,
  format = (n) => n.toLocaleString('en-IN'),
  height = 170,
}: {
  title: string
  bars: Bar[]
  format?: (n: number) => string
  height?: number
}) {
  const id = useId()
  const [width, box] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const max = Math.max(0, ...bars.map((b) => b.value))
  const min = Math.min(0, ...bars.map((b) => b.value))
  const top = niceTop(max)
  const bottom = -niceTop(-min)
  const span = top - bottom || 1
  const ticks = [...(bottom < 0 ? [bottom] : []), 0, ...(top > 0 ? [top / 2, top] : [])]
  const left = 46
  const plotW = Math.max(40, width - left - 8)
  const plotH = height - 30
  const y = (v: number) => 4 + ((top - v) / span) * plotH
  const slot = bars.length ? plotW / bars.length : plotW
  const barW = Math.max(2, Math.min(24, slot - 2))
  // Labels under the bars: about one every 56px, the last one only where it doesn't run into the one before
  const every = Math.max(1, Math.ceil(56 / slot))
  const labelled = (i: number) =>
    i % every === 0 || (i === bars.length - 1 && (i % every) * slot >= 56)
  const shown = hover === null ? null : bars[hover]
  const lowest = bars.reduce((m, b) => Math.min(m, b.value), 0)
  return (
    <figure className="flex flex-col gap-2" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`} className="flex items-center justify-between gap-2 text-sm font-semibold">
        <span>{title}</span>
        <button type="button" className="shrink-0 text-xs font-medium text-link underline" onClick={() => setTable((t) => !t)}>
          {table ? 'Show as a chart' : 'Show as a table'}
        </button>
      </figcaption>
      {table ? (
        <div className="max-h-72 overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <tbody>
              {bars.map((b) => (
                <tr key={b.label} className="border-b border-line last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-muted">
                    {b.label}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{format(b.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative" onMouseLeave={() => setHover(null)}>
          <p className="min-h-5 text-xs text-muted" aria-live="polite">
            {shown ? (shown.tip ?? `${shown.label}: ${format(shown.value)}`) : 'Tap a bar to see its number.'}
          </p>
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block max-w-full"
            role="img"
            aria-label={`${title}: ${bars.length} values, highest ${format(max)}${lowest < 0 ? `, lowest ${format(lowest)}` : ''}. Use Show as a table to read them.`}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={width - 8} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
                <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--color-muted)">
                  {compact(t)}
                </text>
              </g>
            ))}
            {bars.map((b, i) => {
              const x = left + i * slot + (slot - barW) / 2
              const y0 = y(0)
              const h = Math.abs(y(b.value) - y0)
              return (
                <g key={b.label}>
                  {h > 0 && (
                    <path
                      d={b.value >= 0 ? columnUp(x, y0 - h, barW, h) : columnDown(x, y0, barW, h)}
                      fill={BAR}
                      opacity={hover === null || hover === i ? 1 : 0.55}
                    />
                  )}
                  {/* the hit area: the whole slot, taller than the bar; a tap shows the value too */}
                  <rect
                    x={left + i * slot}
                    y={4}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onPointerDown={() => setHover(i)}
                  />
                  {labelled(i) && (
                    <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize={12} fill="var(--color-muted)" pointerEvents="none">
                      {b.label}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      )}
    </figure>
  )
}

/**
 * The width the chart is shown at (a phone's ~330 px, a laptop's wider card), followed as the window changes. A
 * callback ref: the box drawn again (after "Show as a table") is watched, never the old one.
 */
function useWidth(): [number, (el: HTMLDivElement | null) => void] {
  const [width, setWidth] = useState(640)
  const watch = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    watch.current?.disconnect()
    watch.current = null
    if (!el) return
    const read = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width) || 640))
    read()
    if (typeof ResizeObserver === 'undefined') return
    watch.current = new ResizeObserver(read)
    watch.current.observe(el)
  }, [])
  return [width, ref]
}

/** A column up from the baseline: 4px rounded top, square bottom. */
function columnUp(x: number, top: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`
}

/** A column down from the baseline (below zero): square top, 4px rounded bottom. */
function columnDown(x: number, base: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  const end = base + h
  return `M${x},${base}V${end - r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end - r}V${base}Z`
}

/** A round top for the axis: 1, 2 or 5 times a power of ten, at least the highest value. */
export function niceTop(max: number): number {
  if (max <= 0) return 0
  const p = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 2, 5, 10]) if (m * p >= max) return m * p
  return 10 * p
}

/** 1,000 in full under 10,000; 12K, 1.5L (lakh), 2Cr above; a minus sign below zero. */
export function compact(n: number): string {
  if (n < 0) return `−${compact(-n)}`
  if (n < 10_000) return n.toLocaleString('en-IN')
  if (n < 1_00_000) return `${trim(n / 1000)}K`
  if (n < 1_00_00_000) return `${trim(n / 1_00_000)}L`
  return `${trim(n / 1_00_00_000)}Cr`
}

function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString()
}
