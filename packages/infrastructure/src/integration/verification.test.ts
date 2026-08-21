/**
 * Verification integration tests.
 *
 * The half of Phase 2 the unit tests structurally cannot reach: the constraints and indexes that
 * hold even when the application layer is bypassed entirely. Every assertion here tries to break
 * an invariant with raw Prisma, because a CHECK is only a guarantee if it is actually in the
 * database.
 *
 * Skipped unless a real database is configured — see database.test.ts for the run instructions.
 *
 * Refs: docs/07_SECURITY.md §3.1, §3.3
 */

import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@langgol/db'
import { otpChallengeRepository, verificationTokenRepository } from '../repositories/auth.js'
import { accountRepository } from '../repositories/account.js'

const enabled =
  process.env['LANGGOL_INTEGRATION'] === '1' && process.env['DATABASE_URL'] !== undefined
const suite = enabled ? describe : describe.skip

const prisma = new PrismaClient()

const PHONE = '+8801795000001'
const EMAIL = 'verify.integration@example.com'

afterAll(async () => {
  await prisma.$disconnect()
})

async function withUser(body: (userId: string) => Promise<void>): Promise<void> {
  const user = await prisma.user.create({
    data: { phone: PHONE, fullName: 'Verification Integration', email: EMAIL },
  })
  try {
    await body(user.id)
  } finally {
    await prisma.verificationToken.deleteMany({ where: { userId: user.id } })
    await prisma.otpChallenge.deleteMany({ where: { phone: PHONE } })
    await prisma.user.delete({ where: { id: user.id } })
  }
}

const HOUR = 60 * 60 * 1000

/**
 * A stand-in code hash.
 *
 * `otp_code_is_hashed` requires at least 32 characters — the database's own guard against a
 * plaintext six-digit code ever being written to `code_hash`. A short fixture would trip it, and
 * rightly so.
 */
const codeHash = (label: string) => `scrypt$32768$8$1$${label.padEnd(40, 'x')}`

suite('user verification columns', () => {
  it('refuses a verified email on an account with no address', async () => {
    // The contradiction the application must never be able to produce.
    const user = await prisma.user.create({
      data: { phone: '+8801795000002', fullName: 'No Address' },
    })
    try {
      await expect(
        prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }),
      ).rejects.toThrow()
    } finally {
      await prisma.user.delete({ where: { id: user.id } })
    }
  })

  it('retracts the proof when the address changes, even from raw SQL', async () => {
    /*
     * The adapter clears `email_verified_at` alongside `email`, but a data migration, an admin
     * console or a psql session would not. A trigger makes the rule true regardless of which
     * code path wrote the row — the same standard as the ledger balance and the append-only
     * audit log.
     */
    await withUser(async (userId) => {
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } })

      // Deliberately bypasses accountRepository.updateProfile.
      await prisma.user.update({
        where: { id: userId },
        data: { email: 'moved@example.com' },
      })

      const row = await prisma.user.findUnique({ where: { id: userId } })
      expect(row?.email).toBe('moved@example.com')
      expect(row?.emailVerifiedAt).toBeNull()
    })
  })

  it('retracts the proof when the address is cleared', async () => {
    await withUser(async (userId) => {
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } })
      await prisma.user.update({ where: { id: userId }, data: { email: null } })

      const row = await prisma.user.findUnique({ where: { id: userId } })
      expect(row?.emailVerifiedAt).toBeNull()
    })
  })

  it('keeps a proof set in the SAME statement as the address', async () => {
    // markEmailVerified writes both together; the trigger must not undo its own caller.
    await withUser(async (userId) => {
      const at = new Date()
      await prisma.user.update({
        where: { id: userId },
        data: { email: 'together@example.com', emailVerifiedAt: at },
      })

      const row = await prisma.user.findUnique({ where: { id: userId } })
      expect(row?.emailVerifiedAt).toEqual(at)
    })
  })

  it('leaves the proof alone when something unrelated changes', async () => {
    await withUser(async (userId) => {
      const at = new Date()
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: at } })
      await prisma.user.update({ where: { id: userId }, data: { fullName: 'Renamed' } })

      expect((await prisma.user.findUnique({ where: { id: userId } }))?.emailVerifiedAt).toEqual(at)
    })
  })

  it('starts both verification stamps empty', async () => {
    await withUser(async (userId) => {
      const row = await prisma.user.findUnique({ where: { id: userId } })
      expect(row?.phoneVerifiedAt).toBeNull()
      expect(row?.emailVerifiedAt).toBeNull()
    })
  })
})

