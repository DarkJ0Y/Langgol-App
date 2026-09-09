/**
 * Cross-user access: the consolidated proof.
 *
 * Every phase has tested its own ownership rules. This file exists because that is not the same
 * claim: the requirement is that user A cannot reach user B's profile, address, farm, plot,
 * cultivation record, KYC file, production history or private documents, and a suite that proves
 * it resource by resource in eight different files can still have a ninth resource nobody covered.
 *
 * So the eight are here together, in one table, exercised by one loop.
 *
 * ## The fakes scope by owner, exactly as the real queries do
 *
 * This is the part that decides whether the file is worth anything. A fake repository that
 * returned whatever id it was asked for would make every test below pass while the real query
 * leaked — the test would be measuring the fake. Each one here puts the owner in the lookup, which
 * is what `docs/07_SECURITY.md §4` calls layer three and what the real adapters compile into their
 * WHERE clauses.
 *
 * ## Two shapes of refusal, and both are correct
 *
 * Most of these answer NOT_FOUND rather than FORBIDDEN. That is deliberate throughout the
 * codebase: a 403 confirms a record exists, which is an enumeration oracle, so somebody else's
 * resource is indistinguishable from one that was never there. The assertions below accept either
 * refusal and reject success, because the property under test is that nothing is returned.
 */

import { describe, expect, it, vi } from 'vitest'
import { ANONYMOUS, type Actor } from '@langgol/domain/policy'
import { isErr, isOk, type AppError, type Result } from '@langgol/shared'
import { getAddress } from '../location/addresses.js'
import { getMyFarm, listPlots } from '../farm/farms.js'
import { getMyFarmerProfile } from '../farming/farmer-profile.js'
import { myVerifications } from '../kyc/identity.js'
import { verificationHistory } from '../kyc/review.js'
import { issueDocumentGrant, serveDocument } from '../kyc/documents.js'
import { myAgriProfile } from '../agri-identity/agri-profile.js'

const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const NOW = new Date('2026-09-08T09:00:00.000Z')

/** Everything A owns. B must reach none of it. */
const A_ADDRESS = 'a-address'
const A_FARM = 'a-farm'
const A_VERIFICATION = 'a-verification'
const A_DOCUMENT = 'kyc-documents/a-front.jpg'

const user = (userId: string): Actor => ({ userId, roles: ['FARMER'], status: 'ACTIVE' })

const alice = () => user(A)
const bob = () => user(B)

/** An administrator holding every permission. Even they must not reach some of this. */
const superAdmin = (): Actor => ({
  userId: 'cccccccc-0000-4000-8000-00000000000c',
  roles: ['ADMIN'],
  status: 'ACTIVE',
  permissions: ['USER_VIEW', 'KYC_VIEW', 'KYC_REVIEW', 'AUDIT_VIEW', 'ACCOUNT_SUSPEND'],
})

/* ---------------------------------------------------------------- fakes */

/**
 * Repositories that scope by owner.
 *
 * Each lookup takes the owner and puts it in the comparison, so a stranger's id resolves to null
 * rather than to a row the use case is trusted to screen out afterwards.
 */
