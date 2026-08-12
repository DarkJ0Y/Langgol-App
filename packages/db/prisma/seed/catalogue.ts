/**
 * The curated product catalogue — reference data, seeded in every environment.
 *
 * Farmers pick from this list; they do not type free text. That constraint is what makes search,
 * price observations and the delivered-cost engine work at all: the engine needs perishability
 * and shelf life to model spoilage, and `PriceObservation` matching needs a stable product id.
 *
 * `searchTerms` carries transliterations so a buyer typing `tomato`, `টমেটো` or `tometo` all land
 * on the same product. Over a curated list this is a solved problem; over free text in two
 * scripts it is not.
 *
 * Shelf-life hours are PROVISIONAL and must be replaced with agronomist-reviewed figures before
 * the spoilage model is trusted — they currently drive an expected-cost line.
 *
 * Refs: docs/02_DATABASE.md §6, §15; docs/04_MARKETPLACE.md §10
 */

export interface ProductSeed {
  readonly slug: string
  readonly nameEn: string
  readonly nameBn: string
  readonly searchTerms: readonly string[]
  readonly baseUnit: 'MILLIGRAM' | 'MILLILITRE' | 'PIECE'
  readonly defaultSaleUnit: 'KG' | 'PIECE' | 'DOZEN' | 'LITRE'
  readonly perishability: 'HIGHLY_PERISHABLE' | 'PERISHABLE' | 'SEMI_DURABLE' | 'DURABLE'
  readonly defaultShelfLifeHours: number
}

export interface CategorySeed {
  readonly slug: string
  readonly nameEn: string
  readonly nameBn: string
  readonly sortOrder: number
  readonly products: readonly ProductSeed[]
}

export const CATALOGUE: readonly CategorySeed[] = [
  {
    slug: 'vegetables',
    nameEn: 'Vegetables',
    nameBn: 'সবজি',
    sortOrder: 1,
    products: [
      {
        slug: 'tomato',
        nameEn: 'Tomato',
        nameBn: 'টমেটো',
        searchTerms: ['tomato', 'টমেটো', 'tometo', 'tomatoe'],
        baseUnit: 'MILLIGRAM',
        defaultSaleUnit: 'KG',
        perishability: 'HIGHLY_PERISHABLE',
        defaultShelfLifeHours: 96,
      },
      {
        slug: 'potato',
        nameEn: 'Potato',
        nameBn: 'আলু',
        searchTerms: ['potato', 'আলু', 'alu', 'aloo'],
        baseUnit: 'MILLIGRAM',
        defaultSaleUnit: 'KG',
        perishability: 'SEMI_DURABLE',
        defaultShelfLifeHours: 2160,
      },
      {
        slug: 'onion',
        nameEn: 'Onion',
        nameBn: 'পেঁয়াজ',
        searchTerms: ['onion', 'পেঁয়াজ', 'peyaj', 'piaj'],
        baseUnit: 'MILLIGRAM',
        defaultSaleUnit: 'KG',
        perishability: 'SEMI_DURABLE',
        defaultShelfLifeHours: 1440,
      },
      {
        slug: 'brinjal',
        nameEn: 'Brinjal',
        nameBn: 'বেগুন',
        searchTerms: ['brinjal', 'eggplant', 'বেগুন', 'begun'],
        baseUnit: 'MILLIGRAM',
        defaultSaleUnit: 'KG',
        perishability: 'HIGHLY_PERISHABLE',
        defaultShelfLifeHours: 72,
      },
      {
        slug: 'bottle-gourd',
        nameEn: 'Bottle gourd',
        nameBn: 'লাউ',
        searchTerms: ['bottle gourd', 'lau', 'লাউ'],
        baseUnit: 'MILLIGRAM',
        defaultSaleUnit: 'KG',
        perishability: 'PERISHABLE',
        defaultShelfLifeHours: 240,
      },
    ],
  },
  {
    slug: 'fruit',
    nameEn: 'Fruit',
    nameBn: 'ফল',
    sortOrder: 2,
    products: [
      {
        slug: 'mango',
        nameEn: 'Mango',
        nameBn: 'আম',
        searchTerms: ['mango', 'আম', 'aam', 'am'],
        baseUnit: 'MILLIGRAM',
        defaultSaleUnit: 'KG',
        perishability: 'HIGHLY_PERISHABLE',
        defaultShelfLifeHours: 120,
      },
      {
        slug: 'banana',
        nameEn: 'Banana',
        nameBn: 'কলা',
        searchTerms: ['banana', 'কলা', 'kola', 'kola'],
        baseUnit: 'PIECE',
        defaultSaleUnit: 'DOZEN',
        perishability: 'PERISHABLE',
        defaultShelfLifeHours: 168,
      },
    ],
  },
  {
    slug: 'grain',
    nameEn: 'Grain',
    nameBn: 'শস্য',
    sortOrder: 3,
    products: [
      {
        slug: 'rice-paddy',
        nameEn: 'Paddy',
        nameBn: 'ধান',
        searchTerms: ['paddy', 'dhan', 'ধান', 'rice'],
        baseUnit: 'MILLIGRAM',
        defaultSaleUnit: 'KG',
        perishability: 'DURABLE',
        defaultShelfLifeHours: 8760,
      },
    ],
  },
]