suite('verification token constraints', () => {
  const base = (userId: string) => ({
    userId,
    purpose: 'EMAIL_VERIFY' as const,
    destination: EMAIL,
    expiresAt: new Date(Date.now() + HOUR),
  })

  it('refuses a mixed-case destination', async () => {
    // The destination is compared against users.email, which a CHECK forces to lower case.
    // A mixed-case copy here would make that comparison silently fail forever.
    await withUser(async (userId) => {
      await expect(
        prisma.verificationToken.create({
          data: { ...base(userId), destination: 'Rahim@Example.com', tokenHash: 'hash-case' },
        }),
      ).rejects.toThrow()
    })
  })

  it('refuses a blank destination', async () => {
    await withUser(async (userId) => {
      await expect(
        prisma.verificationToken.create({
          data: { ...base(userId), destination: '   ', tokenHash: 'hash-blank' },
        }),
      ).rejects.toThrow()
    })
  })

  it('refuses a token that expires before it was issued', async () => {
    // Almost always a unit mix-up — seconds passed where milliseconds were meant.
    await withUser(async (userId) => {
      await expect(
        prisma.verificationToken.create({
          data: {
            ...base(userId),
            expiresAt: new Date(Date.now() - HOUR),
            tokenHash: 'hash-backwards',
          },
        }),
      ).rejects.toThrow()
    })
  })

  it('refuses a duplicate token hash', async () => {
    await withUser(async (userId) => {
      await prisma.verificationToken.create({
        data: { ...base(userId), tokenHash: 'hash-duplicate' },
      })
      await expect(
        prisma.verificationToken.create({
          data: { ...base(userId), tokenHash: 'hash-duplicate' },
        }),
      ).rejects.toThrow()
    })
  })

  it('refuses a SECOND live token for the same user and purpose', async () => {
    /*
     * The index that makes "requesting a new link revokes the old" true regardless of which code
     * path issued them. Without it, a widening set of valid links accumulates.
     */
    await withUser(async (userId) => {
      await prisma.verificationToken.create({ data: { ...base(userId), tokenHash: 'live-1' } })
      await expect(
        prisma.verificationToken.create({ data: { ...base(userId), tokenHash: 'live-2' } }),
      ).rejects.toThrow()
    })
  })

  it('allows a new token once the previous one is revoked', async () => {
    await withUser(async (userId) => {
      const first = await prisma.verificationToken.create({
        data: { ...base(userId), tokenHash: 'revoked-1' },
      })
      await prisma.verificationToken.update({
        where: { id: first.id },
        data: { revokedAt: new Date() },
      })

      await expect(
        prisma.verificationToken.create({ data: { ...base(userId), tokenHash: 'revoked-2' } }),
      ).resolves.toBeDefined()
    })
  })

  it('cascades away with the user, leaving no orphan credentials', async () => {
    const user = await prisma.user.create({
      data: { phone: '+8801795000003', fullName: 'Cascade Test', email: 'cascade@example.com' },
    })
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        purpose: 'EMAIL_VERIFY',
        destination: 'cascade@example.com',
        tokenHash: 'hash-cascade',
        expiresAt: new Date(Date.now() + HOUR),
      },
    })

    await prisma.user.delete({ where: { id: user.id } })
    expect(await prisma.verificationToken.count({ where: { tokenHash: 'hash-cascade' } })).toBe(0)
  })
})