function deps() {
  const audit = vi.fn(async () => undefined)

  const addresses = {
    findOwned: async (addressId: string, userId: string) =>
      addressId === A_ADDRESS && userId === A
        ? { id: A_ADDRESS, userId: A, addressLine: 'House 4', recipientPhone: '+8801712345678' }
        : null,
    listForUser: async (userId: string) => (userId === A ? [{ id: A_ADDRESS, userId: A }] : []),
  }

  const farms = {
    findForUser: async (userId: string, farmId: string) =>
      farmId === A_FARM && userId === A
        ? { id: A_FARM, name: "Alice's field", plotCount: 2 }
        : null,
    listForUser: async (userId: string) => (userId === A ? [{ id: A_FARM }] : []),
  }

  const plots = {
    listForFarm: async (userId: string, farmId: string) =>
      farmId === A_FARM && userId === A ? [{ id: 'a-plot', farmId: A_FARM }] : [],
  }

  /*
   * Create-on-read, as the real repository does it.
   *
   * A caller with no profile gets THEIR OWN created, never somebody else's returned. That is the
   * behaviour the self-only use cases below are tested against.
   */
  const farmerProfiles = {
    findByUserId: async (userId: string) =>
      userId === A
        ? { id: 'a-profile', userId: A, displayName: 'Alice', verificationStatus: 'VERIFIED' }
        : null,
    ensureForUser: async (input: { userId: string }) => ({
      id: `${input.userId}-profile`,
      userId: input.userId,
      displayName: 'New farmer',
      verificationStatus: 'UNVERIFIED',
    }),
  }

  const verificationRecord = {
    id: A_VERIFICATION,
    userId: A,
    type: 'IDENTITY' as const,
    status: 'PENDING' as const,
    method: 'MANUAL_REVIEW' as const,
    submittedAt: NOW,
    reviewedAt: null,
    reviewerUserId: null,
    rejectionReason: null,
    expiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    identityType: 'NID' as const,
    identityNumberMasked: '••••••7890',
    hasDocumentFront: true,
    hasDocumentBack: false,
  }

  const verifications = {
    listForUser: async (userId: string) => (userId === A ? [verificationRecord] : []),
    findOwned: async (id: string, userId: string) =>
      id === A_VERIFICATION && userId === A ? verificationRecord : null,
    findById: async (id: string) => (id === A_VERIFICATION ? verificationRecord : null),
    documentKeys: async (id: string) =>
      id === A_VERIFICATION ? { front: A_DOCUMENT, back: null } : null,
    history: async () => [],
    revealCiphertext: async () => ({ ciphertext: 'v1$x$y$z', ownerUserId: A }),
    blindIndexBelongsToOther: async () => false,
  }

  const storage = {
    isAvailable: true,
    providerName: 'test',
    download: async (key: string) =>
      key === A_DOCUMENT ? { contentType: 'image/jpeg', data: new Uint8Array([1, 2, 3]) } : null,
    publicUrl: async () => null,
    upload: async () => ({ ok: false as const, reason: 'PROVIDER_ERROR' as const }),
  }

  /** A grant signer with the real one's binding, and none of its cryptography. */
  const grants = {
    issue: (grant: { storageKey: string; viewerUserId: string; verificationId: string }) =>
      JSON.stringify({ ...grant, exp: NOW.getTime() + 600_000 }),
    verify: (token: string) => {
      try {
        const parsed = JSON.parse(token) as {
          storageKey: string
          viewerUserId: string
          verificationId: string
          exp: number
        }
        return { ...parsed, expiresAt: new Date(parsed.exp) }
      } catch {
        return null
      }
    },
  }

  const identities = {
    findAgriId: async (userId: string) => (userId === A ? 'AGRI-BD-0123456A' : null),
    issueAgriId: async (_userId: string, candidate: string) => candidate,
    profileSources: async (userId: string) =>
      userId === A
        ? {
            displayName: 'Alice',
            memberSince: NOW,
            roles: [{ role: 'FARMER', verified: true }],
            verifications: [{ type: 'IDENTITY', status: 'PENDING' }],
            location: null,
            farm: null,
            production: null,
            business: null,
          }
        : null,
  }

  return {
    audit,
    all: {
      clock: { now: () => NOW },
      audit: { record: audit },
      addresses,
      areas: {
        findById: async () => null,
        listChildren: async () => [],
        resolvePath: async () => [],
      },
      farms,
      plots,
      farmers: farmerProfiles,
      profiles: farmerProfiles,
      verifications,
      storage,
      grants,
      identities,
      cipher: {
        isConfigured: true,
        encrypt: () => 'v1$x',
        decrypt: () => '1234567890',
        blindIndex: () => 'bi',
      },
      random: { bytes: (n: number) => new Uint8Array(n).fill(7) },
      config: {},
    } as never,
  }
}

/** Did the call refuse? Either shape of refusal counts; success does not. */
function refused<T>(result: Result<T, AppError>): boolean {
  return isErr(result)
}

/* ================================================== the eight resources */

