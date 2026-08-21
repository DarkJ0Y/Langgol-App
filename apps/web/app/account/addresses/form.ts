/**
 * Parsing the address form.
 *
 * Separate from `actions.ts` so it can be tested. A `'use server'` module may export only async
 * functions, which means the schemas inside one are unreachable from a test — and the bug this
 * file was extracted to fix lived exactly there: the form's hidden coordinate inputs always post
 * a string, so an address with no location posted `""`, the schema rejected it as malformed, and
 * saving an address WITHOUT a pin became impossible. That is the common case in rural Bangladesh
 * and the precise opposite of the requirement.
 *
 * The lesson is encoded here rather than remembered: everything that interprets `FormData` lives
 * in this file, and this file has tests.
 */

import { z } from 'zod'

/**
 * A coordinate as a form sends it.
 *
 * Empty means "no pin", not "invalid". A hidden input with no value posts `""`, never `undefined`,
 * so `.optional()` alone never fires and the regex would run against the empty string.
 */
const CoordinateSchema = z
  .string()
  .trim()
  .refine((value) => value === '' || /^-?\d{1,3}(\.\d+)?$/.test(value), {
    message: 'Not a coordinate',
  })
  .optional()

/** Optional free text. Same reasoning: `""` is absence, not a validation failure. */
const optionalText = (max: number) => z.string().trim().max(max).optional()

export const AddressFormSchema = z.object({
  label: optionalText(40),
  recipientName: z.string().trim().min(1).max(120),
  recipientPhone: z.string().trim().min(1).max(32),
  adminAreaId: z.string().uuid(),
  villageOrArea: optionalText(120),
  addressLine: z.string().trim().min(1).max(250),
  landmark: optionalText(160),
  postalCode: optionalText(8),
  latitude: CoordinateSchema,
  longitude: CoordinateSchema,
  coordinateSource: z.enum(['DEVICE_GPS', 'MAP_PIN', 'NONE']).optional(),
  makeDefault: z.boolean().optional(),
})

export type AddressFormInput = z.infer<typeof AddressFormSchema>

export const IdSchema = z.object({ id: z.string().uuid() })

/** Only send a key when the form actually carried it. */
export function present(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)
  return value === null ? undefined : String(value)
}

/** Read the whole address form into the shape the schema expects. */
export function readAddressForm(formData: FormData): unknown {
  return {
    label: present(formData, 'label'),
    recipientName: present(formData, 'recipientName'),
    recipientPhone: present(formData, 'recipientPhone'),
    adminAreaId: present(formData, 'adminAreaId'),
    villageOrArea: present(formData, 'villageOrArea'),
    addressLine: present(formData, 'addressLine'),
    landmark: present(formData, 'landmark'),
    postalCode: present(formData, 'postalCode'),
    latitude: present(formData, 'latitude'),
    longitude: present(formData, 'longitude'),
    // An empty select posts "", which is not a member of the enum — and means "not stated".
    coordinateSource: present(formData, 'coordinateSource') || undefined,
    makeDefault: formData.get('makeDefault') !== null,
  }
}

/**
 * Resolve what the form said about coordinates.
 *
 *  - `null`        — the form did not mention them; leave whatever is stored alone.
 *  - both `null`   — the user has no pin, or removed the one they had.
 *  - both numbers  — a pin is attached.
 *
 * Never one of each: half a coordinate is not a location, and storing one would put the address
 * on the equator.
 */
export function coordinatesFrom(
  parsed: AddressFormInput,
): { latitude: number | null; longitude: number | null } | null {
  const { latitude, longitude } = parsed
  if (latitude === undefined && longitude === undefined) return null
  if (!latitude || !longitude) return { latitude: null, longitude: null }
  return { latitude: Number(latitude), longitude: Number(longitude) }
}

/** The field a caller should highlight, when the schema rejected something. */
export function firstErrorField(error: z.ZodError): string | undefined {
  const path = error.issues[0]?.path[0]
  return path === undefined ? undefined : String(path)
}
