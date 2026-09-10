/**
 * Firebase ID token verification.
 *
 * Tested against real signatures rather than a stubbed verifier: a keypair is generated here, the
 * key endpoint is served from it, and tokens are signed for each case. A test that stubbed the
 * verification would assert nothing about the checks that matter.
 *
 * The case this file exists for is the AUDIENCE. Anyone can create a Firebase project and mint
 * correctly signed tokens in it, so a verifier that checks the signature but not the audience is
 * not weakened, it is bypassed.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, type JWK, type CryptoKey } from 'jose'
import { createFirebaseIdentityVerifier } from './auth.js'

const PROJECT = 'langgol-test'
const ISSUER = `https://securetoken.google.com/${PROJECT}`
const PHONE = '+8801712345678'
const UID = 'firebase-uid-abc'
const KEY_ID = 'test-key-1'

let privateKey: CryptoKey
let publicJwk: JWK

/** A second keypair, standing in for a signer that is not Google. */
let foreignKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true })
  privateKey = pair.privateKey
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', kid: KEY_ID, use: 'sig' }

  const other = await generateKeyPair('RS256', { extractable: true })
  foreignKey = other.privateKey
})

/**
 * Serve our generated key where the verifier expects Google's.
 *
 * `createRemoteJWKSet` fetches through the global fetch, so replacing it is enough. Stubbing at
 * this level keeps the production code free of a test seam.
 */
function serveKeys(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

interface TokenOptions {
  readonly audience?: string
  readonly issuer?: string
  readonly phone?: string | undefined
  readonly expiresIn?: string
  readonly authTime?: number
  readonly signWith?: CryptoKey
}

async function token(options: TokenOptions = {}): Promise<string> {
  const claims: Record<string, unknown> = { auth_time: options.authTime ?? nowSeconds() - 30 }
  if (options.phone !== undefined) claims['phone_number'] = options.phone

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setSubject(UID)
    .setIssuedAt()
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? PROJECT)
    .setExpirationTime(options.expiresIn ?? '1h')
    .sign(options.signWith ?? privateKey)
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

function verifier(onRefusal?: (reason: string) => void) {
  serveKeys()
  return createFirebaseIdentityVerifier(
    onRefusal === undefined ? { projectId: PROJECT } : { projectId: PROJECT, onRefusal },
  )
}

/* ------------------------------------------------------------------------ tests */

describe('a well-formed token for this project', () => {
  it('is accepted and yields the phone number and uid', async () => {
    const result = await verifier().verifyIdToken(await token({ phone: PHONE }))

    expect(result).not.toBeNull()
    expect(result?.uid).toBe(UID)
    expect(result?.phone).toBe(PHONE)
  })

  it('dates the verification from auth_time rather than the token issue time', async () => {
    /*
     * A refreshed token carries a newer `iat` for the same sign-in. Reading `iat` would move the
     * verification date every time the browser refreshed its token, which is a different fact from
     * the one being recorded.
     */
    const authTime = nowSeconds() - 600
    const result = await verifier().verifyIdToken(await token({ phone: PHONE, authTime }))

    expect(result?.verifiedAt.getTime()).toBe(authTime * 1000)
  })
})

describe('the audience check', () => {
  it('REFUSES a valid, correctly signed token minted for another project', async () => {
    /*
     * The single most important case in this file.
     *
     * Anyone can create a Firebase project in a minute and issue tokens in it. Those tokens are
     * genuinely signed by Google, so signature verification alone passes. Only the audience check
     * distinguishes them from ours, and without it any stranger could sign in as anybody.
     */
    const reasons: string[] = []
    const result = await verifier((r) => reasons.push(r)).verifyIdToken(
      await token({ phone: PHONE, audience: 'somebody-elses-project' }),
    )

    expect(result).toBeNull()
    expect(reasons).not.toHaveLength(0)
  })

  it('refuses a token whose issuer is not this project', async () => {
    const result = await verifier().verifyIdToken(
      await token({ phone: PHONE, issuer: 'https://securetoken.google.com/other' }),
    )

    expect(result).toBeNull()
  })
})

describe('signature and algorithm', () => {
  it('refuses a token signed by a key that is not the published one', async () => {
    const result = await verifier().verifyIdToken(
      await token({ phone: PHONE, signWith: foreignKey }),
    )

    expect(result).toBeNull()
  })

  it('refuses a token whose signature has been tampered with', async () => {
    /*
     * A bit is flipped in the DECODED signature rather than a character swapped in the base64url
     * text, because two different encodings can decode to the same bytes and the test would then
     * pass for the wrong reason.
     */
    const original = await token({ phone: PHONE })
    const [header, payload, signature] = original.split('.')
    const bytes = Buffer.from(signature ?? '', 'base64url')
    bytes[0] = (bytes[0] ?? 0) ^ 0x01

    const tampered = `${header ?? ''}.${payload ?? ''}.${bytes.toString('base64url')}`
    const result = await verifier().verifyIdToken(tampered)

    expect(result).toBeNull()
  })

  it('refuses an unsigned token claiming alg none', async () => {
    // Algorithm confusion. A permissive verifier that honours the token's own `alg` accepts this.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({
        sub: UID,
        phone_number: PHONE,
        iss: ISSUER,
        aud: PROJECT,
        exp: nowSeconds() + 3600,
      }),
    ).toString('base64url')

    const result = await verifier().verifyIdToken(`${header}.${payload}.`)

    expect(result).toBeNull()
  })
})

describe('expiry and claims', () => {
  it('refuses an expired token', async () => {
    const result = await verifier().verifyIdToken(await token({ phone: PHONE, expiresIn: '-1h' }))

    expect(result).toBeNull()
  })

  it('refuses a valid token that carries no phone number', async () => {
    /*
     * Not an attack. A token from an email or Google sign-in is entirely valid and simply cannot
     * establish what this application needs, so it establishes nothing.
     */
    const reasons: string[] = []
    const result = await verifier((r) => reasons.push(r)).verifyIdToken(await token())

    expect(result).toBeNull()
    expect(reasons).toContain('NO_PHONE_CLAIM')
  })

  it('refuses empty input without reaching the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await createFirebaseIdentityVerifier({ projectId: PROJECT }).verifyIdToken('  ')

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses garbage that is not a token at all', async () => {
    const result = await verifier().verifyIdToken('not-a-jwt')

    expect(result).toBeNull()
  })
})

describe('what a refusal reveals', () => {
  it('reports the reason to the operator callback and nothing to the caller', async () => {
    /*
     * Every failure returns the same value: null. The distinction between "expired" and "wrong
     * project" exists for whoever is diagnosing it, never for whoever presented the token, because
     * telling them which check failed tells them how close they got.
     */
    const reasons: string[] = []
    const v = verifier((r) => reasons.push(r))

    const expired = await v.verifyIdToken(await token({ phone: PHONE, expiresIn: '-1h' }))
    const foreign = await v.verifyIdToken(await token({ phone: PHONE, audience: 'other' }))

    expect(expired).toBeNull()
    expect(foreign).toBeNull()
    expect(reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('never passes the token itself to the callback', async () => {
    const secret = await token({ phone: PHONE, audience: 'other' })
    const reasons: string[] = []
    await verifier((r) => reasons.push(r)).verifyIdToken(secret)

    for (const reason of reasons) expect(secret).not.toContain(reason.slice(0, 20))
    expect(reasons.join(' ')).not.toContain(secret)
  })
})
