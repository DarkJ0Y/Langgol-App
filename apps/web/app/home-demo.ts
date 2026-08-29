/**
 * ILLUSTRATIVE DATA FOR THE MARKETING PAGE. NOT REAL, NOT LIVE, NOT AN API.
 *
 * The homepage shows a product visualisation, and a visualisation needs numbers. These are those
 * numbers. They are plain constants in one file for three reasons:
 *
 *  1. **Nothing here can reach production data.** There is no fetch, no client, no fallback path
 *     from a failed query into these values — a screen that renders them is rendering constants
 *     and could never mistake them for a farmer's own figures.
 *  2. **They are findable.** When the real endpoints exist, the work is to delete this file and
 *     follow the compiler errors, rather than to hunt for hard-coded numbers across a page.
 *  3. **The page says so.** The hero carries a line telling the reader these are examples, in
 *     both languages, because a plausible dashboard full of invented numbers is a claim.
 *
 * Deliberately NOT exported from any index, so nothing outside the homepage can import it by
 * accident.
 *
 * Refs: the P27 instruction in langgolHomePageAndDash.md — no fake functionality.
 */

export interface DemoMetric {
  readonly key: string
  readonly value: string
  readonly delta: string
  readonly tone: 'up' | 'warn'
  /** A polygon clip-path, so the sparkline needs no SVG path data and no charting library. */
  readonly spark: string
}

/** A closed polygon across 8 sample points, in percentages. Read left to right. */
function spark(points: readonly number[]): string {
  const step = 100 / (points.length - 1)
  const top = points.map((p, i) => `${(i * step).toFixed(1)}% ${(100 - p).toFixed(1)}%`).join(', ')
  return `polygon(${top}, 100% 100%, 0% 100%)`
}

export const DEMO_METRICS: readonly DemoMetric[] = [
  {
    key: 'metricHealth',
    value: '94%',
    delta: '+8.2%',
    tone: 'up',
    spark: spark([40, 46, 52, 49, 63, 71, 80, 94]),
  },
  {
    key: 'metricSoil',
    value: '68%',
    delta: '+3.1%',
    tone: 'up',
    spark: spark([55, 58, 54, 60, 62, 59, 65, 68]),
  },
  {
    key: 'metricWeather',
    value: 'Moderate',
    delta: '3 days',
    tone: 'warn',
    spark: spark([20, 26, 38, 55, 62, 48, 40, 44]),
  },
  {
    key: 'metricDisease',
    value: 'Low',
    delta: '−2.4%',
    tone: 'up',
    spark: spark([48, 44, 40, 36, 30, 28, 24, 20]),
  },
  {
    key: 'metricPrice',
    value: '৳ 2,150',
    delta: '+6.0%',
    tone: 'up',
    spark: spark([52, 50, 58, 61, 57, 66, 72, 78]),
  },
  {
    key: 'metricYield',
    value: '+12%',
    delta: 'vs last season',
    tone: 'up',
    spark: spark([30, 35, 41, 48, 52, 60, 68, 74]),
  },
]

export interface DemoPlot {
  readonly name: string
  readonly crop: string
  readonly cropBn: string
  readonly stage: string
  readonly stageBn: string
  readonly area: string
  readonly health: number
}

export const DEMO_PLOTS: readonly DemoPlot[] = [
  {
    name: 'Plot 01',
    crop: 'Boro rice',
    cropBn: 'বোরো ধান',
    stage: 'Tillering',
    stageBn: 'কুশি',
    area: '2.5 bigha',
    health: 94,
  },
  {
    name: 'Plot 02',
    crop: 'Tomato',
    cropBn: 'টমেটো',
    stage: 'Flowering',
    stageBn: 'ফুল',
    area: '30 decimal',
    health: 81,
  },
  {
    name: 'Plot 03',
    crop: 'Mustard',
    cropBn: 'সরিষা',
    stage: 'Maturing',
    stageBn: 'পাকা',
    area: '1 bigha',
    health: 88,
  },
]

export interface DemoProduct {
  readonly name: string
  readonly nameBn: string
  readonly place: string
  readonly placeBn: string
  readonly price: string
  /** Two colours suggesting the produce, so no stock photography is needed. */
  readonly art: readonly [string, string]
}

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  {
    name: 'Tomato',
    nameBn: 'টমেটো',
    place: 'Rajshahi',
    placeBn: 'রাজশাহী',
    price: '৳ 48 / kg',
    art: ['#b8452f', '#7a2a1c'],
  },
  {
    name: 'Boro rice',
    nameBn: 'বোরো ধান',
    place: 'Dinajpur',
    placeBn: 'দিনাজপুর',
    price: '৳ 2,150 / mon',
    art: ['#c2a15a', '#7d6430'],
  },
  {
    name: 'Potato',
    nameBn: 'আলু',
    place: 'Bogura',
    placeBn: 'বগুড়া',
    price: '৳ 32 / kg',
    art: ['#9a7550', '#57402a'],
  },
  {
    name: 'Mustard',
    nameBn: 'সরিষা',
    place: 'Faridpur',
    placeBn: 'ফরিদপুর',
    price: '৳ 95 / kg',
    art: ['#d8c02f', '#8a7714'],
  },
]

/** The ecosystem participants, keyed to i18n. `core` is Langgol itself. */
export const DEMO_ECOSYSTEM: readonly string[] = [
  'ecoFarmer',
  'ecoConsumer',
  'ecoRetailer',
  'ecoWholesaler',
  'ecoSupplier',
  'ecoExpert',
  'ecoLogistics',
]
