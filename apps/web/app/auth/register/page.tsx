import { notFound } from 'next/navigation'
import { SELF_SELECTABLE_ROLES } from '@langgol/application'
import { createTranslator } from '@langgol/i18n'
import { Card } from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'
import { authMode } from '@/lib/deps'
import { RegisterForm } from './form'

/**
 * Create an account.
 *
 * Renders ONLY the self-selectable roles, read from the domain constant rather than listed here,
 * so the screen cannot drift from what the server will accept. `ADMIN` and `OPS_AGENT` are
 * granted, never chosen, and never appear.
 *
 * Like the sign-in screens, this is `notFound()` outside OTP mode: development sign-in
 * authenticates against fixtures, and a registration form that could not create anything would
 * be a dead end dressed up as a feature.
 */
export default async function RegisterPage() {
  if (authMode() !== 'otp') notFound()

  const locale = await getLocale()
  const t = createTranslator(locale)

  const roleLabels: Record<string, string> = {
    FARMER: t.t('auth.roleFarmer'),
    CONSUMER: t.t('auth.roleConsumer'),
    RETAILER: t.t('auth.roleRetailer'),
  }

  return (
    <Card>
      <h1 className="lg-title">{t.t('auth.registerTitle')}</h1>
      <p className="lg-subtitle">{t.t('auth.registerSubtitle')}</p>

      <RegisterForm
        roles={SELF_SELECTABLE_ROLES.map((role) => ({
          value: role,
          label: roleLabels[role] ?? role,
        }))}
        labels={{
          phone: t.t('auth.phoneLabel'),
          phoneHint: t.t('auth.phoneHelp'),
          phonePlaceholder: t.t('auth.phonePlaceholder'),
          name: t.t('auth.nameLabel'),
          nameHint: t.t('auth.registerNameHelp'),
          roleLabel: t.t('auth.registerRoleLabel'),
          submit: t.t('auth.registerSubmit'),
          loading: t.t('common.loading'),
          signIn: t.t('auth.haveAccount'),
          phoneInvalid: t.t('errors.phoneInvalid'),
          phoneEmpty: t.t('errors.phoneEmpty'),
          nameEmpty: t.t('errors.nameEmpty'),
          notAllowed: t.t('errors.notAllowed'),
          rateLimited: t.t('errors.rateLimited', { seconds: 60 }),
          smsUnavailable: t.t('errors.smsUnavailable'),
          unexpected: t.t('errors.unexpected'),
        }}
      />
    </Card>
  )
}
