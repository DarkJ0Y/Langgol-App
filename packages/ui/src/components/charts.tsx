/**
 * Charts, as server-rendered HTML and CSS. No client JavaScript and no chart library.
 *
 * Langgol's screens ship almost no client JS because a farmer on 2G cannot afford it, and a chart
 * library would be the largest download on any page that used one. HTML rather than SVG so text
 * stays crisp and readable at any width — an SVG viewBox shrinks its labels on a phone.
 *
 * The rules these follow (and why) are the data-visualisation method's:
 *  - Thin marks: columns at most 24px wide, 4px rounded at the data end, square at the baseline.
 *  - A 2px surface gap separates touching marks; never a border.
 *  - Hairline, solid, recessive grid; compact round tick values.
 *  - Text never wears the series colour; identity comes from the swatch beside it.
 *  - A legend whenever there are two or more series; selective direct labels.
 *  - Hover AND keyboard focus show a mark's value (CSS, from `data-tip`), and every chart carries
 *    a table view, so no value is reachable only by hovering.
 *  - Colours are role tokens (`--lg-viz-*` in ui.css), selected per theme and run through the
 *    palette validator against the real card surfaces in both modes.
 */

import type { ReactNode } from 'react'

/**
 * Which colour a series wears.
 *
 * - `brand`: the single-series light green.
 * - `a` / `b`: the two-series pair (green, blue), validated as a pair — green and orange failed
 *   the colour-blind separation check.
 * - `1`–`8`: the categorical palette, in its validated fixed order. Never cycled past 8.
 */
export type VizSlot = 'brand' | 'a' | 'b' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

const colour = (slot: VizSlot) => `var(--lg-viz-${String(slot)})`

/* ----------------------------------------------------------------- stat tile */

export interface StatTileProps {
  readonly label: string
  readonly value: string
  /** Signed change against a named period, e.g. "+12% vs last year". */
  readonly delta?: string | undefined
  /** Whether the change is good news, bad news, or neither. Colour AND an arrow say so. */
  readonly deltaTone?: 'good' | 'bad' | 'neutral' | undefined
  readonly hint?: string | undefined
}

export function StatTile({ label, value, delta, deltaTone = 'neutral', hint }: StatTileProps) {
  const arrow = deltaTone === 'good' ? '▲' : deltaTone === 'bad' ? '▼' : '•'
  return (
    <div className="lg-stat">
      <span className="lg-stat__label">{label}</span>
      <span className="lg-stat__value">{value}</span>
      {delta === undefined ? null : (
        <span className={`lg-stat__delta lg-stat__delta--${deltaTone}`}>
          <span aria-hidden="true">{arrow}</span> {delta}
        </span>
      )}
      {hint === undefined ? null : <span className="lg-stat__hint">{hint}</span>}
    </div>
  )
}

export function StatRow({ children }: { readonly children: ReactNode }) {
  return <div className="lg-stat-row">{children}</div>
}

/* --------------------------------------------------------------- chart card */

export interface ChartCardProps {
  readonly title: string
  readonly subtitle?: string | undefined
  readonly children: ReactNode
  /** The same numbers as a table. Rendered behind a disclosure; always present. */
  readonly table?: ReactNode
  readonly tableLabel?: string | undefined
}

export function ChartCard({ title, subtitle, children, table, tableLabel }: ChartCardProps) {
  return (
    <section className="lg-chart-card" aria-label={title}>
      <header className="lg-chart-card__head">
        <h2 className="lg-chart-card__title">{title}</h2>
        {subtitle === undefined ? null : <p className="lg-chart-card__subtitle">{subtitle}</p>}
      </header>
      {children}
      {table === undefined ? null : (
        <details className="lg-chart-card__table">
          <summary>{tableLabel ?? 'Table'}</summary>
          {table}
        </details>
      )}
    </section>
  )
}

