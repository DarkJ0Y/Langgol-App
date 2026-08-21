/**
 * The role catalogue.
 *
 * Langgol already had a normalised many-to-many role model — a `User` joined to roles through
 * `UserRoleAssignment` — so this module does not introduce one. It gives that model a single
 * source of truth for *which roles exist*, *which may be self-selected*, and *what each one
 * means*, so those facts stop being scattered across a Prisma enum, a TypeScript union and a
 * hard-coded array in a use case.
 *
 * **Why roles stay an enum rather than becoming rows.** A role here is not data an administrator
 * invents at runtime; it is a term the authorization engine reasons about at compile time.
 * `RULES` in `policy.ts` is an exhaustive `Record<Action, Rule>`, so adding an action without a
 * rule is a type error — that guarantee only holds while the role vocabulary is known to the
 * compiler. Runtime-creatable roles would trade a compile-time proof for a runtime lookup, on the
 * one part of the system that decides who may move money.
 *
 * What roles DO need from the database is presentation and ordering, which is what the
 * `RoleDefinition` table carries: Bangla and English names, a description, and whether the role
 * may be picked from a menu. The enum is the identity; the table is the label.
 *
 * Refs: docs/07_SECURITY.md §4.1, §5.1; docs/01_MVP_REQUIREMENTS.md §2
 */

/**
 * Every role the platform recognises.
 *
 * Ordered as the product thinks of them: the people who grow and buy first, the people who move
 * and supply next, then the people who operate the platform.
 */
export const ROLES = [
  'FARMER',
  'CONSUMER',
  'RETAILER',
  'WHOLESALER',
  'SUPPLIER',
  'AGRICULTURAL_EXPERT',
  'LOGISTICS_PROVIDER',
  'OPS_AGENT',
  'ADMIN',
] as const

export type Role = (typeof ROLES)[number]

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}

/**
 * Roles a person may choose for themselves at signup.
 *
 * Everything absent from this list is a **controlled role**: granted by an administrator,
 * recorded with a grantor, never picked from a menu. The distinction is the whole reason role
 * assignment is a separate operation from role selection.
 *
 * `WHOLESALER` and `SUPPLIER` are deliberately NOT self-selectable even though they are ordinary
 * commercial parties: both buy or sell at volumes where a trade licence matters, and letting an
 * account claim them unverified would put unlicensed sellers in front of buyers. They become
 * self-selectable only if and when the verification flow that checks a licence exists.
 */
export const SELF_SELECTABLE_ROLES = ['FARMER', 'CONSUMER', 'RETAILER'] as const

export type SelfSelectableRole = (typeof SELF_SELECTABLE_ROLES)[number]

export function isSelfSelectableRole(value: string): value is SelfSelectableRole {
  return (SELF_SELECTABLE_ROLES as readonly string[]).includes(value)
}

/**
 * Roles that only an administrator may grant.
 *
 * Derived rather than listed, so a role added to `ROLES` and forgotten here is controlled by
 * default. Failing closed is the only safe direction for a privilege list.
 */
export const CONTROLLED_ROLES: readonly Role[] = ROLES.filter((role) => !isSelfSelectableRole(role))

export function isControlledRole(value: string): boolean {
  return isRole(value) && !isSelfSelectableRole(value)
}

/**
 * Roles that confer platform privilege.
 *
 * Separated from "controlled" because the two answer different questions. `WHOLESALER` is
 * controlled (it needs verification) but confers no power over other users; `ADMIN` and
 * `OPS_AGENT` do. Anything here warrants a stricter grant path and louder auditing.
 */
export const PRIVILEGED_ROLES: readonly Role[] = ['ADMIN', 'OPS_AGENT']

export function isPrivilegedRole(value: string): boolean {
  return (PRIVILEGED_ROLES as readonly string[]).includes(value)
}

/**
 * Static metadata, mirrored into the `RoleDefinition` table by the seed.
 *
 * Kept here as well as in the database because the seed must come from somewhere authoritative,
 * and because a build-time constant lets the UI label a role without a query when it already has
 * the enum value in hand.
 */
export interface RoleDescriptor {
  readonly role: Role
  readonly nameBn: string
  readonly nameEn: string
  readonly descriptionBn: string
  readonly descriptionEn: string
  readonly selfSelectable: boolean
  readonly privileged: boolean
  readonly sortOrder: number
}

