import { defineConfig } from 'vitest/config'

/**
 * Integration runs talk to a real database, and it is not necessarily a local one.
 *
 * docs/DEVELOPMENT.md offers "a hosted Postgres branch with PostGIS enabled" as a supported
 * option, and against one of those a single round trip costs hundreds of milliseconds rather than
 * the fraction of one that Docker on localhost costs. A test that opens a transaction, inserts two
 * users and asserts on a constraint makes several of those trips and passes five seconds without
 * anything being wrong.
 *
 * The failure was not a slow test reported as slow. Vitest KILLS a test at the timeout, so the
 * `finally` that deletes the reserved rows never ran, and the next run failed on a unique
 * constraint in unrelated tests — a latency problem wearing the costume of a data bug.
 *
 * So the budget is raised only when integration tests were asked for. Unit tests keep the tight
 * default in a normal run, where a five-second test genuinely is a hang worth catching early.
 */
const integration = process.env['LANGGOL_INTEGRATION'] === '1'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'packages/**/*.test.js', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    testTimeout: integration ? 30_000 : 5_000,
    hookTimeout: integration ? 30_000 : 10_000,
    /*
     * Releases the suites' reserved phone numbers before the run. Cheap and inert outside an
     * integration run: it returns before importing Prisma or opening a connection.
     */
    globalSetup: ['./vitest.global-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/domain/src/**/*.ts', 'packages/shared/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/types.ts'],
      /*
       * The money and quantity modules are critical infrastructure and are held to a far higher
       * bar than the rest of the codebase. These thresholds are enforcement, not aspiration.
       */
      thresholds: {
        'packages/domain/src/money/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'packages/domain/src/quantity/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'packages/domain/src/math/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'packages/domain/src/intl/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
})
