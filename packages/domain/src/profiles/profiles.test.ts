/**
 * Role profile tests.
 *
 * The descriptor table is the point of this module — one validator serving six roles — so the
 * tests are written against that property rather than six times over. The cases that matter are:
 *
 *  - the same document is judged identically whichever role presents it,
 *  - a field belonging to another role cannot be written through this one,
 *  - and a blank answer is recorded as absent rather than refused, because a form that will not
 *    save without every box filled is a form nobody finishes.
 */

import { describe, expect, it } from 'vitest'
import {
  PROFILE_FIELDS,
  PROFILE_ROLES,
  ProfileError,
  isProfileRole,
  normalizeBin,
  normalizeTin,
  normalizeTradeLicence,
  profileCompletion,
  validateProfile,
  type ProfileRole,
} from './index.js'
import { isWithinBangladesh } from '../location/index.js'

describe('the roles that carry a profile', () => {
  it('covers the six the platform recognises, and not the farmer', () => {
    // FARMER has its own richer profile from P5; duplicating it here would give it two.
    expect([...PROFILE_ROLES].sort()).toEqual([
      'AGRICULTURAL_EXPERT',
      'CONSUMER',
      'LOGISTICS_PROVIDER',
      'RETAILER',
      'SUPPLIER',
      'WHOLESALER',
    ])
    expect(isProfileRole('FARMER')).toBe(false)
    expect(isProfileRole('ADMIN')).toBe(false)
  })

  it('declares fields for every one of them', () => {
    for (const role of PROFILE_ROLES) {
      expect(PROFILE_FIELDS[role].length).toBeGreaterThan(0)
    }
  })

  it('never asks for a preferred language', () => {
    /*
     * It already lives on `User`, where every role has it. A copy here would be a second answer
     * to the same question, and the two would disagree the first time somebody changed one.
     */
    for (const role of PROFILE_ROLES) {
      expect(PROFILE_FIELDS[role].map((f) => f.name)).not.toContain('preferredLanguage')
    }
  })

  it('never lets a profile set its own verification status', () => {
    // A self-attested verification is not a verification. The absence of a descriptor is what
    // makes it unreachable from a form.
    for (const role of PROFILE_ROLES) {
      expect(PROFILE_FIELDS[role].map((f) => f.name)).not.toContain('verificationStatus')
    }
  })
})

describe('business documents are judged once, not per role', () => {
  const traders: readonly ProfileRole[] = ['RETAILER', 'WHOLESALER', 'SUPPLIER']

  it('asks all three trading roles for the same documents', () => {
    for (const role of traders) {
      const names = PROFILE_FIELDS[role].map((f) => f.name)
      expect(names).toContain('tin')
      expect(names).toContain('bin')
      expect(names).toContain('tradeLicence')
    }
  })

  it('accepts a well-formed TIN identically for each of them', () => {
    for (const role of traders) {
      expect(validateProfile(role, { tin: '123456789012' })).toMatchObject({ tin: '123456789012' })
    }
  })

  it('refuses a malformed TIN identically for each of them', () => {
    /*
     * The regression the shared module exists to prevent: three copies of this rule would drift,
     * and one form would start accepting numbers the other two rejected.
     */
    for (const role of traders) {
      expect(() => validateProfile(role, { tin: '12345' })).toThrow(ProfileError)
    }
  })

  it('strips the formatting a certificate is printed with', () => {
    // People copy the number the way they see it. Rejecting a correct TIN over its spacing is
    // the kind of validation that teaches users to distrust a form.
    expect(normalizeTin('1234 5678 9012')).toBe('123456789012')
    expect(normalizeTin('1234-5678-9012')).toBe('123456789012')
  })

  it('accepts Bangla numerals', () => {
    expect(normalizeTin('১২৩৪৫৬৭৮৯০১২')).toBe('123456789012')
  })

  it('keeps TIN and BIN apart by length, since they are constantly confused', () => {
    expect(normalizeBin('1234567890123')).toBe('1234567890123')
    // A BIN typed into the TIN box is caught here rather than reaching the tax hooks.
    expect(() => normalizeTin('1234567890123')).toThrow()
    expect(() => normalizeBin('123456789012')).toThrow()
  })

  it('is deliberately loose about trade licences', () => {
    /*
     * Every city corporation issues its own format. A strict rule would reject valid licences
     * from whichever districts the author had not seen.
     */
    for (const licence of ['TRAD/DNCC/012345/2024', '99-2201-4455', 'DSCC 7781']) {
      expect(normalizeTradeLicence(licence)).toBe(licence)
    }
    expect(() => normalizeTradeLicence('<script>alert(1)</script>')).toThrow()
  })
})

