/**
 * Turning the profile descriptors into labelled, rendered options.
 *
 * The domain owns which fields exist and which values they accept; the catalogue owns the words.
 * This module is the one place they meet, so a value added to `profiles/catalogue.ts` appears on
 * the form automatically — and a value removed from the domain cannot linger on a screen still
 * offering it.
 *
 * Key convention: `profile.field<Name>` for a question and `profile.opt<VALUE>` for a choice. The
 * option keys are shared across roles on purpose — a truck is a truck whether a wholesaler or a
 * logistics provider is describing one, and two keys for it is two chances to translate it
 * differently.
 *
 * A missing key renders as the key itself (see packages/i18n), which is loud rather than silent.
 */

import type { FieldDescriptor, ProfileRole } from '@langgol/domain/profiles'
import type { MessageKey, Translator } from '@langgol/i18n'

export interface Option {
  readonly value: string
  readonly label: string
}

/** `businessName` → `profile.fieldBusinessName`. */
const fieldKey = (name: string): MessageKey =>
  `profile.field${name.charAt(0).toUpperCase()}${name.slice(1)}` as MessageKey

/**
 * What a field is called, which is not always what its column is called.
 *
 * `labelSlug` wins where the descriptor sets one: three roles keep an address in `address_id` and
 * ask three different questions about it.
 */
const slugOf = (field: FieldDescriptor): string => field.labelSlug ?? field.name

export const fieldLabel = (t: Translator, field: FieldDescriptor): string =>
  t.t(fieldKey(slugOf(field)))

/**
 * The hint under a field, or undefined when it has none.
 *
 * Only the free-text list fields carry one, and they need it: "certifications" without "separate
 * with commas" is a box a person types one sentence into.
 */
export function fieldHint(t: Translator, field: FieldDescriptor): string | undefined {
  const key = `${fieldKey(slugOf(field))}Hint` as MessageKey
  const rendered = t.t(key)
  return rendered === key ? undefined : rendered
}

export const optionLabel = (t: Translator, value: string): string =>
  t.t(`profile.opt${value}` as MessageKey)

export const optionsFor = (t: Translator, values: readonly string[]): readonly Option[] =>
  values.map((value) => ({ value, label: optionLabel(t, value) }))

/**
 * What a stored value looks like in a form control.
 *
 * Everything renders as a string or a string list, because that is what a form field holds.
 * `null` becomes `''`, which is exactly what "not answered" posts back — so a person who clears a
 * box and saves has genuinely cleared it, rather than silently keeping the old answer.
 */
export function initialValue(field: FieldDescriptor, stored: unknown): string | readonly string[] {
  if (field.kind.kind === 'multi') {
    return Array.isArray(stored) ? stored.map(String) : []
  }
  if (field.kind.kind === 'boolean') {
    return stored === true ? 'YES' : stored === false ? 'NO' : ''
  }
  /*
   * A pin renders as its two boxes, in the order they are typed. An unset pin is two empty
   * strings rather than an empty pair, so a person who never dropped one posts back exactly what
   * they were shown and the domain reads it as "still not answered".
   */
  if (field.kind.kind === 'geo') {
    const point = stored as { latitude?: unknown; longitude?: unknown } | null
    if (point === null || point === undefined || typeof point.latitude !== 'number') {
      return ['', '']
    }
    return [String(point.latitude), String(point.longitude)]
  }
  return stored === null || stored === undefined ? '' : String(stored)
}

/** The heading a role's own profile page carries. */
export const roleLabel = (t: Translator, role: ProfileRole): string =>
  t.t(`profile.role${role}` as MessageKey)
