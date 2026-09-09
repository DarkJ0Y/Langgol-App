/**
 * Reading a page out of a query string.
 *
 * Shared by every admin list, so pagination behaves identically on all of them and a caller
 * cannot ask one page for ten thousand rows because that page parsed its own parameters.
 *
 * Everything here is defensive about input that arrives from a URL somebody typed: a negative
 * offset, a limit of `NaN`, an array where a string was expected. Each resolves to a sane default
 * rather than reaching the database, because a `LIMIT NaN` is a five hundred and a `LIMIT 100000`
 * is a page that pulls the user table into a server render.
 */

/** Matches the use case's own ceiling. Restated so a screen never offers a page it cannot get. */
export const MAX_PAGE = 50
export const DEFAULT_PAGE = 20

export type Query = Record<string, string | string[] | undefined>

/** One value from a query string, or undefined. Arrays collapse to their first entry. */
export function one(query: Query, key: string): string | undefined {
  const value = query[key]
  const first = Array.isArray(value) ? value[0] : value
  return first === undefined || first === '' ? undefined : first
}

export interface PageParams {
  readonly limit: number
  readonly offset: number
  readonly page: number
}

export function readPaging(query: Query): PageParams {
  const rawLimit = Number(one(query, 'limit') ?? DEFAULT_PAGE)
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), MAX_PAGE)
    : DEFAULT_PAGE

  const rawPage = Number(one(query, 'page') ?? 1)
  const page = Number.isFinite(rawPage) ? Math.max(Math.floor(rawPage), 1) : 1

  return { limit, offset: (page - 1) * limit, page }
}

/** A link to another page, preserving whatever filters are already applied. */
export function pageHref(basePath: string, query: Query, page: number): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (key === 'page') continue
    const first = Array.isArray(value) ? value[0] : value
    if (first !== undefined && first !== '') params.set(key, first)
  }

  params.set('page', String(Math.max(page, 1)))
  return `${basePath}?${params.toString()}`
}

/** How many pages a total spans. At least one, so an empty list still renders sensibly. */
export const pageCount = (total: number, limit: number): number =>
  Math.max(Math.ceil(total / Math.max(limit, 1)), 1)
