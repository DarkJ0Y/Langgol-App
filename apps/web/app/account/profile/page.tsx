import { redirect } from 'next/navigation'
import {
  getMyRoleProfile,
  listAddresses,
  listAreaChildren,
  roleProfileFields,
} from '@langgol/application'
import { PROFILE_ROLES, type FieldDescriptor, type ProfileRole } from '@langgol/domain/profiles'
import { isActor } from '@langgol/domain/policy'
import { createTranslator, type Translator } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { isErr, isOk } from '@langgol/shared'
import { locationDeps, roleProfileDeps } from '@/lib/deps'
import { getLocale } from '@/lib/locale'
import { currentActor } from '@/lib/guard'
import { hasServiceArea } from './form'
import { fieldHint, fieldLabel, initialValue, optionsFor, roleLabel } from './labels'
import { RoleProfileForm, type Option, type RenderField } from './role-profile-form'

/**
 * The onboarding and settings screen for the six non-farmer role profiles.
 *
 * One route, not six. Which role it shows is `?role=`, defaulting to the first the caller
 * actually holds — and a role they do not hold is refused by the use case, not by an `if` here,
 * so the URL cannot be edited into somebody else's questionnaire.
 *
 * Reachable straight after registration and from the account page, and it is the same screen both
 * times. A separate "edit" variant would be two forms to keep in step, and the second one is
 * always the one that misses a field.
 */

/** Which of the caller's roles carry a profile, in the catalogue's order. */
function profileRolesOf(roles: readonly string[]): readonly ProfileRole[] {
  return PROFILE_ROLES.filter((role) => roles.includes(role))
}

/**
 * A descriptor as the client component renders it.
 *
 * The descriptor's `guard` is a FUNCTION and cannot cross into a client component, so this maps
 * the domain's shape onto a serialisable one. The mapping is the only place the two vocabularies
 * meet: adding a `FieldKind` that is not handled here is a type error, not a blank space on a
 * screen.
 */
function renderField(
  t: Translator,
  field: FieldDescriptor,
  stored: unknown,
  addresses: readonly Option[],
): RenderField {
  const hint = fieldHint(t, field)
  const base = {
    name: field.name,
    label: fieldLabel(t, field),
    ...(hint === undefined ? {} : { hint }),
    ...(field.required === true ? { required: true } : {}),
    value: initialValue(field, stored),
  }

  switch (field.kind.kind) {
    case 'address':
      // The caller's OWN address book, and only ever theirs — `listAddresses` takes no user id.
      return { ...base, control: 'address', options: addresses }
    case 'geo':
      return { ...base, control: 'geo' }
    case 'longText':
      return { ...base, control: 'longText' }
    case 'integer':
      return { ...base, control: 'number' }
    case 'money':
      return { ...base, control: 'money' }
    case 'boolean':
      return { ...base, control: 'boolean' }
    case 'choice':
      return { ...base, control: 'choice', options: optionsFor(t, field.kind.options) }
    case 'multi':
      // An empty vocabulary means free text — a certification is whatever its issuer called it.
      return field.kind.options.length === 0
        ? { ...base, control: 'list' }
        : { ...base, control: 'multi', options: optionsFor(t, field.kind.options) }
    default:
      // text, tin, bin and licence are all single-line entry. The FORMAT rules are the domain's,
      // and duplicating them as browser patterns would give them a second home to drift in.
      return { ...base, control: 'text' }
  }
}

/**
 * The districts a service area may be declared over.
 *
 * District rather than upazila: "which districts do you cover" is a question with sixty-four
 * answers, while the upazila version has about five hundred, and a transporter who covers a
 * division would be ticking boxes for a quarter of an hour. The schema stores an admin area id
 * at any level, so a finer picker can be added later without a migration.
 */
async function districtOptions(
  actor: Awaited<ReturnType<typeof currentActor>>,
  t: Translator,
): Promise<readonly Option[]> {
  const deps = locationDeps()
  const divisions = await listAreaChildren(actor, null, await deps)
  if (isErr(divisions)) return []

  const perDivision = await Promise.all(
    divisions.value.areas.map(async (division) => {
      const children = await listAreaChildren(actor, division.id, await deps)
      return isOk(children) ? children.value.areas : []
    }),
  )

  return perDivision.flat().map((district) => ({
    value: district.id,
    label: t.locale === 'bn' ? district.nameBn : district.nameEn,
  }))
}

/**
 * The caller's address book, as options.
 *
 * Read through the use case, which takes no user id at all — so this list is the signed-in
 * person's own by construction rather than by a filter somebody could omit. A profile may only
 * point at one of these, and the use case checks that again before writing.
 *
 * Labelled the way the address list labels them, so the entry a person picks here reads exactly
 * as it does on the page where they created it.
 */
async function addressOptions(
  actor: Awaited<ReturnType<typeof currentActor>>,
  locale: string,
): Promise<readonly Option[]> {
  const result = await listAddresses(actor, await locationDeps())
  if (isErr(result)) return []

  return result.value.map((address) => {
    const area = address.areaPath
      .map((step) => (locale === 'bn' ? step.nameBn : step.nameEn))
      .join(', ')
    const name = address.label ?? address.recipientName
    return { value: address.id, label: area === '' ? name : `${name} — ${area}` }
  })
}