describe('an unanswered question stays unanswered', () => {
  it('records a blank as null rather than refusing the submission', () => {
    // A shopkeeper filling this in at closing time saves what they know and leaves the rest.
    const changes = validateProfile('RETAILER', {
      businessName: 'Rahim Store',
      tin: '',
      bin: null,
      yearsInBusiness: '',
    })
    expect(changes['businessName']).toBe('Rahim Store')
    expect(changes['tin']).toBeNull()
    expect(changes['bin']).toBeNull()
    expect(changes['yearsInBusiness']).toBeNull()
  })

  it('refuses only the one field a profile cannot be identified without', () => {
    expect(() => validateProfile('RETAILER', { businessName: '   ' })).toThrow(ProfileError)
    expect(() => validateProfile('SUPPLIER', { companyName: '' })).toThrow(ProfileError)
    expect(() => validateProfile('LOGISTICS_PROVIDER', { companyName: '' })).toThrow(ProfileError)
  })

  it('leaves fields the caller never mentioned alone', () => {
    const changes = validateProfile('WHOLESALER', { businessName: 'Karim Traders' })
    expect(Object.keys(changes)).toEqual(['businessName'])
  })
})

describe('a role cannot write another role’s fields', () => {
  it('ignores a field the role does not declare', () => {
    /*
     * The descriptor table is the allowlist. A consultation fee posted to the retailer endpoint
     * is dropped rather than stored — the role has no business having that column.
     */
    const changes = validateProfile('RETAILER', {
      businessName: 'Rahim Store',
      consultationFeePoisha: '5000',
      coldChainAvailable: true,
      warehouseCapacityTonnes: '900',
    })
    expect(Object.keys(changes)).toEqual(['businessName'])
  })
})

describe('per-role rules', () => {
  it('reads a consumer’s dietary preferences from the closed list', () => {
    const changes = validateProfile('CONSUMER', { dietaryPreferences: ['HALAL', 'VEGETARIAN'] })
    expect(changes['dietaryPreferences']).toEqual(['HALAL', 'VEGETARIAN'])
    expect(() => validateProfile('CONSUMER', { dietaryPreferences: ['PALEO'] })).toThrow(
      ProfileError,
    )
  })

  it('lets a consumer name products freely, because a catalogue cannot cover every crop', () => {
    const changes = validateProfile('CONSUMER', { preferredProducts: ['টমেটো', 'Boro rice'] })
    expect(changes['preferredProducts']).toEqual(['টমেটো', 'Boro rice'])
  })

  it('deduplicates a list, since the same entry twice is one entry', () => {
    const changes = validateProfile('CONSUMER', { dietaryPreferences: ['HALAL', 'HALAL'] })
    expect(changes['dietaryPreferences']).toEqual(['HALAL'])
  })

  it('converts an expert’s fee from taka to poisha exactly once', () => {
    // Every amount in this schema is an integer in the smallest unit; the conversion belongs
    // here rather than in whichever screen renders it.
    expect(validateProfile('AGRICULTURAL_EXPERT', { consultationFeePoisha: '500' })).toMatchObject({
      consultationFeePoisha: 50_000,
    })
    expect(validateProfile('AGRICULTURAL_EXPERT', { consultationFeePoisha: '৫০০' })).toMatchObject({
      consultationFeePoisha: 50_000,
    })
  })

  it('treats false as an answer for a logistics operator', () => {
    // An operator without cold chain has answered the question, not skipped it.
    const changes = validateProfile('LOGISTICS_PROVIDER', {
      companyName: 'Padma Movers',
      coldChainAvailable: false,
    })
    expect(changes['coldChainAvailable']).toBe(false)
  })

  it('offers boats, because parts of the country move produce by water', () => {
    const changes = validateProfile('LOGISTICS_PROVIDER', {
      companyName: 'Haor Logistics',
      vehicleTypes: ['BOAT', 'THREE_WHEELER'],
    })
    expect(changes['vehicleTypes']).toEqual(['BOAT', 'THREE_WHEELER'])
  })

  it('refuses an implausible number of years', () => {
    expect(() => validateProfile('RETAILER', { yearsInBusiness: '250' })).toThrow(ProfileError)
    expect(() => validateProfile('AGRICULTURAL_EXPERT', { yearsOfExperience: '1975' })).toThrow(
      ProfileError,
    )
  })

  it('allows nought years, because a new business is a business', () => {
    expect(validateProfile('RETAILER', { yearsInBusiness: '0' })).toMatchObject({
      yearsInBusiness: 0,
    })
  })
})

