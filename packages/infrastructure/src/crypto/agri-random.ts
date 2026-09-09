/**
 * Random bytes for an AGRI-ID.
 *
 * A one-line adapter, and it exists as its own module for one reason: the port it satisfies is
 * named after what it must be. An AGRI-ID has to come from a CSPRNG and never from a hash of
 * anything the user owns, and a caller wiring something else in has to do so deliberately rather
 * than by reaching for whatever random source was nearest.
 */

import { randomBytes } from 'node:crypto'
import type { AgriIdRandom } from '@langgol/application'

export const agriIdRandom: AgriIdRandom = {
  bytes: (count: number) => new Uint8Array(randomBytes(count)),
}
