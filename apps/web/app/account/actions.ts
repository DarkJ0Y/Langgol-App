'use server'

/**
 * Account and role server actions.
 *
 * Every action here does three things in the same order, and the order is the point:
 *
 *   1. **Validate** the input with Zod — the audit found the marketplace actions reading
 *      `String(formData.get(…))` while the auth actions used schemas, and that inconsistency is
 *      how an unvalidated field eventually ships.
 *   2. **Authorize** through the policy engine, not an inline `if`.
 *   3. **Delegate** to a use case, which authorizes again. Two checks is not redundancy: the
 *      action guards the transport and the use case guards the operation, and the use case is
 *      what a future job or CLI will call without ever passing through here.
 *
 * Results are message KEYS, never sentences. A farmer reading in Bangla must not be handed an
 * English string because it was convenient to write one here.
 *
 * Refs: docs/07_SECURITY.md §4, §5; docs/08_BANGLADESH_CONTEXT.md §1
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  assignRole as assignRoleUseCase,
  getCurrentUser as getCurrentUserUseCase,
  listRoles as listRolesUseCase,
  removeRole as removeRoleUseCase,
  updateCurrentUser as updateCurrentUserUseCase,
} from '@langgol/application'
import { GENDERS, LANGUAGES, ROLES } from '@langgol/domain/identity'
import type { MessageKey } from '@langgol/i18n'
import { accountDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import type { AccountActionState } from './state'

/* --------------------------------------------------------------- validation */

/**
 * `.trim()` runs before the length checks, so a field of three spaces fails as empty rather than
 * passing as three characters. Optional fields accept an empty string and mean it as "clear this".
 */
const ProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().max(254).optional(),
  preferredLanguage: z.enum(LANGUAGES).optional(),
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/)
    .optional(),
  gender: z.union([z.enum(GENDERS), z.literal('')]).optional(),
})

const AssignRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES),
})

const RemoveRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES),
  reason: z.string().trim().min(1).max(500),
})

/** Only send a key when the form actually carried it, so a partial update stays partial. */
function present(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)
  return value === null ? undefined : String(value)
}

/**
 * Map a domain error onto a message key.
 *
 * The user never sees an internal message. Anything unrecognised becomes a generic apology and
 * the detail stays in the logs, where it belongs.
 */
function toActionState(code: string, meta: Record<string, unknown>): AccountActionState {
  const field = typeof meta['field'] === 'string' ? meta['field'] : undefined
  const cause = typeof meta['code'] === 'string' ? meta['code'] : undefined

  if (code === 'VALIDATION_FAILED') {
    const key: MessageKey =
      cause === 'NAME_EMPTY'
        ? 'errors.nameEmpty'
        : cause === 'NAME_TOO_LONG'
          ? 'errors.nameTooLong'
          : cause === 'EMAIL_INVALID'
            ? 'errors.emailInvalid'
            : cause === 'DOB_UNDERAGE'
              ? 'errors.dateOfBirthUnderage'
              : field === 'dateOfBirth'
                ? 'errors.dateInvalid'
                : 'errors.unexpected'
    return { status: 'error', errorKey: key, field }
  }

  switch (code) {
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
      return { status: 'error', errorKey: 'errors.notAllowed' }
    case 'NOT_FOUND':
      return { status: 'error', errorKey: 'errors.notFound' }
    default:
      return { status: 'error', errorKey: 'errors.unexpected' }
  }
}

/* ---------------------------------------------------------- get current user */

export async function getCurrentUserAction() {
  const deps = await accountDeps()
  const result = await getCurrentUserUseCase(await currentActor(), deps)
  return result.ok ? { ok: true as const, user: result.value } : { ok: false as const }
}

/* ------------------------------------------------------- update current user */

