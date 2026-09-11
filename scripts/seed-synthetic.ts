/**
 * Synthetic data for a local test database.
 *
 * `pnpm db:seed` loads reference data and the development fixtures. That is enough to sign in and
 * nowhere near enough to exercise the back office: the admin screens are queues, and an empty
 * queue looks identical to a broken one. This fills them.
 *
 * Run with:
 *
 *   pnpm db:seed && pnpm seed:synthetic
 *
 * Idempotent. It keys everything off stable phone numbers and verification types, so running it
 * twice changes nothing and running it after a schema change tops up what is missing.
 *
 * ## Why it lives in scripts/ rather than in prisma/seed/
 *
 * It needs the real identity cipher, and `packages/db` cannot import `@langgol/infrastructure`
 * because infrastructure already depends on db — the import would be a cycle. The repository root
 * depends on every workspace package, which is exactly what `scripts/e2e-marketplace.ts` relies on
 * for the same reason.
 *
 * Encrypting for real matters here: a placeholder ciphertext would let the KYC queue render and
 * then fail the moment a reviewer opened a record, which is the sort of half-working fixture that
 * wastes an afternoon.
 *
 * ## The administrator problem this solves
 *
 * P13 made ADMIN a role that grants nothing by itself. The P13 backfill gives existing admins all
 * ten permissions, but it deliberately SKIPS an installation with only one administrator, because
 * every grant must be attributed to somebody else — nobody grants themselves a permission, and a
 * database CHECK enforces it.
 *
 * A fresh local database has exactly one administrator, the `admin` fixture. So it lands with the
 * role, no permissions, and an admin dashboard that correctly reports it can do nothing. This
 * script creates a second administrator to act as grantor and grants the ten permissions from it,
 * which is the same two-person path a real installation uses.
 */

import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@langgol/db'
import { DEVELOPMENT_IDENTITIES } from '@langgol/domain/identity'
import { normalizeIdentity } from '@langgol/domain/kyc'
import { identityCipher } from '@langgol/infrastructure'

const prisma = new PrismaClient()

/**
 * The phone block this script owns.
 *
 * Disjoint from both reserved blocks by construction: development fixtures are `+88017000000……`
 * and the integration suites own `+880179………`. These are `+880178………`, which no operator assigns
 * and neither of the others can reach.
 */
const SYNTHETIC_PREFIX = '+880178'

const ALL_PERMISSIONS = [
  'USER_VIEW',
  'USER_EDIT',
  'ROLE_MANAGE',
  'KYC_VIEW',
  'KYC_REVIEW',
  'BUSINESS_REVIEW',
  'FARM_REVIEW',
  'EXPERT_REVIEW',
  'AUDIT_VIEW',
  'ACCOUNT_SUSPEND',
] as const

interface SyntheticPerson {
  readonly phone: string
  readonly fullName: string
  readonly role: string
  readonly language: 'BN' | 'EN'
}

/**
 * People with names, because a queue of "Test User 4" tells you nothing about whether the screen
 * renders Bangla correctly, and this product is Bangla-first.
 */
const PEOPLE: readonly SyntheticPerson[] = [
  { phone: `${SYNTHETIC_PREFIX}0000001`, fullName: 'আব্দুল করিম', role: 'FARMER', language: 'BN' },
  { phone: `${SYNTHETIC_PREFIX}0000002`, fullName: 'রহিমা খাতুন', role: 'FARMER', language: 'BN' },
  {
    phone: `${SYNTHETIC_PREFIX}0000003`,
    fullName: 'মোঃ শফিকুল ইসলাম',
    role: 'FARMER',
    language: 'BN',
  },
  {
    phone: `${SYNTHETIC_PREFIX}0000004`,
    fullName: 'নাসরিন আক্তার',
    role: 'CONSUMER',
    language: 'BN',
  },
  {
    phone: `${SYNTHETIC_PREFIX}0000005`,
    fullName: 'Tanvir Ahmed',
    role: 'CONSUMER',
    language: 'EN',
  },
  { phone: `${SYNTHETIC_PREFIX}0000006`, fullName: 'সালমা বেগম', role: 'RETAILER', language: 'BN' },
  {
    phone: `${SYNTHETIC_PREFIX}0000007`,
    fullName: 'Jahangir Alam',
    role: 'RETAILER',
    language: 'EN',
  },
  {
    phone: `${SYNTHETIC_PREFIX}0000008`,
    fullName: 'মোঃ ফরিদ উদ্দিন',
    role: 'WHOLESALER',
    language: 'BN',
  },
  {
    phone: `${SYNTHETIC_PREFIX}0000009`,
    fullName: 'Shirin Sultana',
    role: 'SUPPLIER',
    language: 'EN',
  },
  {
    phone: `${SYNTHETIC_PREFIX}0000010`,
    fullName: 'ড. আনোয়ার হোসেন',
    role: 'AGRICULTURAL_EXPERT',
    language: 'BN',
  },
  {
    phone: `${SYNTHETIC_PREFIX}0000011`,
    fullName: 'Rafiq Transport',
    role: 'LOGISTICS_PROVIDER',
    language: 'EN',
  },
  { phone: `${SYNTHETIC_PREFIX}0000012`, fullName: 'হাসান মাহমুদ', role: 'FARMER', language: 'BN' },
  {
    phone: `${SYNTHETIC_PREFIX}0000013`,
    fullName: 'Ayesha Siddiqua',
    role: 'CONSUMER',
    language: 'EN',
  },
  {
    phone: `${SYNTHETIC_PREFIX}0000014`,
    fullName: 'মোঃ জসিম উদ্দিন',
    role: 'FARMER',
    language: 'BN',
  },
  {
    phone: `${SYNTHETIC_PREFIX}0000015`,
    fullName: 'Nusrat Jahan',
    role: 'RETAILER',
    language: 'EN',
  },
]

