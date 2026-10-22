/*
 * Charts for the "Numbers" section. Plain SVG, no library.
 *
 * Every figure here was read from the demo database (ten invented people, orders placed through
 * the real quote and checkout code). They are labelled as demo data on the page.
 *
 * Colours are CSS variables (styles.css), validated with the dataviz palette validator in both
 * themes, so switching theme recolours the charts without redrawing them.
 */

const SVG = 'http://www.w3.org/2000/svg'
const taka = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const fmtTaka = (n) => `৳${taka.format(n)}`

/** Where the buyer's money went, all 40 fulfilled demo orders. Poisha, exact. */
const SPLIT = [
  { key: 'farmer', label: 'Reached the farmer', poisha: 11805482, color: 'var(--viz-1)' },
  { key: 'delivery', label: 'Delivery', poisha: 8529814, color: 'var(--viz-2)' },
  { key: 'commission', label: 'Langgol commission', poisha: 365118, color: 'var(--viz-3)' },
  { key: 'handling', label: 'Handling', poisha: 104620, color: 'var(--viz-4)' },
]

/** What buyers paid per month, cancelled orders excluded. October runs to the 18th. */
const MONTHS = [
  { label: 'Apr', value: 11932 },
  { label: 'May', value: 25324 },
  { label: 'Jun', value: 52326 },
  { label: 'Jul', value: 34619 },
  { label: 'Aug', value: 41527 },
  { label: 'Sep', value: 39066 },
  { label: 'Oct', value: 3256, partial: true },
]

/** Recorded harvest, tonnes, all demo farms. */
const HARVEST = [
  { label: 'Paddy', value: 70.7 },
  { label: 'Tomato', value: 36.2 },
  { label: 'Potato', value: 35.4 },
  { label: 'Mango', value: 33.4 },
  { label: 'Onion', value: 13.7 },
  { label: 'Bottle gourd', value: 12.9 },
  { label: 'Brinjal', value: 11.4 },
  { label: 'Banana', value: 6.5 },
]

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG, name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  if (parent) parent.appendChild(node)
  return node
}

/** A rectangle with only its top corners rounded: the data end, anchored to the baseline. */
function topRounded(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

/** A rectangle with only its right corners rounded, for horizontal bars. */
function rightRounded(x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w)
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`
}

/* ------------------------------------------------------------------ tooltip */

const tip = () => document.getElementById('tooltip')

function bindTip(mark, text) {
  mark.setAttribute('tabindex', '0')
  mark.setAttribute('role', 'img')
  mark.setAttribute('aria-label', text)
  mark.classList.add('mark')
  const show = (x, y) => {
    const t = tip()
    t.textContent = text
    t.hidden = false
    t.style.left = `${x}px`
    t.style.top = `${y}px`
  }
  mark.addEventListener('pointermove', (e) => show(e.clientX, e.clientY))
  mark.addEventListener('pointerleave', () => (tip().hidden = true))
  mark.addEventListener('focus', () => {
    const r = mark.getBoundingClientRect()
    show(r.left + r.width / 2, r.top)
  })
  mark.addEventListener('blur', () => (tip().hidden = true))
}

function tableView(caption, head, rows) {
  const d = document.createElement('details')
  d.className = 'table-view'
  const s = document.createElement('summary')
  s.textContent = 'Show as table'
  d.appendChild(s)
  const t = document.createElement('table')
  t.innerHTML =
    `<caption class="sr-only">${caption}</caption><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`
  d.appendChild(t)
  return d
}

/* ------------------------------------------------------- 1. the taka split */

function renderSplit(root) {
  const width = root.clientWidth
  const total = SPLIT.reduce((s, d) => s + d.poisha, 0)
  const barH = 44
  const gap = 2
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${barH + 4}`,
    height: barH + 4,
    'aria-hidden': 'false',
  })
  svg.setAttribute('role', 'group')
  svg.setAttribute('aria-label', "Share of the buyer's payment by destination")

  const clip = el('clipPath', { id: 'split-clip' }, el('defs', {}, svg))
  el('rect', { x: 0, y: 0, width, height: barH, rx: 6 }, clip)
  const g = el('g', { 'clip-path': 'url(#split-clip)' }, svg)

  const usable = width - gap * (SPLIT.length - 1)
  let x = 0
  for (const d of SPLIT) {
    const share = d.poisha / total
    const w = Math.max(usable * share, 2)
    const rect = el('rect', { x, y: 0, width: w, height: barH }, g)
    rect.style.fill = d.color
    bindTip(rect, `${d.label}: ${fmtTaka(d.poisha / 100)} · ${(share * 100).toFixed(1)}%`)
    // Direct labels only where they fit: the two segments that carry the story.
    if (w > 120) {
      const label = el('text', { x: x + 12, y: barH / 2 + 5 }, svg)
      label.textContent = `${(share * 100).toFixed(1)}%`
      label.style.fill = '#ffffff'
      label.style.fontWeight = '700'
      label.style.fontSize = '14px'
      label.style.pointerEvents = 'none'
    }
    x += w + gap
  }
  root.replaceChildren(svg)

  const legend = document.createElement('ul')
  legend.className = 'legend'
  legend.innerHTML = SPLIT.map(
    (d) =>
      `<li><span class="swatch" style="background:${d.color}"></span><span>${d.label}</span><strong>${fmtTaka(d.poisha / 100)} · ${((d.poisha / total) * 100).toFixed(1)}%</strong></li>`,
  ).join('')
  root.appendChild(legend)
  root.appendChild(
    tableView(
      "Where the buyer's taka went",
      ['Destination', 'Amount', 'Share'],
      SPLIT.map((d) => [
        d.label,
        fmtTaka(d.poisha / 100),
        `${((d.poisha / total) * 100).toFixed(1)}%`,
      ]).concat([['Total paid by buyers', fmtTaka(total / 100), '100%']]),
    ),
  )
}

