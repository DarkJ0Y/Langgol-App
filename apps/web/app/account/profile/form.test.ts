/**
 * Role profile form parsing tests.
 *
 * The layer between a browser and the domain holds assumptions nothing else can see. The domain
 * tests exercise `validateProfile` and the use-case tests exercise `updateMyRoleProfile`, and
 * neither of them ever meets a `FormData` — so the encoding decisions live here, untested, until
 * a file like this one pins them.
 *
 * The address form learned this the hard way: its coordinate inputs post `""` for "no pin", the
 * schema read `""` as malformed, and saving an address without a location failed for the most
 * common case in rural Bangladesh. The same three shapes are at risk here, and each has a test:
 *
 *  - a multi-select posts REPEATED keys, not one comma-joined value,
 *  - a free-text list posts ONE line that has to be split,
 *  - and a coordinate pair posts TWO boxes that have to be reassembled into one answer.
 *
 * Nothing below asserts whether a value is valid. That is the domain's job, in one place, and a
 * second opinion here is how the two start to disagree.
 */

import { describe, expect, it } from 'vitest'
import { ROLE_FIELD, SERVICE_AREA_INPUT, geoInputName, readProfileForm } from './form'

const ADDRESS = 'b0000000-0000-4000-8000-00000000000b'

/** A form posted for one role, with only the fields a test cares about set. */
function formData(role: string, values: Record<string, string | string[]> = {}): FormData {
  const data = new FormData()
  data.set(ROLE_FIELD, role)
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) for (const entry of value) data.append(key, entry)
    else data.set(key, value)
  }
  return data
}

describe('which role the form is for', () => {
  it('carries the role, so one route can serve all six', () => {
    expect(readProfileForm(formData('RETAILER')).role).toBe('RETAILER')
  })

  it('reads nothing at all for a role that does not exist', () => {
    // The role is untrusted input. An unknown one yields no fields rather than a guess, and the
    // use case refuses it separately.
    const { command } = readProfileForm(formData('PRIME_MINISTER'))
    expect(command.fields).toEqual({})
  })
})

describe('only the role’s own questions are read', () => {
  it('ignores a field belonging to another role', () => {
    /*
     * The descriptor table is the allowlist. Dropping it here keeps a stray value out of the
     * command; the use case drops it again, because one allowlist checked only in the browser is
     * a habit rather than a guarantee.
     */
    const { command } = readProfileForm(
      formData('RETAILER', { businessName: 'Karim Store', consultationFeePoisha: '500' }),
    )
    expect(command.fields['businessName']).toBe('Karim Store')
    expect(command.fields).not.toHaveProperty('consultationFeePoisha')
  })
})

describe('a multi-select posts repeated keys', () => {
  it('collects every ticked box', () => {
    const { command } = readProfileForm(
      formData('LOGISTICS_PROVIDER', { vehicleTypes: ['TRUCK', 'BOAT'] }),
    )
    expect(command.fields['vehicleTypes']).toEqual(['TRUCK', 'BOAT'])
  })

  it('reads none ticked as an empty list, not as a missing answer', () => {
    // An empty list is a person saying "none of these", and it has to survive the round trip or
    // they can never un-tick the last box.
    const { command } = readProfileForm(formData('LOGISTICS_PROVIDER'))
    expect(command.fields['vehicleTypes']).toEqual([])
  })
})

describe('a free-text list posts one line', () => {
  it('splits on commas, because that is how a person types a list', () => {
    const { command } = readProfileForm(
      formData('AGRICULTURAL_EXPERT', { certifications: 'BARI Level 2, IPM Trainer' }),
    )
    expect(command.fields['certifications']).toEqual(['BARI Level 2', 'IPM Trainer'])
  })

  it('splits on the Bangla comma too', () => {
    /*
     * A phone keyboard set to Bangla produces the Arabic comma about as readily as the Latin one.
     * A certification list that silently became one long entry is a bug nobody reports — they
     * just retype it and assume they did it wrong.
     */
    const { command } = readProfileForm(
      formData('AGRICULTURAL_EXPERT', { certifications: 'BARI Level 2، IPM Trainer' }),
    )
    expect(command.fields['certifications']).toEqual(['BARI Level 2', 'IPM Trainer'])
  })

  it('reads an empty box as an empty list rather than one blank entry', () => {
    const { command } = readProfileForm(formData('AGRICULTURAL_EXPERT', { certifications: '' }))
    expect(command.fields['certifications']).toEqual([])
  })
})

describe('a coordinate pair posts two boxes', () => {
  it('reassembles them into one answer', () => {
    const { command } = readProfileForm(
      formData('RETAILER', {
        [geoInputName('shopLocation', 'latitude')]: '23.8103',
        [geoInputName('shopLocation', 'longitude')]: '90.4125',
      }),
    )
    expect(command.fields['shopLocation']).toEqual({
      latitude: '23.8103',
      longitude: '90.4125',
    })
  })

  it('reads two empty boxes as an empty pair, which is what "no pin" posts', () => {
    /*
     * This is the address form's bug, transplanted. Every unfilled input posts an empty string,
     * and a shop without a pin is the ordinary case — so the pair has to arrive intact and be
     * read as "not answered" downstream, never as half a coordinate.
     */
    const { command } = readProfileForm(formData('RETAILER'))
    expect(command.fields['shopLocation']).toEqual({ latitude: '', longitude: '' })
  })

  it('passes a half-filled pair through rather than judging it here', () => {
    // Whether half a pin is allowed is the domain's ruling, made in one place. This layer only
    // has to deliver both boxes so the domain can see what happened.
    const { command } = readProfileForm(
      formData('RETAILER', { [geoInputName('shopLocation', 'latitude')]: '23.8103' }),
    )
    expect(command.fields['shopLocation']).toEqual({ latitude: '23.8103', longitude: '' })
  })
})

describe('an address posts the id it was chosen by', () => {
  it('carries the chosen address through', () => {
    const { command } = readProfileForm(formData('CONSUMER', { defaultAddressId: ADDRESS }))
    expect(command.fields['defaultAddressId']).toBe(ADDRESS)
  })

  it('reads "not answered" as empty, so a person can clear their choice', () => {
    const { command } = readProfileForm(formData('CONSUMER'))
    expect(command.fields['defaultAddressId']).toBe('')
  })
})

describe('service areas', () => {
  it('are read for a role that declares them', () => {
    const { command } = readProfileForm(
      formData('WHOLESALER', { [SERVICE_AREA_INPUT]: ['area-1', 'area-2'] }),
    )
    expect(command.serviceAreaIds).toEqual(['area-1', 'area-2'])
  })

  it('are absent — not empty — for a role that has none', () => {
    /*
     * The distinction is the whole point. `undefined` means "this form did not ask", while an
     * empty array means "the person cleared them" — and a consumer form posting the empty array
     * would wipe a list it never showed.
     */
    const { command } = readProfileForm(formData('CONSUMER'))
    expect(command.serviceAreaIds).toBeUndefined()
  })

  it('are an empty list when a role that has them ticked nothing', () => {
    const { command } = readProfileForm(formData('WHOLESALER'))
    expect(command.serviceAreaIds).toEqual([])
  })
})
