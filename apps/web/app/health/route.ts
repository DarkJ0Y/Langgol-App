/**
 * Health endpoint.
 *
 * Two distinct questions, because conflating them causes real outages:
 *
 *  - **Liveness** (`/health`) — is the process functioning? A failing liveness check tells an
 *    orchestrator to RESTART. It must therefore never depend on the database: restarting the app
 *    because Postgres is briefly unavailable turns a degraded dependency into a crash loop.
 *  - **Readiness** (`/health?check=ready`) — can this instance serve traffic? A failing readiness
 *    check tells a load balancer to STOP SENDING REQUESTS. This one does check the database.
 *
 * Neither response exposes credentials, environment variables, connection strings, versions of
 * internal dependencies, or a stack trace. A health endpoint is unauthenticated by necessity and
 * is therefore reconnaissance surface.
 *
 * Refs: docs/07_SECURITY.md §9, §11
 */

import { NextResponse } from 'next/server'
import { prisma } from '@langgol/db'
import { env } from '@langgol/shared'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_STORE = { 'cache-control': 'no-store, max-age=0' } as const

export async function GET(request: Request): Promise<NextResponse> {
  const wantsReadiness = new URL(request.url).searchParams.get('check') === 'ready'

  if (!wantsReadiness) {
    // Liveness: the process answered. That is the entire claim.
    return NextResponse.json({ status: 'ok', check: 'live' }, { headers: NO_STORE })
  }

  const checks: Record<string, 'ok' | 'failed'> = {}
  let healthy = true

  try {
    await prisma.$queryRaw`SELECT 1`
    checks['database'] = 'ok'
  } catch {
    // The reason is logged server-side; the response says only that it failed.
    checks['database'] = 'failed'
    healthy = false
  }

  try {
    const [postgis] = await prisma.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS present
    `
    checks['postgis'] = postgis?.present === true ? 'ok' : 'failed'
    if (postgis?.present !== true) healthy = false
  } catch {
    checks['postgis'] = 'failed'
    healthy = false
  }

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      check: 'ready',
      // Safe to expose: which environment and which authentication mode. Both are already
      // evident from behaviour, and knowing them makes an on-call page far faster to triage.
      environment: env().APP_ENV,
      authMode: env().AUTH_MODE,
      checks,
    },
    { status: healthy ? 200 : 503, headers: NO_STORE },
  )
}
