'use server'

/**
 * Authentication server actions.
 *
 * Thin by design: authenticate, validate with Zod, call a use case, translate the result. No
 * business rule lives here, and none lives in a React component.
 *
 * Every action returns a serialisable `ActionState` rather than throwing, so a form can render
 * its own error without a full error boundary — which matters on a connection where a hard
 * navigation is expensive.
 *
 * Refs: docs/03_ARCHITECTURE.md §4; docs/07_SECURITY.md §5
 */

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { developmentSignIn, requestOtp, selectRole, signOut, verifyOtp } from '@langgol/application'
import { isErr } from '@langgol/shared'
import { authMode, developmentDeps, otpDeps, authDeps } from '@/lib/deps'
import { getLocale } from '@/lib/locale'
import { clearSessionCookie, getSession, readSessionToken, setSessionCookie } from '@/lib/session'
import {
  destinationAfterSignIn,
  forgetOtpHandoff,
  handoffExpiry,
  readOtpHandoff,
  rememberOtpHandoff,
} from '@/lib/otp-handoff'
import { MAX_FULL_NAME_LENGTH, REGISTERABLE_ROLES } from '@/lib/otp-handoff-policy'
import type { ActionState } from './state'

/** Client-supplied strings are never trusted; the request's own metadata is. */
async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const list = await headers()
  const forwarded = list.get('x-forwarded-for')
  return {
    ipAddress: forwarded === null ? null : (forwarded.split(',')[0]?.trim() ?? null),
    userAgent: list.get('user-agent'),
  }
}

/**
 * Map a domain error onto a message key.
 *
 * The user never sees an internal message. Anything unrecognised becomes a generic apology, and
 * the detail stays in the logs where it belongs.
 */
function toActionState(code: string, meta: Record<string, unknown>): ActionState {
  switch (code) {
    case 'VALIDATION_FAILED':
      return {
        status: 'error',
        errorKey: meta['field'] === 'phone' ? 'errors.phoneInvalid' : 'errors.codeInvalid',
        field: typeof meta['field'] === 'string' ? meta['field'] : undefined,
      }
    case 'RATE_LIMITED':
      return {
        status: 'error',
        errorKey: 'errors.rateLimited',
        errorValues: {
          seconds: typeof meta['retryAfterSeconds'] === 'number' ? meta['retryAfterSeconds'] : 60,
        },
      }
    case 'PROVIDER_UNAVAILABLE':
      return { status: 'error', errorKey: 'errors.smsUnavailable' }
    case 'PRECONDITION_FAILED':
      return { status: 'error', errorKey: 'errors.accountSuspended' }
    case 'FORBIDDEN':
      return { status: 'error', errorKey: 'errors.notAllowed' }
    default:
      return { status: 'error', errorKey: 'errors.unexpected' }
  }
}

/* ------------------------------------------------------------------ OTP mode */

const PhoneSchema = z.object({ phone: z.string().min(1).max(32) })

export async function requestOtpAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (authMode() !== 'otp') return { status: 'error', errorKey: 'errors.unexpected' }

  const parsed = PhoneSchema.safeParse({ phone: formData.get('phone') })
  if (!parsed.success) return { status: 'error', errorKey: 'errors.phoneEmpty', field: 'phone' }

  const meta = await requestMeta()
  const result = await requestOtp(
    { phone: parsed.data.phone, locale: await getLocale(), ...meta, deviceId: null },
    await otpDeps(),
  )

  if (isErr(result)) return toActionState(result.error.code, result.error.meta)

  /*
   * The verify step needs the real number to find the challenge, and it is a separate request.
   * It travels in an HttpOnly cookie, never in the URL and never in a form field: a query string
   * reaches browser history and every `Referer`, and a form field would be attacker-controlled,
   * which would let a stolen code be redeemed against somebody else's number.
   */
  await rememberOtpHandoff(
    { phone: parsed.data.phone },
    handoffExpiry(new Date(), result.value.expiresInSeconds),
  )

  // The URL carries only the MASKED number, for the "we sent a code to …" line.
  redirect(`/auth/verify?to=${encodeURIComponent(result.value.maskedPhone)}`)
}

/* ------------------------------------------------------------------ registration */

const RegisterSchema = z.object({
  phone: z.string().min(1).max(32),
  fullName: z.string().trim().min(1).max(MAX_FULL_NAME_LENGTH),
  role: z.enum(REGISTERABLE_ROLES),
})

/**
 * Register: name and role first, then the code.
 *
 * The order is the point. Verifying first and asking afterwards needs somewhere to hang the
 * half-made account while the questions are answered — a session a brand-new user does not have,
 * or a user row with no name and no role, which is a state nothing else in the system is
 * prepared for. Asking first means the account is created complete in a single write, or not at
 * all.
 *
 * The answers travel in the same HttpOnly cookie as the phone. `verifyOtp` re-checks the role
 * against its own allowlist regardless — this action is the outer of two gates.
 *
 * Note that this deliberately does NOT tell the caller whether the number is already registered.
 * An existing user who comes through this screen simply signs in, and their stored name and
 * roles are left untouched. Reporting "that number already exists" would turn the register form
 * into an oracle for which numbers hold accounts.
 */