/* -------------------------------------------------------- 2. sales by month */

function niceMax(v) {
  const step = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / step) * step
}

function renderMonths(root) {
  const width = root.clientWidth
  const height = 240
  const m = { top: 24, right: 4, bottom: 28, left: 52 }
  const innerW = width - m.left - m.right
  const innerH = height - m.top - m.bottom
  const max = niceMax(Math.max(...MONTHS.map((d) => d.value)))
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, height })
  svg.setAttribute('role', 'group')
  svg.setAttribute('aria-label', 'Sales by month, April to October 2026')

  const ticks = 4
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i
    const y = m.top + innerH - (v / max) * innerH
    el(
      'line',
      { x1: m.left, x2: width - m.right, y1: y, y2: y, class: i === 0 ? 'axis-line' : 'grid-line' },
      svg,
    )
    const t = el('text', { x: m.left - 8, y: y + 4, 'text-anchor': 'end' }, svg)
    t.textContent = v === 0 ? '৳0' : `৳${v / 1000}K`
  }

  const band = innerW / MONTHS.length
  const barW = Math.min(36, band * 0.5)
  const peak = MONTHS.reduce((a, b) => (b.value > a.value ? b : a))
  MONTHS.forEach((d, i) => {
    const h = (d.value / max) * innerH
    const x = m.left + band * i + (band - barW) / 2
    const y = m.top + innerH - h
    const bar = el('path', { d: topRounded(x, y, barW, h, 4) }, svg)
    bar.style.fill = 'var(--viz-brand)'
    if (d.partial) bar.style.opacity = '0.5'
    bindTip(bar, `${d.label} 2026${d.partial ? ' (to the 18th)' : ''}: ${fmtTaka(d.value)}`)
    const lbl = el('text', { x: x + barW / 2, y: height - 8, 'text-anchor': 'middle' }, svg)
    lbl.textContent = d.partial ? `${d.label}*` : d.label
    if (d === peak) {
      const v = el(
        'text',
        { x: x + barW / 2, y: y - 8, 'text-anchor': 'middle', class: 'value' },
        svg,
      )
      v.textContent = fmtTaka(d.value)
    }
  })
  root.replaceChildren(svg)
  const note = document.createElement('p')
  note.className = 'chart-card__sub'
  note.textContent = '* October to the 18th, when the demo data was made.'
  root.appendChild(note)
  root.appendChild(
    tableView(
      'Sales by month',
      ['Month (2026)', 'Paid by buyers'],
      MONTHS.map((d) => [d.partial ? `${d.label} (to 18th)` : d.label, fmtTaka(d.value)]),
    ),
  )
}

/* ------------------------------------------------------- 3. harvest by crop */

function renderHarvest(root) {
  const width = root.clientWidth
  const rowH = 30
  const labelW = Math.min(110, width * 0.32)
  const valueW = 56
  const height = HARVEST.length * rowH
  const max = Math.max(...HARVEST.map((d) => d.value))
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, height })
  svg.setAttribute('role', 'group')
  svg.setAttribute('aria-label', 'Recorded harvest by crop, tonnes')

  HARVEST.forEach((d, i) => {
    const y = i * rowH
    const name = el('text', { x: 0, y: y + rowH / 2 + 4 }, svg)
    name.textContent = d.label
    name.style.fill = 'var(--text-2)'
    const w = ((width - labelW - valueW) * d.value) / max
    const bar = el('path', { d: rightRounded(labelW, y + 7, Math.max(w, 2), rowH - 14, 4) }, svg)
    bar.style.fill = 'var(--viz-brand)'
    bindTip(bar, `${d.label}: ${d.value} t`)
    const v = el('text', { x: labelW + w + 8, y: y + rowH / 2 + 4, class: 'value' }, svg)
    v.textContent = `${d.value} t`
  })
  root.replaceChildren(svg)
  root.appendChild(
    tableView(
      'Harvest by crop',
      ['Crop', 'Tonnes'],
      HARVEST.map((d) => [d.label, `${d.value}`]),
    ),
  )
}

/* --------------------------------------------------------------------- init */

export function initCharts() {
  const charts = [
    ['chart-split', renderSplit],
    ['chart-months', renderMonths],
    ['chart-harvest', renderHarvest],
  ]
    .map(([id, fn]) => [document.getElementById(id), fn])
    .filter(([node]) => node)

  const draw = () => charts.forEach(([node, fn]) => fn(node))
  draw()

  // Redraw at the new width; the open/closed state of a table view is kept.
  let last = charts.map(([n]) => n.clientWidth).join()
  new ResizeObserver(() => {
    const now = charts.map(([n]) => n.clientWidth).join()
    if (now === last) return
    last = now
    const open = charts.map(([n]) => n.querySelector('details')?.open)
    draw()
    charts.forEach(([n], i) => {
      const d = n.querySelector('details')
      if (d && open[i]) d.open = true
    })
  }).observe(document.querySelector('.grid--charts'))
}