describe('an address on a profile', () => {
  const UUID = 'b0000000-0000-4000-8000-00000000000b'

  it('is stored as a reference, not as a copy of the street', () => {
    // Somebody who moves corrects one address and everything pointing at it follows. Two copies
    // is how a delivery goes to the old shop.
    expect(validateProfile('CONSUMER', { defaultAddressId: UUID })).toEqual({
      defaultAddressId: UUID,
    })
  })

  it('is asked for by every role the specification gives one', () => {
    const addressField = (role: ProfileRole) =>
      PROFILE_FIELDS[role].find((field) => field.kind.kind === 'address')

    for (const role of ['CONSUMER', 'RETAILER', 'WHOLESALER', 'SUPPLIER'] as const) {
      expect(addressField(role), `${role} has no address field`).toBeDefined()
    }
  })

  it('asks its own question, though three roles share one column', () => {
    /*
     * `address_id` on a retailer is the shop; on a wholesaler and a supplier it is the warehouse.
     * Labelling all three from the column name would be accurate about the storage and useless to
     * the person filling it in.
     */
    const slugOf = (role: ProfileRole) =>
      PROFILE_FIELDS[role].find((field) => field.kind.kind === 'address')?.labelSlug

    expect(slugOf('RETAILER')).toBe('businessAddress')
    expect(slugOf('WHOLESALER')).toBe('warehouseAddress')
    expect(slugOf('SUPPLIER')).toBe('warehouseAddress')
    expect(slugOf('CONSUMER')).toBe('defaultAddress')
  })

  it('refuses anything that is not an id, so a typo never reaches a query', () => {
    expect(() => validateProfile('CONSUMER', { defaultAddressId: 'dhaka' })).toThrow(ProfileError)
  })

  it('is cleared by an empty answer rather than refused', () => {
    expect(validateProfile('CONSUMER', { defaultAddressId: '' })).toEqual({
      defaultAddressId: null,
    })
  })

  it('does not judge WHOSE address it is, because the domain has no database', () => {
    // A well-formed id belonging to a stranger passes here and is refused by the use case. This
    // test exists so that the split stays deliberate rather than becoming a gap.
    expect(() => validateProfile('RETAILER', { addressId: UUID })).not.toThrow()
  })
})

