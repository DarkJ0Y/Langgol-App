/**
 * Reading a role profile form.
 *
 * Separate from the server action so it can be tested without a request, and driven by the same
 * descriptor table the validator and the form controls are driven by. Adding a field to a role is
 * still a single line in `packages/domain/src/profiles/schema.ts` — this module needs no edit.
 *
 * It does no validating. Every value is handed to the domain exactly as the browser posted it,
 * except for the two shape conversions a form cannot avoid: a multi-select posts repeated keys,
 * and a free-text list posts one comma-separated line. Judging the values is `validateProfile`'s
 * job, in one place.
 */

import { roleProfileFields } from '@langgol/application'
import { ROLE_FIELD, SERVICE_AREA_INPUT, geoInputName } from './fields'
import { ROLES_WITH_SERVICE_AREA, type ProfileRole } from '@langgol/domain/profiles'
import type { UpdateRoleProfileCommand } from '@langgol/application'

// Declared in `fields.ts`, which imports nothing, so the client form can read them without also
// being sent this module's dependencies. Re-exported so a server-side caller has one import.
export { ROLE_FIELD, SERVICE_AREA_INPUT, geoInputName } from './fields'

/**
 * Split a free-text list.
 *
 * Both comma types: a person typing Bangla on a phone keyboard produces `،`-adjacent characters
 * about as often as `,`, and a certification list that silently became one long entry because of
 * the wrong comma is a bug nobody reports, they just retype it.
 */
const splitList = (raw: string): readonly string[] =>
  raw
    .split(/[,،⹁\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')

export function readProfileForm(formData: FormData): {
  readonly role: string
  readonly command: UpdateRoleProfileCommand
} {
  const role = String(formData.get(ROLE_FIELD) ?? '')
  const fields: Record<string, unknown> = {}

  /*
   * Only the role's own fields are read. A `consultationFeePoisha` posted to the retailer form
   * never reaches the use case — and the use case drops it again, because one allowlist that is
   * also checked server-side is a guarantee, while one that is only checked here is a habit.
   */
  for (const field of roleProfileFields(role)) {
    if (field.kind.kind === 'multi') {
      fields[field.name] =
        field.kind.options.length > 0
          ? formData.getAll(field.name).map(String)
          : splitList(String(formData.get(field.name) ?? ''))
      continue
    }

    /*
     * Two boxes, one answer. Assembled rather than judged: whether the pair is complete, inside
     * Bangladesh, or written the wrong way round is the domain's question, and answering it here
     * as well would give the rule a second home to drift in.
     */
    if (field.kind.kind === 'geo') {
      fields[field.name] = {
        latitude: String(formData.get(geoInputName(field.name, 'latitude')) ?? ''),
        longitude: String(formData.get(geoInputName(field.name, 'longitude')) ?? ''),
      }
      continue
    }

    fields[field.name] = String(formData.get(field.name) ?? '')
  }

  /*
   * Service areas are sent only by the roles that have them, and `undefined` means "not part of
   * this form" rather than "clear them" — the difference matters, because a consumer form that
   * posted an empty list would wipe a list it never showed.
   */
  const hasServiceArea = (ROLES_WITH_SERVICE_AREA as readonly string[]).includes(role)
  const serviceAreaIds = hasServiceArea
    ? formData.getAll(SERVICE_AREA_INPUT).map(String).filter(Boolean)
    : undefined

  return {
    role,
    command: {
      fields,
      ...(serviceAreaIds === undefined ? {} : { serviceAreaIds }),
    },
  }
}

/** Whether a role's form should render the service-area picker. */
export const hasServiceArea = (role: ProfileRole): boolean =>
  (ROLES_WITH_SERVICE_AREA as readonly string[]).includes(role)
