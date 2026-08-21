/**
 * `next build`, with the home directory hidden from file tracing on Windows.
 *
 * WHY THIS EXISTS
 *
 * Next runs `@vercel/nft` during the production compile to work out which files each server
 * entrypoint touches. nft evaluates path expressions statically, and the Prisma client runtime
 * builds its engine-cache path from the user's home directory. nft cannot know the rest of that
 * expression, so it widens it to a wildcard and globs the WHOLE home directory — on this
 * machine, `C:\Users\<name>/**\/*`.
 *
 * That is slow everywhere and fatal here: the scan reaches a Docker Desktop socket under
 * `AppData\Local` that Windows will not let a normal process `scandir`, the EACCES surfaces as a
 * webpack compilation error, and the build dies with a misleading
 * "Cannot read properties of undefined (reading 'server')" from the server-actions plugin.
 *
 * The ignore list nft is given comes from `traceIgnores`, which Next hard-codes to `[]` — so
 * `outputFileTracingExcludes` in next.config cannot reach it. Pointing HOME at an empty scratch
 * directory for the duration of the build is the smallest lever that works: the glob still runs,
 * finds nothing, and traces the same set of real files.
 *
 * Build-time only, and Windows-only. It changes nothing the application does at runtime, and
 * POSIX builds run plain `next build`.
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const nextBin = require.resolve('next/dist/bin/next')

const env = { ...process.env }
let scratchHome

if (process.platform === 'win32') {
  scratchHome = mkdtempSync(path.join(tmpdir(), 'langgol-trace-home-'))
  env['USERPROFILE'] = scratchHome
  env['HOME'] = scratchHome
}

const result = spawnSync(process.execPath, [nextBin, 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
})

// Clean up BEFORE exiting: `process.exit` does not unwind, so a `finally` would never run.
if (scratchHome !== undefined) {
  rmSync(scratchHome, { recursive: true, force: true })
}

// A signal death reports no status. Anything that is not a clean 0 is a failure.
process.exit(result.status ?? 1)