describe('a shop location', () => {
  it('accepts a point in Bangladesh', () => {
    const changes = validateProfile('RETAILER', {
      shopLocation: { latitude: '23.8103', longitude: '90.4125' },
    })
    expect(changes['shopLocation']).toEqual({ latitude: 23.8103, longitude: 90.4125 })
  })

  it('accepts Bangla numerals, because a Bangla keyboard types them', () => {
    const changes = validateProfile('RETAILER', {
      shopLocation: { latitude: '২৩.৮১০৩', longitude: '৯০.৪১২৫' },
    })
    expect(changes['shopLocation']).toEqual({ latitude: 23.8103, longitude: 90.4125 })
  })

  it('treats an empty pair as no answer, since a pin is always optional', () => {
    const changes = validateProfile('RETAILER', {
      shopLocation: { latitude: '', longitude: '' },
    })
    expect(changes['shopLocation']).toBeNull()
  })

  it('treats a box holding only spaces as unanswered, not as zero', () => {
    // `Number(' ')` is 0, which is a real point in the Gulf of Guinea. Trimming before the
    // emptiness test is what keeps a stray space from moving a shop to another continent.
    const changes = validateProfile('RETAILER', {
      shopLocation: { latitude: '   ', longitude: '  ' },
    })
    expect(changes['shopLocation']).toBeNull()
  })

  it('refuses half a pin, because half a coordinate is not a location', () => {
    expect(() =>
      validateProfile('RETAILER', { shopLocation: { latitude: '23.8103', longitude: '' } }),
    ).toThrow(ProfileError)
  })

  it('names the swap separately, because it is the one mistake a person can fix in place', () => {
    /*
     * Latitude and longitude the wrong way round is the commonest coordinate error and the only
     * one fixable by exchanging two boxes. Told apart from a plain out-of-bounds reading, which
     * means going back outside to take the fix again.
     */
    let code: string | undefined
    try {
      validateProfile('RETAILER', { shopLocation: { latitude: '90.4125', longitude: '23.8103' } })
    } catch (error) {
      if (error instanceof ProfileError) code = error.code
    }
    expect(code).toBe('GEO_SWAPPED')
  })

  it('refuses a point outside the country', () => {
    let code: string | undefined
    try {
      // Manipur, well east of the border. The box is a bounding box, not an outline: it does let
      // through a strip of West Bengal, and that is a deliberate trade — a check that clipped the
      // border would reject real shops in Jessore and Sylhet.
      validateProfile('RETAILER', { shopLocation: { latitude: '24.0', longitude: '94.5' } })
    } catch (error) {
      if (error instanceof ProfileError) code = error.code
    }
    expect(code).toBe('GEO_OUT_OF_BOUNDS')
  })

  it('applies the same bounds the address book applies', () => {
    /*
     * The bounds are IMPORTED from the address module rather than restated. This test is what
     * keeps that true: a pin refused when saving an address must be refused when saving a shop.
     */
    const outside = { latitude: 27.5, longitude: 90.0 }
    expect(isWithinBangladesh(outside)).toBe(false)
    expect(() =>
      validateProfile('RETAILER', {
        shopLocation: { latitude: String(outside.latitude), longitude: String(outside.longitude) },
      }),
    ).toThrow(ProfileError)
  })

  it('is not asked of a role that has no shop', () => {
    expect(validateProfile('LOGISTICS_PROVIDER', { shopLocation: { latitude: '23.8' } })).toEqual(
      {},
    )
  })

  it('counts towards completion only once a real point is stored', () => {
    // A row whose latitude and longitude are both null reads back as a null pair, and counting
    // that as answered would show a shop at full marks with no pin ever dropped.
    const withoutPin = profileCompletion('RETAILER', {
      businessName: 'Karim Store',
      shopLocation: null,
    })
    const withPin = profileCompletion('RETAILER', {
      businessName: 'Karim Store',
      shopLocation: { latitude: 23.8103, longitude: 90.4125 },
    })
    expect(withPin.answered).toBe(withoutPin.answered + 1)
  })
})

describe('completion', () => {
  it('measures a role against its own fields, not another role’s', () => {
    const empty = profileCompletion('CONSUMER', {})
    expect(empty.percent).toBe(0)
    expect(empty.total).toBe(PROFILE_FIELDS.CONSUMER.length)
  })

  it('counts false as answered', () => {
    // Otherwise an operator honestly reporting no cold chain is nagged about it forever.
    const completion = profileCompletion('LOGISTICS_PROVIDER', {
      companyName: 'Padma Movers',
      coldChainAvailable: false,
      warehouseAvailable: false,
      vehicleTypes: ['TRUCK'],
    })
    expect(completion.percent).toBe(100)
  })

  it('does not count an empty list as an answer', () => {
    const completion = profileCompletion('LOGISTICS_PROVIDER', {
      companyName: 'Padma Movers',
      vehicleTypes: [],
    })
    expect(completion.answered).toBe(1)
  })
})
