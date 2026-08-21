/**
 * Sanity checks on the hand-maintained guarantee scripts.
 *
 * These two `.sql` files are edited every time a phase adds a constraint, and nothing else in the
 * repository can catch a mistake in them: TypeScript does not see SQL, and the only thing that
 * parses them is `psql` — which lives in CI. So a stray character costs a full CI round trip to
 * discover and another to fix.
 *
 * That happened: removing two entries from `expected_rules` left the comma after the entry before
 * them, and the whole script died with `syntax error at or near "]"`. This file makes that class
 * of error fail in `pnpm test`, on the machine where the edit was made.
 *
 * Deliberately NOT a SQL parser. It checks the few things a careless edit actually breaks.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HERE = join(process.cwd(), 'packages/db/prisma/checks')

const SCRIPTS = ['verify-database-guarantees.sql', 'verify-database-behaviour.sql'] as const

function read(name: string): string {
  return readFileSync(join(HERE, name), 'utf8')
}

/** Strip line comments so their brackets and quotes do not count. */
function withoutComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const marker = line.indexOf('--')
      return marker === -1 ? line : line.slice(0, marker)
    })
    .join('\n')
}

describe.each(SCRIPTS)('%s', (name) => {
  const sql = read(name)
  const code = withoutComments(sql)

  it('has no trailing comma before a closing array bracket', () => {
    /*
     * The exact failure. `ARRAY['a', 'b',\n];` is a syntax error, and it is what removing the
     * last element of a list leaves behind.
     */
    expect(code).not.toMatch(/,\s*\n\s*\]/)
  })

  it('has balanced square brackets', () => {
    const open = (code.match(/\[/g) ?? []).length
    const close = (code.match(/\]/g) ?? []).length
    expect(close).toBe(open)
  })

  it('has balanced parentheses', () => {
    const open = (code.match(/\(/g) ?? []).length
    const close = (code.match(/\)/g) ?? []).length
    expect(close).toBe(open)
  })

  it('closes every single-quoted literal', () => {
    // Doubled quotes ('' inside a literal) are removed first so they do not count as one each.
    const quotes = (code.replace(/''/g, '').match(/'/g) ?? []).length
    expect(quotes % 2).toBe(0)
  })

  it('opens and closes the dollar-quoted block', () => {
    expect((code.match(/\$\$/g) ?? []).length % 2).toBe(0)
  })

  it('is still guarded by ON_ERROR_STOP, so a failure fails the build', () => {
    // Without it psql reports success after an error and CI goes green over a broken check.
    expect(sql).toContain('ON_ERROR_STOP')
  })
})

describe('verify-database-guarantees.sql expectations', () => {
  const code = withoutComments(read('verify-database-guarantees.sql'))

  /** Pull the quoted entries out of one `name text[] := ARRAY[ ... ];` declaration. */
  function entriesOf(arrayName: string): string[] {
    const match = new RegExp(`${arrayName}\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([^\\]]*)\\]`, 's').exec(
      code,
    )
    if (match?.[1] === undefined) return []
    return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '')
  }

  const LISTS = [
    'expected_checks',
    'expected_indexes',
    'expected_triggers',
    'expected_rules',
    'expected_restrict_fks',
  ] as const

  it.each(LISTS)('%s is non-empty', (list) => {
    // An accidentally emptied list would make the script pass while checking nothing.
    expect(entriesOf(list).length).toBeGreaterThan(0)
  })

  it.each(LISTS)('%s has no duplicates', (list) => {
    const entries = entriesOf(list)
    expect(new Set(entries).size).toBe(entries.length)
  })

  it('names no object in two different lists', () => {
    // A constraint listed as both a trigger and a rule means one of the two is wrong, and the
    // wrong one silently never gets verified.
    const seen = new Map<string, string>()
    for (const list of LISTS) {
      for (const entry of entriesOf(list)) {
        const previous = seen.get(entry)
        expect(previous, `${entry} appears in both ${String(previous)} and ${list}`).toBeUndefined()
        seen.set(entry, list)
      }
    }
  })

  it('still verifies that PostGIS is installed', () => {
    expect(code).toContain('postgis')
  })
})