export default async function RoleProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await currentActor()
  if (!isActor(actor)) redirect('/auth')

  const mine = profileRolesOf(actor.roles)
  // Somebody holding only FARMER has a richer questionnaire of their own; send them to it.
  if (mine.length === 0) redirect(actor.roles.includes('FARMER') ? '/farmer/onboarding' : '/')

  const requested = (await searchParams)['role']
  const asked = Array.isArray(requested) ? requested[0] : requested
  const role = mine.find((candidate) => candidate === asked) ?? (mine[0] as ProfileRole)

  const result = await getMyRoleProfile(actor, role, await roleProfileDeps())
  if (isErr(result)) redirect(result.error.code === 'UNAUTHENTICATED' ? '/auth' : '/account')

  const { profile, completion } = result.value
  const t = createTranslator(await getLocale())

  /*
   * Loaded only when the role actually asks for an address. A logistics provider's form has no
   * address question, and fetching an address book to render nothing is a query on every page
   * view for a list nobody sees.
   */
  const wantsAddress = roleProfileFields(role).some((field) => field.kind.kind === 'address')
  const addresses = wantsAddress ? await addressOptions(actor, t.locale) : []

  const fields = roleProfileFields(role).map((field) =>
    renderField(t, field, profile.fields[field.name] ?? null, addresses),
  )

  const serviceAreas = hasServiceArea(role) ? await districtOptions(actor, t) : undefined

  return (
    <Card>
      <h1 className="lg-title">{t.t('profile.title')}</h1>
      <p className="lg-subtitle">{t.t('profile.subtitle')}</p>

      {/*
       * Shown only to somebody who actually holds more than one — a shopkeeper who also buys for
       * their household. Rendering a single-item switcher would imply there is somewhere else to
       * go.
       */}
      {mine.length > 1 ? (
        <nav className="lg-row" aria-label={t.t('profile.title')}>
          {mine.map((candidate) => (
            <LinkButton
              key={candidate}
              href={`/account/profile?role=${candidate}`}
              variant={candidate === role ? 'primary' : 'ghost'}
            >
              {roleLabel(t, candidate)}
            </LinkButton>
          ))}
        </nav>
      ) : null}

      <p className="lg-hint">
        {roleLabel(t, role)} · {t.t('profile.completion', { percent: completion.percent })}
      </p>

      <RoleProfileForm
        role={role}
        fields={fields}
        {...(serviceAreas === undefined ? {} : { serviceAreas })}
        chosenServiceAreas={profile.serviceAreaIds}
        labels={{
          optionalNote: t.t('profile.subtitle'),
          notAnswered: t.t('profile.notAnswered'),
          yes: t.t('profile.yes'),
          no: t.t('profile.no'),
          save: t.t('profile.save'),
          loading: t.t('common.loading'),
          saved: t.t('profile.saved'),
          serviceArea: t.t('profile.serviceArea'),
          serviceAreaHint: t.t('profile.serviceAreaHint'),
          latitude: t.t('profile.latitude'),
          longitude: t.t('profile.longitude'),
          addressNone: t.t('profile.addressNone'),
          addressAdd: t.t('profile.addressAdd'),
          errorUnexpected: t.t('errors.unexpected'),
          messages: {
            'errors.profileRequired': t.t('errors.profileRequired'),
            'errors.profileTooLong': t.t('errors.profileTooLong'),
            'errors.profileNotNumber': t.t('errors.profileNotNumber'),
            'errors.profileOutOfRange': t.t('errors.profileOutOfRange'),
            'errors.profileNotAmount': t.t('errors.profileNotAmount'),
            'errors.profileUnknownValue': t.t('errors.profileUnknownValue'),
            'errors.profileTooMany': t.t('errors.profileTooMany'),
            'errors.profileTinInvalid': t.t('errors.profileTinInvalid'),
            'errors.profileBinInvalid': t.t('errors.profileBinInvalid'),
            'errors.profileLicenceInvalid': t.t('errors.profileLicenceInvalid'),
            'errors.profileAddressUnknown': t.t('errors.profileAddressUnknown'),
            'errors.profileGeoPair': t.t('errors.profileGeoPair'),
            'errors.profileGeoInvalid': t.t('errors.profileGeoInvalid'),
            'errors.profileGeoSwapped': t.t('errors.profileGeoSwapped'),
            'errors.profileGeoOutOfBounds': t.t('errors.profileGeoOutOfBounds'),
            'errors.notAllowed': t.t('errors.notAllowed'),
            'errors.notFound': t.t('errors.notFound'),
            'errors.unexpected': t.t('errors.unexpected'),
          },
        }}
      />

      {/* Leaving is a first-class option, not a dead end. Every question here can wait. */}
      <LinkButton href="/account" variant="ghost">
        {t.t('common.back')}
      </LinkButton>
    </Card>
  )
}
