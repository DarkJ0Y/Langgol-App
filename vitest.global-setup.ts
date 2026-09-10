/**
 * Release the integration suites' reserved phone numbers before a run.
 *
 * ## The failure this fixes
 *
 * Every integration suite creates users on FIXED phone numbers, runs a test, and deletes them in a
 * `finally`. That is correct right up until a test is killed rather than failed — a timeout, a
 * dropped connection, Ctrl+C. Vitest abandons the test, the `finally` never completes, and the
 * rows survive.
 *
 * From then on every subsequent run fails at setup with "Unique constraint failed on the fields:
 * (`phone`)", in tests that have nothing to do with the one that died, and the message points at
 * the row rather than at the run that leaked it. One timeout poisons the database until somebody
 * works out what happened and deletes the rows by hand.
 *
 * Clearing the block before the run makes each run independent of how the last one ended, which is
 * the property the per-test cleanup was trying and failing to guarantee on its own. That cleanup
 * stays: it keeps the database tidy between tests within a run, and this is the backstop for when
 * it cannot execute.
 *
 * ## What it is allowed to touch
 *
 * Only `+880179…`, which the suites reserve for themselves. Development fixtures live at
 * `+88017000000…` and are outside it; the marketplace seed's rows and any real user are outside it
 * too. The prefix is stated here as one constant rather than inferred from the test files, because
 * a pattern assembled from what happens to exist would silently widen the day somebody adds a
 * number outside the block.
 *
 * Runs only when integration tests were explicitly asked for, and never against a production
 * environment — the guard is a hard refusal rather than a skip, because a production DATABASE_URL
 * reaching this file means something is configured wrong and continuing quietly would be worse.
 */

/**
 * The block the integration suites own. Every reserved number in
 * `packages/infrastructure/src/integration` begins with it.
 */
const RESERVED_PREFIX = '+880179'

export default async function globalSetup(): Promise<void> {
  const requested = process.env['LANGGOL_INTEGRATION'] === '1'
  const databaseUrl = process.env['DATABASE_URL']

  // Not an integration run. The unit suites never touch a database, so there is nothing to do and
  // nothing to connect to.
  if (!requested || databaseUrl === undefined || databaseUrl === '') return

  if (process.env['APP_ENV'] === 'production') {
    throw new Error(
      'Refusing to run integration tests against APP_ENV=production. ' +
        'These suites create and delete rows.',
    )
  }

  // Imported lazily so a plain `pnpm test` never loads the Prisma client or opens a connection.
  const { PrismaClient } = await import('@langgol/db')
  const prisma = new PrismaClient()

  try {
    const stale = await prisma.user.findMany({
      where: { phone: { startsWith: RESERVED_PREFIX } },
      select: { id: true },
    })

    if (stale.length === 0) return

    const ids = stale.map((row) => row.id)

    /*
     * Role assignments first.
     *
     * They cascade from the user they belong to, but `granted_by_id` and `revoked_by_id` are
     * ON DELETE RESTRICT — deliberately, so an audit trail cannot lose the person who acted. A
     * leftover row where one test user granted a role to another therefore blocks the delete of
     * the grantor, and clearing the assignments is what unblocks it.
     */
    await prisma.userRoleAssignment.deleteMany({
      where: {
        OR: [{ userId: { in: ids } }, { grantedById: { in: ids } }, { revokedById: { in: ids } }],
      },
    })

    const removed = await prisma.user.deleteMany({ where: { id: { in: ids } } })

    // Said out loud. A run that silently repaired itself teaches nobody that the previous run died
    // badly, and the count is the signal that something was killed rather than failed.
    console.warn(
      `[integration] released ${String(removed.count)} reserved test user(s) left by an earlier run`,
    )
  } finally {
    await prisma.$disconnect()
  }
}
