/**
 * Assemble the cPanel package from a standalone build.
 *
 *   LANGGOL_STANDALONE=1 pnpm --filter @langgol/web run build
 *   node scripts/package-cpanel.mjs
 *
 * Writes deploy/cpanel/out/langgol_app/:
 *
 *   app.js        Passenger startup file (deploy/cpanel/app.cjs)
 *   package.json  so "Setup Node.js App" accepts the folder. No dependencies: nothing to install
 *   env.txt       settings template, renamed to .env on the server
 *   server/       the Next.js standalone server, its static files and the Prisma engines
 *
 * The server sits in `server/` rather than at the root because CloudLinux's Node.js selector
 * reserves `node_modules` in the application root for a symlink to its own environment, and
 * refuses an application that already has one.
 *
 * Built in CI (.github/workflows/cpanel-package.yml) on Linux. The package must hold NO secret:
 * the repository is public and so are its artifacts.
 *
 * ## node_modules is flattened
 *
 * The standalone output keeps pnpm's layout: every package lives in `node_modules/.pnpm/<id>/`,
 * and finds its dependencies through symlinks beside it. cPanel's archive extraction does not
 * reliably recreate symlinks, and copying the links as real directories breaks resolution — a
 * copied `next` no longer sits beside `styled-jsx`, and fails to start. So the store is hoisted
 * into one plain `server/node_modules`, each package once, which is what an npm install would
 * produce. Once, because two copies of React in one process is a broken application.
 *
 * docs/DEPLOY-CPANEL.md
 */

import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.join(import.meta.dirname, '..')
const standalone = path.join(root, 'apps/web/.next/standalone')
const staticDir = path.join(root, 'apps/web/.next/static')
const prismaClient = path.join(root, 'packages/db/generated/client')
const templates = path.join(root, 'deploy/cpanel')
const out = path.join(root, 'deploy/cpanel/out/langgol_app')

function fail(message) {
  console.error(`package-cpanel: ${message}`)
  process.exit(1)
}

if (!existsSync(path.join(standalone, 'apps/web/server.js'))) {
  fail('no standalone build. Run: LANGGOL_STANDALONE=1 pnpm --filter @langgol/web run build')
}

const pnpmStore = path.join(standalone, 'node_modules/.pnpm')

/** A link into the pnpm store is replaced by the hoisted copy, so it is not followed. */
function pointsIntoStore(link) {
  const target = path.resolve(path.dirname(link), readlinkSync(link))
  return target.startsWith(pnpmStore + path.sep)
}

/**
 * Copy, following any symlink that does not point into the pnpm store (workspace packages).
 *
 * Not `cpSync(..., { dereference: true })`: on Windows pnpm's link to a package directory is
 * created as a FILE symlink, which `stat` refuses with EPERM. Reading the link and following it by
 * hand works on both platforms.
 */
function copyResolved(source, target) {
  const stats = lstatSync(source)
  if (stats.isSymbolicLink()) {
    if (pointsIntoStore(source)) return
    copyResolved(path.resolve(path.dirname(source), readlinkSync(source)), target)
  } else if (stats.isDirectory()) {
    if (source === pnpmStore) return
    mkdirSync(target, { recursive: true })
    for (const name of readdirSync(source)) {
      copyResolved(path.join(source, name), path.join(target, name))
    }
  } else {
    copyFileSync(source, target)
  }
}

/** Package directories directly under a node_modules folder, `@scope/name` included. */
function packagesIn(modulesDir) {
  return readdirSync(modulesDir).flatMap((name) =>
    name.startsWith('@')
      ? readdirSync(path.join(modulesDir, name)).map((inner) => `${name}/${inner}`)
      : [name],
  )
}

function versionOf(packageDir) {
  const manifest = path.join(packageDir, 'package.json')
  return existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).version : undefined
}

rmSync(out, { recursive: true, force: true })

const server = path.join(out, 'server')
copyResolved(standalone, server)

// Hoist the store. Each `.pnpm/<id>/node_modules/` holds the package itself as a real directory
// and its dependencies as links; only the real directory is the package's own copy.
const hoisted = path.join(server, 'node_modules')
const conflicts = []
if (existsSync(pnpmStore)) {
  for (const id of readdirSync(pnpmStore)) {
    const modules = path.join(pnpmStore, id, 'node_modules')
    if (!existsSync(modules)) continue
    for (const name of packagesIn(modules)) {
      const source = path.join(modules, name)
      if (lstatSync(source).isSymbolicLink()) continue
      const target = path.join(hoisted, name)
      if (existsSync(target)) {
        conflicts.push(`${name} ${versionOf(target)} kept, ${versionOf(source)} dropped`)
        continue
      }
      copyResolved(source, target)
    }
  }
}
if (conflicts.length > 0) {
  // Not fatal: today the traced set has one version of everything. If that changes, the dropped
  // version's dependents get the kept one, which may or may not be compatible — look before
  // shipping.
  console.warn(`package-cpanel: more than one version traced:\n  ${conflicts.join('\n  ')}`)
}

// The TypeScript compiler is traced because next.config could be TypeScript. Ours is not, and at
// runtime nothing loads it.
rmSync(path.join(hoisted, 'typescript'), { recursive: true, force: true })

cpSync(staticDir, path.join(server, 'apps/web/.next/static'), { recursive: true })

// File tracing copies the engine for the machine that built it, and only that one. The server
// needs the RHEL builds listed in `binaryTargets`.
const engines = readdirSync(prismaClient).filter((name) => /query_engine.*\.node$/.test(name))
const rhelEngines = engines.filter((name) => name.includes('rhel'))
if (rhelEngines.length === 0) {
  fail(`no RHEL Prisma engine in ${prismaClient}. Run: pnpm db:generate`)
}
for (const name of engines) {
  cpSync(path.join(prismaClient, name), path.join(server, 'packages/db/generated/client', name))
}

// Belt and braces: the build environment's .env must never travel with the package.
function removeEnvFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') removeEnvFiles(full)
    } else if (entry.name === '.env' || entry.name.startsWith('.env.')) {
      rmSync(full)
      console.warn(`package-cpanel: removed ${path.relative(out, full)}`)
    }
  }
}
removeEnvFiles(server)

cpSync(path.join(templates, 'app.cjs'), path.join(out, 'app.js'))
cpSync(path.join(templates, 'env.txt'), path.join(out, 'env.txt'))
writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'langgol-app',
      private: true,
      description: 'Langgol, packaged for cPanel. See env.txt and docs/DEPLOY-CPANEL.md.',
      main: 'app.js',
      engines: { node: '>=22' },
    },
    null,
    2,
  ) + '\n',
)

function sizeOf(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    total += entry.isDirectory() ? sizeOf(full) : statSync(full).size
  }
  return total
}

console.log(`package-cpanel: ${path.relative(root, out)}`)
console.log(`  Prisma engines: ${engines.join(', ')}`)
console.log(`  size: ${(sizeOf(out) / 1024 / 1024).toFixed(1)} MB`)
