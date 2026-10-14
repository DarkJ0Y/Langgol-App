/**
 * The advisory provider.
 *
 * One interface, so which model answers a farmer's question is a configuration change rather than
 * a refactor — the same discipline as the SMS aggregator and the payout rail. That matters more
 * here than usual: model providers change pricing and deprecate versions on their own schedule,
 * and the alternative to this boundary is `fetch('https://api.openai.com…')` inside a use case.
 *
 * ## What the port promises
 *
 * **It never throws.** A provider outage, a timeout, a refusal, a malformed answer — all of them
 * arrive as a value. A farmer who photographed a diseased plant on a bad connection should be
 * told to try again, not shown an error boundary.
 *
 * **It never returns the image.** The bytes go in and are not part of anything that comes back,
 * because nothing downstream may accidentally persist them. See `domain/advisory/diagnosis.ts`
 * for why the photograph is discarded rather than stored.
 *
 * Refs: docs/03_ARCHITECTURE.md §2.1
 */

import type { Diagnosis } from '@langgol/domain/advisory'
import type { Poisha } from '@langgol/domain/money'

export type AdvisoryFailureReason =
  'NOT_CONFIGURED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_REFUSED' | 'TIMED_OUT' | 'UNREADABLE_ANSWER'

export type AdvisoryResult =
  | { readonly ok: true; readonly diagnosis: Diagnosis }
  | { readonly ok: false; readonly reason: AdvisoryFailureReason; readonly detail?: string }

export interface DiagnoseInput {
  /** The system prompt, already built and versioned by the domain. */
  readonly systemPrompt: string
  /** Raw image bytes. Forwarded, never stored. */
  readonly image: Uint8Array
  readonly contentType: string
  readonly locale: 'bn' | 'en'
  /**
   * What the farmer said about it, in their own words, if anything ("the leaves went yellow from
   * the tips"). Optional and length-limited by the use case. Vision models answer better with it,
   * and a farmer often knows something the photograph cannot show — how fast it spread, what was
   * sprayed last week.
   */
  readonly question?: string | undefined
}

export interface AdvisoryPort {
  /** False when no provider is configured. Callers hide the feature rather than failing it. */
  readonly isAvailable: boolean
  readonly providerName: string

  /**
   * What one diagnosis costs, for the spend breaker.
   *
   * An estimate rather than a measurement — providers bill on tokens, which are not known until
   * the answer exists. It is deliberately the adapter's job to state a conservative figure, since
   * the budget must be a ceiling and an under-estimate would let it be crossed.
   */
  readonly unitCost: Poisha

  diagnose(input: DiagnoseInput): Promise<AdvisoryResult>
}