/** The second administrator, who exists so that grants have somebody to be attributed to. */
const GRANTOR: SyntheticPerson = {
  phone: `${SYNTHETIC_PREFIX}0000099`,
  fullName: 'Local Bootstrap Admin',
  role: 'ADMIN',
  language: 'EN',
}

/** Real-shaped NID numbers. Ten and seventeen digits are both in circulation. */
const NID_NUMBERS = [
  '1990123456789',
  '19881234567890123',
  '1995876543210',
  '2001234567890',
  '1979112233445',
  '1993445566778',
]

type Tx = Prisma.TransactionClient | PrismaClient

async function upsertPerson(person: SyntheticPerson, tx: Tx): Promise<string> {
  const existing = await tx.user.findUnique({
    where: { phone: person.phone },
    select: { id: true },
  })
  if (existing !== null) return existing.id

  const created = await tx.user.create({
    data: {
      phone: person.phone,
      fullName: person.fullName,
      preferredLanguage: person.language,
      phoneVerifiedAt: new Date(),
      roles: { create: [{ role: person.role as never }] },
    },
    select: { id: true },
  })
  return created.id
}

/**
 * Give every administrator the full permission set, attributed to somebody else.
 *
 * Mirrors the P13 backfill rather than inventing a second way to do it: one live grant per
 * permission, attributed to a different administrator. The partial unique index makes the
 * "already granted" case a no-op rather than a duplicate, so this is safe to run repeatedly.
 */
async function grantPermissions(grantorId: string): Promise<number> {
  const admins = await prisma.userRoleAssignment.findMany({
    where: { role: 'ADMIN', revokedAt: null },
    select: { userId: true },
  })

  let granted = 0

  for (const { userId } of admins) {
    // The constraint is `granted_by_id <> user_id`. The grantor cannot grant to itself, which is
    // the rule working as intended rather than a case to work around.
    if (userId === grantorId) continue

    for (const permission of ALL_PERMISSIONS) {
      const live = await prisma.adminPermissionGrant.findFirst({
        where: { userId, permission: permission as never, revokedAt: null },
        select: { id: true },
      })
      if (live !== null) continue

      await prisma.adminPermissionGrant.create({
        data: { userId, permission: permission as never, grantedById: grantorId },
      })
      granted += 1
    }
  }

  return granted
}

interface QueueSpec {
  readonly type: 'IDENTITY' | 'FARM' | 'BUSINESS' | 'EXPERT'
  readonly status: 'PENDING' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED'
  readonly personIndex: number
}

/**
 * One of each state in each queue.
 *
 * The point is not volume. It is that a reviewer opening any of the four screens sees a row in
 * every state the domain defines, so an approve button and a reject reason can both be exercised
 * without first manufacturing a submission by hand.
 */
const QUEUE: readonly QueueSpec[] = [
  { type: 'IDENTITY', status: 'PENDING', personIndex: 0 },
  { type: 'IDENTITY', status: 'PENDING', personIndex: 1 },
  { type: 'IDENTITY', status: 'UNDER_REVIEW', personIndex: 2 },
  { type: 'IDENTITY', status: 'VERIFIED', personIndex: 3 },
  { type: 'IDENTITY', status: 'REJECTED', personIndex: 4 },
  { type: 'FARM', status: 'PENDING', personIndex: 11 },
  { type: 'FARM', status: 'PENDING', personIndex: 13 },
  { type: 'FARM', status: 'VERIFIED', personIndex: 0 },
  { type: 'BUSINESS', status: 'PENDING', personIndex: 5 },
  { type: 'BUSINESS', status: 'PENDING', personIndex: 7 },
  { type: 'BUSINESS', status: 'REJECTED', personIndex: 6 },
  { type: 'EXPERT', status: 'PENDING', personIndex: 9 },
]