/** A plain table for a chart's table view. Numbers right-aligned in tabular figures. */
export function DataTable({
  columns,
  rows,
}: {
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
}) {
  return (
    <table className="lg-data-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, cellIndex) =>
              cellIndex === 0 ? (
                <th key={cellIndex} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={cellIndex}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ----------------------------------------------------------------- legend */

export function Legend({
  items,
}: {
  readonly items: readonly {
    readonly label: string
    readonly slot: VizSlot
    readonly value?: string
  }[]
}) {
  return (
    <ul className="lg-legend">
      {items.map((item) => (
        <li key={item.label}>
          <span className="lg-legend__swatch" style={{ background: colour(item.slot) }} />
          <span className="lg-legend__label">{item.label}</span>
          {item.value === undefined ? null : <span className="lg-legend__value">{item.value}</span>}
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------- column chart */

export interface ColumnSeries {
  readonly label: string
  readonly slot: VizSlot
}

export interface ColumnChartProps {
  readonly series: readonly ColumnSeries[]
  /** One entry per x position; `values` in series order. */
  readonly data: readonly {
    readonly label: string
    readonly values: readonly number[]
    /**
     * Exact text for each value, in series order. Money charts pass this: the numbers above
     * are bar heights only, and a tooltip must show the exact amount, not a rounded height.
     */
    readonly display?: readonly string[]
  }[]
  /** Full value, for tooltips. */
  readonly format: (value: number) => string
  /** Compact value, for axis ticks and the direct label. */
  readonly formatTick: (value: number) => string
  /** Direct-label the last column of the first series (the "now" the reader came for). */
  readonly labelLatest?: boolean | undefined
}

/** Round the axis up to a clean number so ticks land on 0 / 25 / 50 / 75 / 100% of something tidy. */
function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10
  return step * magnitude
}

export function ColumnChart({
  series,
  data,
  format,
  formatTick,
  labelLatest = true,
}: ColumnChartProps) {
  const max = niceMax(Math.max(0, ...data.flatMap((point) => point.values)))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => share * max)

  return (
    <div className="lg-columns">
      {series.length > 1 ? <Legend items={series} /> : null}
      <div className="lg-columns__plot">
        <div className="lg-columns__axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: `${String((tick / max) * 100)}%` }}>
              {formatTick(tick)}
            </span>
          ))}
        </div>
        <div className="lg-columns__grid" aria-hidden="true">
          {ticks.map((tick) => (
            <i key={tick} style={{ bottom: `${String((tick / max) * 100)}%` }} />
          ))}
        </div>
        <ol className="lg-columns__bars">
          {data.map((point, pointIndex) => (
            <li key={point.label} className="lg-columns__group">
              <div className="lg-columns__stack">
                {point.values.map((value, seriesIndex) => {
                  const s = series[seriesIndex]
                  if (s === undefined) return null
                  const tip = `${point.label} · ${s.label}: ${point.display?.[seriesIndex] ?? format(value)}`
                  const isLatest =
                    labelLatest && seriesIndex === 0 && pointIndex === data.length - 1 && value > 0
                  return (
                    <span
                      key={s.label}
                      className="lg-columns__bar"
                      style={{
                        height: `${String(Math.max((value / max) * 100, value > 0 ? 1.5 : 0))}%`,
                        background: colour(s.slot),
                      }}
                      tabIndex={0}
                      role="img"
                      aria-label={tip}
                      data-tip={tip}
                    >
                      {isLatest ? (
                        <b className="lg-columns__value" aria-hidden="true">
                          {formatTick(value)}
                        </b>
                      ) : null}
                    </span>
                  )
                })}
              </div>
              <span className="lg-columns__label">{point.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- horizontal bars */

export function BarList({
  items,
  format,
  slot = 'brand',
}: {
  readonly items: readonly {
    readonly label: string
    readonly value: number
    /** Exact text for the value. Money passes this; `value` is then a bar length only. */
    readonly display?: string
    /** Emphasis: when any item is highlighted, it keeps the colour and the rest go grey. */
    readonly highlight?: boolean
  }[]
  readonly format: (value: number) => string
  readonly slot?: VizSlot
}) {
  const max = Math.max(1, ...items.map((item) => item.value))
  const emphasis = items.some((item) => item.highlight === true)
  return (
    <ul className="lg-barlist">
      {items.map((item) => {
        const text = item.display ?? format(item.value)
        const muted = emphasis && item.highlight !== true
        return (
          <li
            key={item.label}
            className={`lg-barlist__row${item.highlight === true ? ' lg-barlist__row--highlight' : ''}`}
          >
            <span className="lg-barlist__label">{item.label}</span>
            <span className="lg-barlist__track">
              <span
                className="lg-barlist__bar"
                style={{
                  width: `${String(Math.max((item.value / max) * 100, item.value > 0 ? 1.5 : 0))}%`,
                  background: muted ? 'var(--lg-viz-muted)' : colour(slot),
                }}
                tabIndex={0}
                role="img"
                aria-label={`${item.label}: ${text}`}
                data-tip={`${item.label}: ${text}`}
              />
            </span>
            <span className="lg-barlist__value">{text}</span>
          </li>
        )
      })}
    </ul>
  )
}

/* --------------------------------------------------------- part-to-whole */

export function SplitBar({
  segments,
  format,
}: {
  readonly segments: readonly {
    readonly label: string
    readonly value: number
    readonly slot: VizSlot
  }[]
  readonly format: (value: number, share: number) => string
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  if (total <= 0) return null
  return (
    <div className="lg-split">
      <div className="lg-split__bar">
        {segments.map((segment) => {
          const share = segment.value / total
          const tip = `${segment.label}: ${format(segment.value, share)}`
          return (
            <span
              key={segment.label}
              className="lg-split__segment"
              style={{ flexGrow: segment.value, background: colour(segment.slot) }}
              tabIndex={0}
              role="img"
              aria-label={tip}
              data-tip={tip}
            />
          )
        })}
      </div>
      {/* The legend carries every value, so identity and amount are never colour-only. */}
      <Legend
        items={segments.map((segment) => ({
          label: segment.label,
          slot: segment.slot,
          value: format(segment.value, segment.value / total),
        }))}
      />
    </div>
  )
}

/* -------------------------------------------------------------------- meter */

export function Meter({
  label,
  value,
  max,
  caption,
}: {
  readonly label: string
  readonly value: number
  readonly max: number
  readonly caption: string
}) {
  const share = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max))
  return (
    <div className="lg-meter">
      <div className="lg-meter__head">
        <span className="lg-meter__label">{label}</span>
        <span className="lg-meter__caption">{caption}</span>
      </div>
      <span
        className="lg-meter__track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={caption}
      >
        <span className="lg-meter__fill" style={{ width: `${String(share * 100)}%` }} />
      </span>
    </div>
  )
}