suite('the verification repositories against real SQL', () => {
  it('issues, finds by hash, and consumes a token', async () => {
    await withUser(async (userId) => {
      const at = new Date()
      await verificationTokenRepository.create({
        userId,
        purpose: 'EMAIL_VERIFY',
        destination: EMAIL,
        tokenHash: 'roundtrip-hash',
        expiresAt: new Date(at.getTime() + HOUR),
        requestIp: null,
      })

      const found = await verificationTokenRepository.findByHash('roundtrip-hash')
      expect(found?.destination).toBe(EMAIL)
      expect(found?.consumedAt).toBeNull()

      await verificationTokenRepository.consume(found!.id, at)
      expect((await verificationTokenRepository.findByHash('roundtrip-hash'))?.consumedAt).toEqual(
        at,
      )
    })
  })

  it('revokes outstanding tokens rather than deleting them', async () => {
    // History survives. "Who asked for a link, and when?" stays answerable after a revocation.
    await withUser(async (userId) => {
      await verificationTokenRepository.create({
        userId,
        purpose: 'EMAIL_VERIFY',
        destination: EMAIL,
        tokenHash: 'revoke-me',
        expiresAt: new Date(Date.now() + HOUR),
        requestIp: null,
      })

      const count = await verificationTokenRepository.invalidateOutstanding({
        userId,
        purpose: 'EMAIL_VERIFY',
        at: new Date(),
      })

      expect(count).toBe(1)
      const row = await verificationTokenRepository.findByHash('revoke-me')
      expect(row).not.toBeNull()
      expect(row?.revokedAt).not.toBeNull()
    })
  })

  it('marks an address verified only while it still matches', async () => {
    await withUser(async (userId) => {
      const at = new Date()

      expect(
        await accountRepository.markEmailVerified({ userId, email: 'other@example.com', at }),
      ).toBe(false)
      expect((await accountRepository.findProfile(userId))?.emailVerifiedAt).toBeNull()

      expect(await accountRepository.markEmailVerified({ userId, email: EMAIL, at })).toBe(true)
      expect((await accountRepository.findProfile(userId))?.emailVerifiedAt).toEqual(at)
    })
  })

  it('retracts the proof when the address is changed', async () => {
    // Carrying it over would mark an address nobody has proven as verified — worse than no
    // signal at all, because something downstream would trust it.
    await withUser(async (userId) => {
      await accountRepository.markEmailVerified({ userId, email: EMAIL, at: new Date() })

      await accountRepository.updateProfile(userId, { email: 'changed@example.com' })

      const profile = await accountRepository.findProfile(userId)
      expect(profile?.email).toBe('changed@example.com')
      expect(profile?.emailVerifiedAt).toBeNull()
    })
  })
})

suite('OTP purposes do not share a budget', () => {
  it('counts each purpose separately, so verifying cannot lock a user out of login', async () => {
    /*
     * The regression this exists to prevent: `recentRequestTimes` used to ignore purpose, so a
     * farmer verifying their number would have spent the per-phone allowance they needed in
     * order to sign in — locked out by following the instructions on screen.
     */
    await withUser(async () => {
      const now = new Date()
      await otpChallengeRepository.create({
        phone: PHONE as never,
        codeHash: codeHash('verify'),
        purpose: 'PHONE_VERIFY',
        expiresAt: new Date(now.getTime() + 300_000),
        maxAttempts: 5,
        requestIp: null,
        requestDevice: null,
      })

      const since = new Date(now.getTime() - HOUR)
      const login = await otpChallengeRepository.recentRequestTimes({
        phone: PHONE as never,
        purpose: 'LOGIN',
        since,
      })
      const verify = await otpChallengeRepository.recentRequestTimes({
        phone: PHONE as never,
        purpose: 'PHONE_VERIFY',
        since,
      })

      expect(login).toHaveLength(0)
      expect(verify).toHaveLength(1)
    })
  })

  it('looks a challenge up within its own purpose only', async () => {
    await withUser(async () => {
      const now = new Date()
      await otpChallengeRepository.create({
        phone: PHONE as never,
        codeHash: codeHash('scoped'),
        purpose: 'PHONE_VERIFY',
        expiresAt: new Date(now.getTime() + 300_000),
        maxAttempts: 5,
        requestIp: null,
        requestDevice: null,
      })

      expect(await otpChallengeRepository.findLatestActive(PHONE as never, 'LOGIN', now)).toBeNull()
      expect(
        await otpChallengeRepository.findLatestActive(PHONE as never, 'PHONE_VERIFY', now),
      ).not.toBeNull()
    })
  })

  it('invalidates only the purpose it was asked about', async () => {
    await withUser(async () => {
      const now = new Date()
      for (const purpose of ['LOGIN', 'PHONE_VERIFY'] as const) {
        await otpChallengeRepository.create({
          phone: PHONE as never,
          codeHash: codeHash(purpose),
          purpose,
          expiresAt: new Date(now.getTime() + 300_000),
          maxAttempts: 5,
          requestIp: null,
          requestDevice: null,
        })
      }

      const killed = await otpChallengeRepository.invalidateOutstanding({
        phone: PHONE as never,
        purpose: 'PHONE_VERIFY',
        at: now,
      })

      expect(killed).toBe(1)
      // The login challenge is untouched — invalidating one flow must not sign the user out of
      // a code they are part-way through using for the other.
      expect(
        await otpChallengeRepository.findLatestActive(PHONE as never, 'LOGIN', now),
      ).not.toBeNull()
    })
  })
})
