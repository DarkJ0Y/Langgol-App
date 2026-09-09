/**
 * The mechanics two privacy checks share.
 *
 * `agri-identity/disclosure.ts` decides what may be published on a public profile;
 * `audit/safety.ts` decides what may be stored in the audit log. They are different policies with
 * different lists and they must stay that way — widening one must not silently widen the other.
 *
 * What they legitimately share is the MECHANISM: how an identifier is split into words, and what a
 * Bangladeshi phone number or an identity-length digit run looks like. Those are facts about the
 * data rather than decisions about it, and the P15 audit found each written out twice.
 *
 * So the facts live here and the policies stay apart. A change to this file changes how both
 * checks recognise a shape; a change to either policy's own list changes only that policy.
 *
 * ## Why `shared/redact.ts` is not folded in as well
 *
 * It carries a third copy of the splitter, and it stays there. `@langgol/shared` is a separate
 * package that the domain does not depend on, and reversing that dependency to save nine lines
 * would put a logging utility underneath the business rules. The duplication is the cheaper of the
 * two costs, and it is recorded here rather than left to be rediscovered.
 *
 * Refs: docs/07_SECURITY.md §7, §9, §11
 */

/**
 * Split an identifier into lowercase words.
 *
 * `nidHash` becomes ['nid','hash']; `identity_number` becomes ['identity','number']. Matching on
 * words rather than substrings is what lets a rule catch `farmerPhone` without also catching
 * `telephoneBooth` — or, more to the point, without catching `candidate` on the strength of `id`.
 */
export function wordSegments(name: string): readonly string[] {
  return name
    .split(/[._\-\s]+/)
    .flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/))
    .map((part) => part.toLowerCase())
    .filter(Boolean)
}

/**
 * A Bangladeshi mobile number, however it was spaced or prefixed.
 *
 * Matched against a form with spaces and dashes removed, so `+880 1712 345678` is caught as
 * readily as the bare digits.
 */
export const BD_PHONE_PATTERN = /(?:\+?88)?01[3-9]\d{8}/

/**
 * A digit run long enough to be a national identity number.
 *
 * Ten is the shortest NID in circulation. Deliberately not lower: a four-digit year and a
 * six-digit quantity are ordinary things for a record to carry, and a rule that refused them would
 * be turned off within a week — after which it protects nothing at all.
 */
export const IDENTITY_RUN_PATTERN = /\d{10,}/

/** Whitespace and dashes removed, so formatting cannot smuggle a number past a pattern. */
export const collapse = (value: string): string => value.replace(/[\s-]/g, '')
