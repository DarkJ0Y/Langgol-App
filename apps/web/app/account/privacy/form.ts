/**
 * Reading the consent form.
 *
 * A plain module, not part of the `'use server'` file, so it can be tested — the same split as
 * `addresses/form.ts`, made for the same reason: schemas trapped inside a server-action file are
 * unreachable from a test runner, and that is exactly where a form-encoding assumption goes wrong
 * unnoticed.
 *
 * The encoding matters here more than usual. **An unchecked checkbox posts nothing at all.** If
 * the parser only looked at what arrived, withdrawing a permission would be indistinguishable
 * from not having submitted it, and a refusal would silently do nothing — the exact failure the
 * "never silently enable" requirement is about, in reverse.
 *
 * So the form declares which permissions it is answering, in a hidden `types` field, and every
 * declared permission gets an explicit answer: present means granted, absent means refused.
 */

/** How a single checkbox is named. Prefixed so it cannot collide with another form field. */
export const CONSENT_FIELD_PREFIX = 'consent:'

export interface ParsedConsentForm {
  readonly answers: readonly { type: string; granted: boolean }[]
}

/**
 * Every permission the form claimed to be answering, with the answer it carried.
 *
 * Returns one entry per declared type — never a subset — so a caller cannot mistake "they
 * unticked it" for "they did not mention it".
 */
export function readConsentForm(formData: FormData): ParsedConsentForm {
  const declared = String(formData.get('types') ?? '')
    .split(',')
    .map((type) => type.trim())
    .filter((type) => type.length > 0)

  // Deduplicated: a repeated hidden field must not produce two contradictory answers.
  const unique = [...new Set(declared)]

  return {
    answers: unique.map((type) => ({
      type,
      granted: formData.get(`${CONSENT_FIELD_PREFIX}${type}`) !== null,
    })),
  }
}