async function seedVerifications(userIds: readonly string[], reviewerId: string): Promise<number> {
  let created = 0
  let nidCursor = 0

  for (const spec of QUEUE) {
    const userId = userIds[spec.personIndex]
    if (userId === undefined) continue

    // One verification of each kind per user is a unique constraint, so this is the idempotency key.
    const existing = await prisma.verification.findFirst({
      where: { userId, type: spec.type as never },
      select: { id: true },
    })
    if (existing !== null) continue

    const decided = spec.status === 'VERIFIED' || spec.status === 'REJECTED'
    const submittedAt = new Date(Date.now() - (created + 1) * 3_600_000)

    const verification = await prisma.verification.create({
      data: {
        userId,
        type: spec.type as never,
        status: spec.status as never,
        submittedAt,
        ...(decided
          ? {
              reviewedAt: new Date(submittedAt.getTime() + 1_800_000),
              reviewerUserId: reviewerId,
              method: 'MANUAL_REVIEW' as never,
            }
          : {}),
        /*
         * A REJECTED row must carry a reason — a CHECK enforces it, because "rejected" with no
         * reason means the person resubmits the same thing and occupies the queue twice.
         */
        ...(spec.status === 'REJECTED'
          ? { rejectionReason: 'ছবিটি অস্পষ্ট। দয়া করে পরিষ্কার ছবি আবার দিন।' }
          : {}),
      },
      select: { id: true },
    })

    if (spec.type === 'IDENTITY') {
      const raw = NID_NUMBERS[nidCursor % NID_NUMBERS.length] ?? NID_NUMBERS[0]
      nidCursor += 1
      const identity = normalizeIdentity('NID', raw)

      await prisma.identityRecord.create({
        data: {
          userId,
          verificationId: verification.id,
          identityType: 'NID' as never,
          // Encrypted for real, bound to this user id, exactly as the submission path would.
          identityNumberCiphertext: identityCipher.encrypt(identity.number, { userId }),
          identityNumberBlindIndex: identityCipher.blindIndex(identity.number),
          identityNumberMasked: identity.masked,
          identityNumberLast4: identity.last4,
          /*
           * Storage keys, not URLs, and they point at nothing. Object storage is a separate
           * service that a local database cannot populate, so opening a document will fail —
           * which is honest. Everything else on the review screen works.
           */
          documentFrontKey: `kyc-documents/${userId}/${randomUUID()}-front.jpg`,
          documentBackKey: `kyc-documents/${userId}/${randomUUID()}-back.jpg`,
        },
      })
    }

    await prisma.verificationEvent.create({
      data: {
        verificationId: verification.id,
        actorUserId: decided ? reviewerId : null,
        action: decided ? 'REVIEWED' : 'SUBMITTED',
        toStatus: spec.status as never,
        ...(spec.status === 'REJECTED' ? { reason: 'Document image unreadable' } : {}),
      },
    })

    created += 1
  }

  return created
}

async function main(): Promise<void> {
  const appEnv = process.env['APP_ENV'] ?? 'development'
  if (appEnv === 'production') {
    throw new Error('Refusing to write synthetic data to a production database.')
  }

  if (!identityCipher.isConfigured) {
    throw new Error(
      'KYC_ENCRYPTION_KEY is not set. The identity records this script creates are encrypted for ' +
        'real, so that the KYC screens work rather than failing when one is opened. ' +
        'Generate one with: openssl rand -base64 32',
    )
  }

  console.log('Seeding synthetic data…')

  const grantorId = await upsertPerson(GRANTOR, prisma)

  const userIds: string[] = []
  for (const person of PEOPLE) {
    userIds.push(await upsertPerson(person, prisma))
  }
  console.log(`  people:          ${String(userIds.length)} present`)

  const granted = await grantPermissions(grantorId)
  console.log(`  permissions:     ${String(granted)} granted`)

  /*
   * The reviewer on already-decided rows is the `admin` fixture, so the history shows a name a
   * tester will recognise from the account they signed in with.
   */
  const adminFixture = DEVELOPMENT_IDENTITIES.find((identity) => identity.key === 'admin')
  const reviewer =
    adminFixture === undefined
      ? null
      : await prisma.user.findUnique({ where: { phone: adminFixture.phone }, select: { id: true } })

  const verifications = await seedVerifications(userIds, reviewer?.id ?? grantorId)
  console.log(`  verifications:   ${String(verifications)} created`)

  const pending = await prisma.verification.count({ where: { status: 'PENDING' as never } })
  console.log(`\n  ${String(pending)} verification(s) awaiting review.`)
  console.log('  Sign in at /auth/development as "admin", then open /admin.')
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