export const ROLE_CATALOGUE: readonly RoleDescriptor[] = [
  {
    role: 'FARMER',
    nameBn: 'কৃষক',
    nameEn: 'Farmer',
    descriptionBn: 'ফসল ফলান ও বিক্রি করেন',
    descriptionEn: 'Grows and sells produce',
    selfSelectable: true,
    privileged: false,
    sortOrder: 10,
  },
  {
    role: 'CONSUMER',
    nameBn: 'ক্রেতা',
    nameEn: 'Consumer',
    descriptionBn: 'ঘরের জন্য কেনেন',
    descriptionEn: 'Buys for their household',
    selfSelectable: true,
    privileged: false,
    sortOrder: 20,
  },
  {
    role: 'RETAILER',
    nameBn: 'খুচরা বিক্রেতা',
    nameEn: 'Retailer',
    descriptionBn: 'দোকান বা হোটেলের জন্য পাইকারি কেনেন',
    descriptionEn: 'Buys in bulk for a shop or restaurant',
    selfSelectable: true,
    privileged: false,
    sortOrder: 30,
  },
  {
    role: 'WHOLESALER',
    nameBn: 'পাইকার',
    nameEn: 'Wholesaler',
    descriptionBn: 'বড় পরিমাণে কেনেন ও অন্য বিক্রেতাদের কাছে বেচেন',
    descriptionEn: 'Buys at volume and sells on to other sellers',
    selfSelectable: false,
    privileged: false,
    sortOrder: 40,
  },
  {
    role: 'SUPPLIER',
    nameBn: 'সরবরাহকারী',
    nameEn: 'Supplier',
    descriptionBn: 'বীজ, সার ও কৃষি উপকরণ সরবরাহ করেন',
    descriptionEn: 'Supplies seed, fertiliser and farm inputs',
    selfSelectable: false,
    privileged: false,
    sortOrder: 50,
  },
  {
    role: 'AGRICULTURAL_EXPERT',
    nameBn: 'কৃষি বিশেষজ্ঞ',
    nameEn: 'Agricultural expert',
    descriptionBn: 'ফসল ও রোগ নিয়ে পরামর্শ দেন',
    descriptionEn: 'Advises on crops and plant disease',
    selfSelectable: false,
    privileged: false,
    sortOrder: 60,
  },
  {
    role: 'LOGISTICS_PROVIDER',
    nameBn: 'পরিবহনকারী',
    nameEn: 'Logistics provider',
    descriptionBn: 'ফসল এক জায়গা থেকে আরেক জায়গায় পৌঁছে দেন',
    descriptionEn: 'Moves produce from one place to another',
    selfSelectable: false,
    privileged: false,
    sortOrder: 70,
  },
  {
    role: 'OPS_AGENT',
    nameBn: 'মাঠকর্মী',
    nameEn: 'Field agent',
    descriptionBn: 'কৃষকদের নিবন্ধনে ও ডেলিভারিতে সাহায্য করেন',
    descriptionEn: 'Assists farmers with onboarding and delivery',
    selfSelectable: false,
    privileged: true,
    sortOrder: 80,
  },
  {
    role: 'ADMIN',
    nameBn: 'প্রশাসক',
    nameEn: 'Administrator',
    descriptionBn: 'প্ল্যাটফর্ম পরিচালনা করেন',
    descriptionEn: 'Operates the platform',
    selfSelectable: false,
    privileged: true,
    sortOrder: 90,
  },
]

export function roleDescriptor(role: Role): RoleDescriptor {
  const found = ROLE_CATALOGUE.find((entry) => entry.role === role)
  if (!found) {
    // Unreachable while the catalogue covers ROLES, which a test asserts. Throwing rather than
    // returning a placeholder keeps a missing entry loud instead of shipping a blank label.
    throw new Error(`No catalogue entry for role "${role}"`)
  }
  return found
}

export function roleLabel(role: Role, locale: 'bn' | 'en'): { name: string; description: string } {
  const descriptor = roleDescriptor(role)
  return locale === 'bn'
    ? { name: descriptor.nameBn, description: descriptor.descriptionBn }
    : { name: descriptor.nameEn, description: descriptor.descriptionEn }
}
