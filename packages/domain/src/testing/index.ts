/**
 * Test helpers shared across packages.
 *
 * Exported as `@langgol/domain/testing` so the application and infrastructure suites price
 * against exactly the same configuration the domain suite does — and the same values the seed
 * writes. One fixture, not three copies that drift.
 *
 * Nothing here is imported by production code paths.
 */

export { FIXTURE_ENTRIES, fixtureConfig } from './config-fixture.js'
