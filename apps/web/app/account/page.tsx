import { redirect } from 'next/navigation'
import { emailVerificationStatus, getCurrentUser, getUserRoles } from '@langgol/application'
import { GENDERS, LANGUAGES, isRole, maskEmail, roleLabel } from '@langgol/domain/identity'
import { PROFILE_ROLES } from '@langgol/domain/profiles'
import { createTranslator } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { accountDeps, emailVerificationDeps } from '@/lib/deps'
import { authorize, currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import { ProfileForm } from './profile-form'
import { RoleAdmin } from './role-admin'
import { VerificationPanel } from './verification-panel'

/**
 * The signed-in user's own account.
 *
 * Reads through the use cases rather than the repository, so the same authorization that guards
 * an action guards a page render. `getCurrentUser` takes no user id at all — there is no argument
 * here that could be pointed at somebody else.
 *
 * The role-administration panel renders only for an actor the policy engine says may assign
 * roles. That is a courtesy to the UI, not the boundary: the actions authorize independently, so
 * a hidden form is not a security control and is not treated as one.
 *
 * Refs: docs/07_SECURITY.md §4, §5
 */
export default async function AccountPage() {
  const actor = await currentActor()
  const deps = await accountDeps()

  const profileResult = await getCurrentUser(actor, deps)
  if (!profileResult.ok) redirect('/auth')
  const profile = profileResult.value

  const locale = await getLocale()
  const t = createTranslator(locale)

  const rolesResult = await getUserRoles(actor, profile.id, deps)
  const held = rolesResult.ok ? rolesResult.value.roles : []

  const mayAdminister = await authorize('role:assign')

  const emailStatus = await emailVerificationStatus(actor, await emailVerificationDeps())

  const genderLabels: Record<string, string> = {
    FEMALE: t.t('account.genderFemale'),
    MALE: t.t('account.genderMale'),
    OTHER: t.t('account.genderOther'),
    PREFER_NOT_TO_SAY: t.t('account.genderPreferNotToSay'),
  }

  return (
    <div className="lg-stack lg-cards">
      <Card>
        <h1 className="lg-title">{t.t('account.title')}</h1>
        <p className="lg-subtitle">{t.t('account.subtitle')}</p>

        <ProfileForm
          defaults={{
            fullName: profile.fullName,
            email: profile.email ?? '',
            preferredLanguage: profile.preferredLanguage,
            // The input wants YYYY-MM-DD, and the column is a DATE — no time zone to lose here.
            dateOfBirth: profile.dateOfBirth?.toISOString().slice(0, 10) ?? '',
            gender: profile.gender ?? '',
          }}
          phone={profile.phone}
          languages={LANGUAGES.map((code) => ({
            value: code,
            // Each language names itself, in itself. A reader looking for their own language
            // should not have to read the other one to find it.
            label: code === 'BN' ? 'বাংলা' : 'English',
          }))}
          genders={GENDERS.map((value) => ({ value, label: genderLabels[value] ?? value }))}
          labels={{
            name: t.t('account.nameLabel'),
            phone: t.t('account.phoneLabel'),
            phoneLocked: t.t('account.phoneLocked'),
            email: t.t('account.emailLabel'),
            emailHint: t.t('account.emailHint'),
            dateOfBirth: t.t('account.dateOfBirthLabel'),
            gender: t.t('account.genderLabel'),
            genderUnset: t.t('account.genderUnset'),
            language: t.t('account.languageLabel'),
            submit: t.t('common.save'),
            loading: t.t('common.loading'),
            saved: t.t('account.saved'),
            errorNameEmpty: t.t('errors.nameEmpty'),
            errorNameTooLong: t.t('errors.nameTooLong'),
            errorEmailInvalid: t.t('errors.emailInvalid'),
            errorDateInvalid: t.t('errors.dateInvalid'),
            errorUnderage: t.t('errors.dateOfBirthUnderage'),
            errorNotAllowed: t.t('errors.notAllowed'),
            errorUnexpected: t.t('errors.unexpected'),
          }}
        />
      </Card>

      <Card>
        <h2 className="lg-title">{t.t('verify.phoneTitle')}</h2>
        <VerificationPanel
          phoneVerified={profile.phoneVerifiedAt !== null}
          // Masked before it crosses to the browser.
          email={profile.email === null ? null : maskEmail(profile.email)}
          emailVerified={profile.emailVerifiedAt !== null}
          emailAvailable={emailStatus.ok && emailStatus.value.available}
          labels={{
            phoneVerified: t.t('verify.phoneVerified'),
            phoneUnverified: t.t('verify.phoneUnverified'),
            verifyPhone: t.t('verify.sendCode'),
            emailOptional: t.t('verify.emailOptional'),
            emailVerified: t.t('verify.emailVerified'),
            emailUnverified: t.t('verify.emailUnverified'),
            emailSend: t.t('verify.emailSend'),
            emailSent: t.t('verify.emailSent', {
              email: profile.email === null ? '' : maskEmail(profile.email),
            }),
            emailUnavailable: t.t('verify.emailUnavailable'),
            loading: t.t('common.loading'),
            rateLimited: t.t('errors.rateLimited', { seconds: '{seconds}' }),
            unexpected: t.t('errors.unexpected'),
          }}
        />
      </Card>

      {/*
       * The way in to the role questionnaire.
       *
       * Shown only to somebody who holds a role that has one — a farmer's questions live on
       * their own richer screen, and offering an empty one to an account with no such role
       * would be a door onto nothing.
       */}
      {held.some((assignment) => (PROFILE_ROLES as readonly string[]).includes(assignment.role)) ? (
        <Card>
          <h2 className="lg-title">{t.t('profile.title')}</h2>
          <p className="lg-subtitle">{t.t('profile.subtitle')}</p>
          <LinkButton href="/account/profile" variant="secondary">
            {t.t('profile.open')}
          </LinkButton>
        </Card>
      ) : null}

      <Card>
        <h2 className="lg-title">{t.t('address.title')}</h2>
        <p className="lg-subtitle">{t.t('address.locationHelp')}</p>
        <LinkButton href="/account/addresses" variant="secondary">
          {t.t('address.addNew')}
        </LinkButton>
      </Card>

      {/*
       * Setup, first. A person arriving at their account with things left to do should see what
       * they are before anything else — and see, in the same glance, that none of it is blocking.
       */}
      <Card>
        <h2 className="lg-title">{t.t('onboarding.title')}</h2>
        <p className="lg-subtitle">{t.t('onboarding.subtitle')}</p>
        <LinkButton href="/onboarding" variant="secondary">
          {t.t('onboarding.open')}
        </LinkButton>
      </Card>

      {/*
       * The agricultural identity card, because the AGRI-ID is what a person is most likely to
       * have come here to read out to somebody.
       */}
      <Card>
        <h2 className="lg-title">{t.t('agri.title')}</h2>
        <p className="lg-subtitle">{t.t('agri.subtitle')}</p>
        <LinkButton href="/agri-profile" variant="secondary">
          {t.t('agri.open')}
        </LinkButton>
      </Card>

      {/*
       * Verification is offered to everybody, not only to roles that require it. A consumer who
       * wants a verified badge should not have to discover that the page exists.
       */}
      <Card>
        <h2 className="lg-title">{t.t('kyc.title')}</h2>
        <p className="lg-subtitle">{t.t('kyc.subtitle')}</p>
        <LinkButton href="/account/verification" variant="secondary">
          {t.t('kyc.open')}
        </LinkButton>
      </Card>

      <Card>
        <h2 className="lg-title">{t.t('consent.title')}</h2>
        <p className="lg-subtitle">{t.t('consent.subtitle')}</p>
        <LinkButton href="/account/privacy" variant="secondary">
          {t.t('consent.optionalTitle')}
        </LinkButton>
      </Card>

      <Card>
        <h2 className="lg-title">{t.t('account.rolesTitle')}</h2>
        <p className="lg-subtitle">{t.t('account.rolesSubtitle')}</p>

        {held.length === 0 ? (
          <p className="lg-subtitle">{t.t('account.rolesNone')}</p>
        ) : (
          <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {held.map((assignment) => (
              <li key={assignment.role}>
                <strong>
                  {isRole(assignment.role)
                    ? roleLabel(assignment.role, locale).name
                    : assignment.role}
                </strong>
                <span className="lg-subtitle">
                  {' · '}
                  {assignment.selfSelected
                    ? t.t('account.roleSelfSelected')
                    : t.t('account.roleGranted')}
                  {' · '}
                  {t.formatDate(assignment.grantedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* The reviewer queue, shown only to somebody who may actually work it. */}
      {(await authorize('kyc:review')).ok ? (
        <Card>
          <h2 className="lg-title">{t.t('kyc.queueTitle')}</h2>
          <LinkButton href="/admin/kyc" variant="secondary">
            {t.t('kyc.queueTitle')}
          </LinkButton>
        </Card>
      ) : null}

      {mayAdminister.ok ? (
        <Card>
          <h2 className="lg-title">{t.t('account.manageTitle')}</h2>
          <p className="lg-subtitle">{t.t('account.manageSubtitle')}</p>
          <RoleAdmin
            roles={(await deps.accounts.listRoleDefinitions()).map((definition) => ({
              value: definition.role,
              label: locale === 'bn' ? definition.nameBn : definition.nameEn,
            }))}
            labels={{
              user: t.t('account.manageUserLabel'),
              role: t.t('account.manageRoleLabel'),
              reason: t.t('account.manageReasonLabel'),
              assign: t.t('account.manageAssign'),
              remove: t.t('account.manageRemove'),
              loading: t.t('common.loading'),
              roleAdded: t.t('account.roleAdded'),
              roleAlreadyHeld: t.t('account.roleAlreadyHeld'),
              roleRemoved: t.t('account.roleRemoved'),
              roleNotHeld: t.t('account.roleNotHeld'),
              errorReasonRequired: t.t('errors.reasonRequired'),
              errorCannotRemoveOwn: t.t('errors.cannotRemoveOwnRole'),
              errorNotAllowed: t.t('errors.notAllowed'),
              errorUnexpected: t.t('errors.unexpected'),
            }}
          />
        </Card>
      ) : null}
    </div>
  )
}
