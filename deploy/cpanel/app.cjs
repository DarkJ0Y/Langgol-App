/**
 * Startup file for cPanel "Setup Node.js App" (Phusion Passenger). Shipped as `app.js`.
 *
 * Passenger starts this file and takes over whatever port the server listens on, so the Next.js
 * standalone server under `server/` runs unchanged. Two things happen first:
 *
 * 1. `.env` beside this file is loaded. The standalone server does not read it, and putting
 *    secrets in the cPanel form instead would mean retyping all of them on every app recreate.
 *    A variable already in the environment wins, as in apps/web/next.config.mjs.
 *
 * 2. A secret whose value is the word `generate` is replaced with fresh random bytes and written
 *    back to `.env`, once. The host has no Terminal to run `openssl` in, and these must never be
 *    typed by hand or reused between environments. Written back rather than regenerated on each
 *    start: a new AUTH_SECRET signs everyone out, and a new KYC_ENCRYPTION_KEY makes every stored
 *    identity number unreadable.
 *
 * CommonJS on purpose: the application root has no `"type": "module"`, and Passenger's loader
 * `require`s the startup file. The server itself is ESM and is loaded with `import()`.
 *
 * docs/DEPLOY-CPANEL.md
 */

'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ENV_FILE = path.join(__dirname, '.env')

/** Variable → random bytes to generate. Sizes match docs/DEPLOYMENT.md §2. */
const GENERATED_SECRETS = {
  AUTH_SECRET: 48,
  JOB_TRIGGER_SECRET: 48,
  KYC_ENCRYPTION_KEY: 32,
}

function fillGeneratedSecrets(lines) {
  let changed = false
  const filled = lines.map((line) => {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*generate\s*$/.exec(line)
    if (match === null || !(match[1] in GENERATED_SECRETS)) return line
    changed = true
    return `${match[1]}=${crypto.randomBytes(GENERATED_SECRETS[match[1]]).toString('base64')}`
  })
  return { filled, changed }
}

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`[langgol] ${ENV_FILE} not found. Rename env.txt to .env and fill it in.`)
    return
  }

  const text = fs.readFileSync(ENV_FILE, 'utf8')
  const { filled, changed } = fillGeneratedSecrets(text.split(/\r?\n/))
  if (changed) {
    fs.writeFileSync(ENV_FILE, filled.join('\n'), { mode: 0o600 })
    fs.chmodSync(ENV_FILE, 0o600)
    console.log('[langgol] Generated the secrets marked "generate" and saved them to .env.')
  }

  // Same rules as the loader in apps/web/next.config.mjs: KEY=value, comments, blank lines and
  // one pair of surrounding quotes. No multi-line values, no interpolation.
  for (const rawLine of filled) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    if (key === '' || key in process.env) continue

    let value = line.slice(separator + 1).trim()
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    if (quoted) value = value.slice(1, -1)

    process.env[key] = value
  }
}

loadEnvFile()

// The standalone server listens on $HOSTNAME, which a Linux shell sets to the machine's own name.
// Passenger replaces the address with its own socket anyway; outside Passenger (a manual
// `node app.js` to test the package) this keeps the server off public interfaces.
process.env.HOSTNAME = '127.0.0.1'

import(pathToFileURL(path.join(__dirname, 'server', 'apps', 'web', 'server.js')).href).catch(
  (error) => {
    console.error('[langgol] The server failed to start:', error)
    process.exit(1)
  },
)
