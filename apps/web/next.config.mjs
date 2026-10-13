import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
// Imported rather than assumed: this file is ESM, where `process` is not a global the linter will
// accept, and the explicit import says which `process` is meant.
import process from 'node:process'

/**
 * Load the repository-root `.env` before anything reads the environment.
 *
 * Next reads `.env` from the application directory only. Langgol keeps ONE `.env` at the monorepo
 * root, because the web app, Prisma, the migration runner, the seed and the scripts all have to
 * agree on the same DATABASE_URL — and a second copy under apps/web would be a secret duplicated
 * into a second file that drifts.
 *
 * Without this, `next dev` starts with no DATABASE_URL, no AUTH_SECRET and no JOB_TRIGGER_SECRET,
 * and every page fails with EnvironmentError while `/health` keeps returning 200 because it does
 * not touch the database. That failure is confusing enough on its own; the workaround was to
 * remember `set -a && . ../../.env && set +a` before every single command, which is not something
 * a person should have to remember, and forgetting it looks like a broken application.
 *
 * ## Rules this deliberately keeps
 *
 * A variable already present in the environment WINS. So `FOO=bar next dev` still overrides the
 * file, and a deployment that injects real secrets as environment variables — CI, Vercel, a
 * container — is completely unaffected by whatever happens to sit in a developer's `.env`.
 *
 * This is a loader, not a parser with a specification. It handles `KEY=value`, comments, blank
 * lines and one pair of surrounding quotes. It does not handle multi-line values or interpolation,
 * because `.env.example` does not use them and a half-correct implementation of either would be
 * worse than not having it.
 */
function loadRepositoryRootEnv() {
  const rootEnv = path.join(import.meta.dirname, '../../.env')
  if (!existsSync(rootEnv)) return

  for (const rawLine of readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    // Already set means someone meant it. Never overwrite.
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

loadRepositoryRootEnv()

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The cPanel package (scripts/package-cpanel.mjs) needs a self-contained server: shared hosting
  // cannot run `pnpm install` or `next build` within its memory limits. Opt-in, so the Vercel
  // build is unchanged. docs/DEPLOY-CPANEL.md
  ...(process.env['LANGGOL_STANDALONE'] === '1' ? { output: 'standalone' } : {}),

  // Workspace packages are TypeScript source, compiled by Next rather than pre-built. One less
  // build step, and the app always sees the code in the repository.
  transpilePackages: [
    '@langgol/domain',
    '@langgol/application',
    '@langgol/infrastructure',
    '@langgol/shared',
    '@langgol/i18n',
    '@langgol/ui',
    '@langgol/db',
  ],

  // Prisma must not be bundled into the server build.
  serverExternalPackages: ['@prisma/client'],

  // Pin file tracing to the monorepo. Without this Next walks up from the app directory and, on
  // Windows, hits the protected 'Application Data' junction in the user's home directory.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),

  // Workspace sources use Node16-style '.js' specifiers that point at '.ts' files. tsx and
  // vitest resolve these natively; webpack needs to be told. Without it every cross-package
  // import fails with 'Can't resolve ./client.js'.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
}

export default nextConfig