export async function registerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (authMode() !== 'otp') return { status: 'error', errorKey: 'errors.unexpected' }

  const parsed = RegisterSchema.safeParse({
    phone: formData.get('phone'),
    fullName: formData.get('fullName'),
    role: formData.get('role'),
  })
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    return {
      status: 'error',
      errorKey:
        field === 'phone'
          ? 'errors.phoneEmpty'
          : field === 'fullName'
            ? 'errors.nameEmpty'
            : 'errors.notAllowed',
      field: typeof field === 'string' ? field : undefined,
    }
  }

  const meta = await requestMeta()
  const result = await requestOtp(
    { phone: parsed.data.phone, locale: await getLocale(), ...meta, deviceId: null },
    await otpDeps(),
  )

  if (isErr(result)) return toActionState(result.error.code, result.error.meta)

  await rememberOtpHandoff(
    {
      phone: parsed.data.phone,
      signup: { fullName: parsed.data.fullName, role: parsed.data.role },
    },
    handoffExpiry(new Date(), result.value.expiresInSeconds),
  )

  redirect(`/auth/verify?to=${encodeURIComponent(result.value.maskedPhone)}`)
}

/*
 * No `phone` field, deliberately. It used to be here, backed by a hidden input the page had no
 * way to populate — the page only ever holds the masked number — so it always posted "" and
 * every correct code was reported invalid. The number now comes from the handoff cookie, which
 * also means a caller cannot choose whose challenge they are answering.
 */
const VerifySchema = z.object({ code: z.string().min(1).max(8) })

export async function verifyOtpAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (authMode() !== 'otp') return { status: 'error', errorKey: 'errors.unexpected' }

  const handoff = await readOtpHandoff()
  if (handoff === null) {
    // The cookie expired, or this browser never asked for a code. Sending them back to request
    // one is the only honest answer; the challenge cannot be found without the number.
    return { status: 'error', errorKey: 'errors.codeExpired', field: 'code' }
  }

  const parsed = VerifySchema.safeParse({ code: formData.get('code') })
  if (!parsed.success) return { status: 'error', errorKey: 'errors.codeInvalid', field: 'code' }

  const meta = await requestMeta()
  const locale = await getLocale()

  const result = await verifyOtp(
    {
      phone: handoff.phone,
      code: parsed.data.code,
      /*
       * From the cookie, never from the form. The name and role were shown to the person on the
       * register screen and set server-side there; a hidden field here would let a caller attach
       * a different role to a verification they had already begun.
       *
       * An existing account ignores this entirely — `verifyOtp` uses it only when there is no
       * user to find — so a returning farmer who happens to come through the register screen
       * signs in with their stored roles untouched.
       */
      ...(handoff.signup !== undefined
        ? {
            signup: {
              fullName: handoff.signup.fullName,
              // The use case re-checks this against its own allowlist; the cookie is not the
              // boundary, it is the outer of two gates.
              role: handoff.signup.role,
              preferredLanguage: locale === 'bn' ? ('BN' as const) : ('EN' as const),
            },
          }
        : {}),
      ...meta,
    },
    await otpDeps(),
  )

  if (isErr(result)) return toActionState(result.error.code, result.error.meta)

  // Spent. A number left in a cookie after the code it accompanied is gone serves no purpose.
  await forgetOtpHandoff()

  await setSessionCookie(result.value.sessionToken, result.value.expiresAt)

  /*
   * A brand-new account already chose its role on the register screen, so sending it to
   * `/auth/role` would ask the same question twice. A returning user has roles already. Either
   * way the role screen is the wrong next step; it stays reachable for somebody who wants to add
   * a second role.
   */
  redirect(destinationAfterSignIn(result.value.roles))
}

/* ---------------------------------------------------------- development mode */

const DevelopmentSchema = z.object({ identityKey: z.string().min(1).max(64) })

export async function developmentSignInAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = DevelopmentSchema.safeParse({ identityKey: formData.get('identityKey') })
  if (!parsed.success) return { status: 'error', errorKey: 'errors.unexpected' }

  const meta = await requestMeta()
  const result = await developmentSignIn(
    { identityKey: parsed.data.identityKey, ...meta },
    await developmentDeps(),
  )

  if (isErr(result)) return toActionState(result.error.code, result.error.meta)

  await setSessionCookie(result.value.sessionToken, result.value.expiresAt)

  // The same destination rule as a real sign-in, so signing in as the farmer fixture exercises
  // the farmer's actual first screen rather than a path only development takes.
  redirect(destinationAfterSignIn(result.value.roles))
}

/* ------------------------------------------------------------ role selection */

const RoleSchema = z.object({ role: z.string().min(1).max(32) })

export async function selectRoleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession()
  if (session === null) redirect('/auth')

  const parsed = RoleSchema.safeParse({ role: formData.get('role') })
  if (!parsed.success) return { status: 'error', errorKey: 'errors.unexpected' }

  // ADMIN and OPS_AGENT are rejected here, on the server, whatever the form offered.
  const result = await selectRole(
    { userId: session.userId, role: parsed.data.role },
    await authDeps(),
  )

  if (isErr(result)) return toActionState(result.error.code, result.error.meta)

  // Somebody who has just said they want to sell has setup left to do; anybody else came to buy.
  redirect(destinationAfterSignIn([parsed.data.role]))
}

/* --------------------------------------------------------------------- exit */

export async function signOutAction(formData: FormData): Promise<void> {
  const session = await getSession()
  const token = await readSessionToken()

  if (session !== null && token !== null) {
    await signOut(
      {
        sessionToken: token,
        userId: session.userId,
        everywhere: formData.get('everywhere') === 'true',
      },
      await authDeps(),
    )
  }

  await clearSessionCookie()
  redirect('/')
}