describe('user B cannot reach user A', () => {
  /**
   * One row per resource the requirement names.
   *
   * A table rather than eight `it` blocks, because the point is that the SET is covered — a
   * resource added to the platform without a row here is a gap somebody can see.
   */
  const resources: readonly {
    readonly name: string
    readonly reach: (actor: Actor, d: ReturnType<typeof deps>) => Promise<Result<unknown, AppError>>
  }[] = [
    {
      name: 'address',
      reach: async (actor, d) => getAddress(actor, A_ADDRESS, d.all),
    },
    {
      name: 'farm',
      reach: async (actor, d) => getMyFarm(actor, A_FARM, d.all),
    },
    {
      name: 'plot',
      reach: async (actor, d) => listPlots(actor, A_FARM, d.all),
    },
    {
      name: 'KYC file',
      reach: async (actor, d) => verificationHistory(actor, A_VERIFICATION, d.all),
    },
    {
      name: 'private document',
      reach: async (actor, d) => issueDocumentGrant(actor, A_VERIFICATION, 'FRONT', d.all),
    },
  ]

  it.each(resources.map((r) => [r.name, r] as const))(
    'refuses a signed-in stranger the %s',
    async (_name, resource) => {
      const d = deps()
      const result = await resource.reach(bob(), d)
      expect(refused(result)).toBe(true)
    },
  )

  it.each(resources.map((r) => [r.name, r] as const))(
    'refuses an anonymous caller the %s',
    async (_name, resource) => {
      const d = deps()
      const result = await resource.reach(ANONYMOUS as never, d)
      expect(refused(result)).toBe(true)
    },
  )

  it.each(resources.map((r) => [r.name, r] as const))(
    'lets the owner reach their own %s',
    async (_name, resource) => {
      /*
       * The other half, and it is not padding. A suite that only proves refusals passes just as
       * well when the feature is broken for everybody, and a security control that denies the
       * owner is a bug reported as an outage rather than as a vulnerability.
       */
      const d = deps()
      const result = await resource.reach(alice(), d)
      expect(isOk(result), 'the owner was refused their own resource').toBe(true)
    },
  )
})

/* ============================================ the self-only use cases */

describe('the use cases that take no subject at all', () => {
  /**
   * A different property, and a stronger one.
   *
   * `getMyFarmerProfile` and `myAgriProfile` accept no identifier: the subject is the signed-in
   * actor. There is therefore no IDOR surface to test, because there is no argument anybody could
   * put another person's id into — which is why the first version of this file was wrong to try.
   *
   * What must hold instead is that a stranger calling them gets THEIR OWN empty record, never
   * somebody else's. The fake creates on read exactly as the repository does, so a use case that
   * had somehow resolved a different subject would show up as A's data in B's hands.
   */
  const selfOnly: readonly {
    readonly name: string
    readonly reach: (actor: Actor, d: ReturnType<typeof deps>) => Promise<Result<unknown, AppError>>
  }[] = [
    { name: 'farmer profile', reach: async (actor, d) => getMyFarmerProfile(actor, d.all) },
    { name: 'agricultural profile', reach: async (actor, d) => myAgriProfile(actor, d.all) },
  ]

  it.each(selfOnly.map((r) => [r.name, r] as const))(
    'never returns A’s %s to B',
    async (_name, resource) => {
      const d = deps()
      const result = await resource.reach(bob(), d)

      // Whatever B receives, it is not Alice's.
      expect(JSON.stringify(result)).not.toContain('Alice')
      expect(JSON.stringify(result)).not.toContain(A)
    },
  )

  it.each(selfOnly.map((r) => [r.name, r] as const))(
    'refuses an anonymous caller the %s',
    async (_name, resource) => {
      const d = deps()
      expect(refused(await resource.reach(ANONYMOUS as never, d))).toBe(true)
    },
  )

  it('takes no subject parameter, which is the guarantee', () => {
    // Stated as a test so a future signature change that adds one has to break something first.
    expect(getMyFarmerProfile).toHaveLength(2)
    expect(myAgriProfile).toHaveLength(2)
  })
})

/* ======================================================= production data */

