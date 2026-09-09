/**
 * The two form field names the browser and the server both need to agree on.
 *
 * They live alone, in a module that imports NOTHING, for one measurable reason: the client
 * component needs them, and a `'use client'` module drags its whole import graph into the bundle.
 * When these sat in `form.ts` — which imports `@langgol/application` to read the descriptor table
 * — the browser was being sent the application layer in order to learn two strings, and this
 * route weighed 17.7 kB against 2–3 kB for every comparable one.
 *
 * On a 2G connection that is not an optimisation; it is the difference between a shopkeeper
 * finishing the form and giving up. Anything the client form imports belongs here, or in a module
 * as bare as this one.
 */

/** The hidden field carrying which of the caller's roles a submitted form is for. */
export const ROLE_FIELD = 'profileRole'

/** The repeated checkbox name carrying the chosen service areas. */
export const SERVICE_AREA_INPUT = 'serviceAreaIds'

/**
 * The two inputs a coordinate pair is typed into.
 *
 * A pin is one answer and two boxes, so the form and the server have to agree on what the boxes
 * are called. Derived from the field name rather than hardcoded, because the descriptor table is
 * allowed to grow a second geo field without this module changing.
 */
export const geoInputName = (field: string, part: 'latitude' | 'longitude'): string =>
  `${field}.${part}`