export async function updateProfileAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const parsed = ProfileSchema.safeParse({
    fullName: present(formData, 'fullName'),
    email: present(formData, 'email'),
    preferredLanguage: present(formData, 'preferredLanguage'),
    dateOfBirth: present(formData, 'dateOfBirth'),
    gender: present(formData, 'gender'),
  })

  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0]
    const field = path === undefined ? undefined : String(path)
    return {
      status: 'error',
      errorKey:
        field === 'fullName'
          ? 'errors.nameEmpty'
          : field === 'email'
            ? 'errors.emailInvalid'
            : field === 'dateOfBirth'
              ? 'errors.dateInvalid'
              : 'errors.unexpected',
      field,
    }
  }

  const deps = await accountDeps()
  const result = await updateCurrentUserUseCase(
    await currentActor(),
    {
      ...(parsed.data.fullName !== undefined ? { fullName: parsed.data.fullName } : {}),
      // An empty string from a cleared input means null, not "".
      ...(parsed.data.email !== undefined ? { email: parsed.data.email || null } : {}),
      ...(parsed.data.preferredLanguage !== undefined
        ? { preferredLanguage: parsed.data.preferredLanguage }
        : {}),
      ...(parsed.data.dateOfBirth !== undefined
        ? { dateOfBirth: parsed.data.dateOfBirth || null }
        : {}),
      ...(parsed.data.gender !== undefined ? { gender: parsed.data.gender || null } : {}),
    },
    deps,
  )

  if (!result.ok) return toActionState(result.error.code, result.error.meta)

  revalidatePath('/account')
  return { status: 'ok', noticeKey: 'account.saved' }
}

/* ---------------------------------------------------------------- get roles */

export async function getRolesAction() {
  const deps = await accountDeps()
  const result = await listRolesUseCase(await currentActor(), deps)
  return result.ok
    ? { ok: true as const, definitions: result.value.definitions }
    : { ok: false as const, definitions: [] }
}

/* ------------------------------------------------------------- assign a role */

export async function assignRoleAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const parsed = AssignRoleSchema.safeParse({
    userId: present(formData, 'userId'),
    role: present(formData, 'role'),
  })

  if (!parsed.success) return { status: 'error', errorKey: 'errors.unexpected' }

  /*
   * The use case picks the right permission for the role — ordinary versus privileged — and
   * audits a refusal. Deliberately not re-derived here: one place decides which question to ask.
   */
  const deps = await accountDeps()
  const result = await assignRoleUseCase(
    await currentActor(),
    { targetUserId: parsed.data.userId, role: parsed.data.role },
    deps,
  )

  if (!result.ok) return toActionState(result.error.code, result.error.meta)

  revalidatePath('/account')
  return {
    status: 'ok',
    noticeKey: result.value.added ? 'account.roleAdded' : 'account.roleAlreadyHeld',
  }
}

/* ------------------------------------------------------------- remove a role */

export async function removeRoleAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const parsed = RemoveRoleSchema.safeParse({
    userId: present(formData, 'userId'),
    role: present(formData, 'role'),
    reason: present(formData, 'reason'),
  })

  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0]
    return path === 'reason'
      ? { status: 'error', errorKey: 'errors.reasonRequired', field: 'reason' }
      : { status: 'error', errorKey: 'errors.unexpected' }
  }

  const deps = await accountDeps()
  const result = await removeRoleUseCase(
    await currentActor(),
    {
      targetUserId: parsed.data.userId,
      role: parsed.data.role,
      reason: parsed.data.reason,
    },
    deps,
  )

  if (!result.ok) {
    /*
     * Refusing to let an administrator revoke their own privileged role is a validation failure
     * with no field attached, and it needs its own sentence — a generic "something went wrong"
     * would send them round the same loop again.
     */
    if (
      result.error.code === 'VALIDATION_FAILED' &&
      typeof result.error.meta['field'] !== 'string'
    ) {
      return { status: 'error', errorKey: 'errors.cannotRemoveOwnRole' }
    }
    return toActionState(result.error.code, result.error.meta)
  }

  revalidatePath('/account')
  return {
    status: 'ok',
    noticeKey: result.value.removed ? 'account.roleRemoved' : 'account.roleNotHeld',
  }
}