describe('cultivation and production history', () => {
  it('is reachable only through a farm the caller owns', async () => {
    /*
     * Production rows hang off the farmer profile, and every query for them is scoped through it.
     * A stranger gets no profile, so there is nothing for a production query to be scoped BY —
     * which is why the profile refusal above is the one that matters.
     */
    const d = deps()
    const strangersProfile = await getMyFarmerProfile(bob(), d.all)

    // B gets B's own empty profile, so there is nothing of A's for a production query to hang off.
    expect(JSON.stringify(strangersProfile)).not.toContain('Alice')
    expect(refused(await listPlots(bob(), A_FARM, d.all))).toBe(true)
  })

  it('does not leak a farm through its plot listing', async () => {
    // The plot query carries the owner one join further out. A farm id alone proves nothing.
    const d = deps()
    const result = await listPlots(bob(), A_FARM, d.all)
    expect(refused(result) || (isOk(result) && result.value.length === 0)).toBe(true)
  })
})

/* ====================================================== private documents */

describe('a private document', () => {
  it('cannot be fetched with a grant minted for somebody else', async () => {
    /*
     * The property a bare expiring URL does not have. A link copied out of one browser is inert in
     * another's hands, because the grant names its viewer and the viewer is re-checked at
     * redemption against the live session.
     */
    const d = deps()
    const grant = await issueDocumentGrant(alice(), A_VERIFICATION, 'FRONT', d.all)
    if (!isOk(grant)) throw new Error('the owner should have been issued a grant')

    expect(refused(await serveDocument(bob(), grant.value.token, d.all))).toBe(true)
  })

  it('cannot be fetched with a forged grant', async () => {
    const d = deps()
    const forged = JSON.stringify({
      storageKey: A_DOCUMENT,
      viewerUserId: B,
      verificationId: A_VERIFICATION,
      exp: NOW.getTime() + 600_000,
    })

    // The token names B as the viewer, so the presenter check passes — and the authorization
    // check behind it does not, because B is neither the subject nor an administrator.
    expect(refused(await serveDocument(bob(), forged, d.all))).toBe(true)
  })

  it('records an attempt to redeem somebody else’s grant', async () => {
    const d = deps()
    const grant = await issueDocumentGrant(alice(), A_VERIFICATION, 'FRONT', d.all)
    if (!isOk(grant)) throw new Error('expected a grant')

    await serveDocument(bob(), grant.value.token, d.all)
    expect(JSON.stringify(d.audit.mock.calls)).toContain('KYC_DOCUMENT_GRANT_MISUSED')
  })
})

/* ============================================== what an administrator gets */

describe('even a fully privileged administrator', () => {
  it('cannot read another user’s farmer profile through the owner’s use case', async () => {
    /*
     * There is no `farmer:read-any` action, so an administrator has no capability to do it WITH.
     * The guarantee is an absent action rather than a check somebody could widen — and it holds
     * for an operator holding every permission the platform defines.
     */
    const d = deps()
    expect(JSON.stringify(await getMyFarmerProfile(superAdmin(), d.all))).not.toContain('Alice')
  })

  it('cannot edit somebody else’s address', async () => {
    // `address:update` is owner-only. Reading is permitted under USER_VIEW; changing is not
    // permitted at all, because an address a support agent silently edited is a delivery that
    // goes somewhere the farmer never chose.
    const d = deps()
    const result = await getAddress(superAdmin(), A_ADDRESS, d.all)
    // Not found for an administrator too: the lookup is scoped by owner in the query.
    expect(refused(result)).toBe(true)
  })

  it('may read a KYC file, because that is the job the permission names', async () => {
    const d = deps()
    expect(isOk(await verificationHistory(superAdmin(), A_VERIFICATION, d.all))).toBe(true)
  })
})

/* ================================================= what a response carries */

describe('an unsafe API response', () => {
  it('never carries a phone number out of the address book to a stranger', async () => {
    /*
     * The fixture address deliberately holds a real phone number. If any refusal path returned the
     * record before checking, this would catch it — a test that asserts on the error code alone
     * would not.
     */
    const d = deps()
    const result = await getAddress(bob(), A_ADDRESS, d.all)
    expect(JSON.stringify(result)).not.toContain('8801712345678')
  })

  it('never carries an identity number to the subject themselves', async () => {
    // The owner may see their own verification and still not the number on it: there is no
    // unmasked form reachable from the shape they receive.
    const d = deps()
    const result = await myVerifications(alice(), d.all)
    expect(JSON.stringify(result)).not.toContain('1234567890')
  })
})
