import { notFound } from 'next/navigation'
import { Card } from '@langgol/ui/components'
import { createTranslator } from '@langgol/i18n'
import { getLocale } from '@/lib/locale'
import { authMode } from '@/lib/deps'
import { REGISTERABLE_ROLES } from '@/lib/otp-handoff-policy'
import { FirebasePhoneForm } from './form'

/**
 * Firebase phone sign-in.
 *
 * The page is a server component and holds no secret. What it passes to the browser is the public
 * Firebase client configuration — an API key that is an identifier rather than a credential, and
 * which Google's own documentation says is safe to ship. Nothing here decides anything: the token
 * the browser obtains is verified server-side, against this project, before it means a thing.
 *
 * 404s outside Firebase mode, so the route does not exist as a target under OTP or development.
 * That is presentation; the real refusal is in the server action and the use case.
 */
export default async function FirebaseAuthPage() {
  if (authMode() !== 'firebase') notFound()

  const locale = await getLocale()
  const t = createTranslator(locale)

  /*
   * Read here rather than in the client component, which cannot see server environment variables.
   * `parseEnv` has already refused to boot without these, so they are present.
   */
  const apiKey = process.env['FIREBASE_API_KEY'] ?? ''
  const authDomain = process.env['FIREBASE_AUTH_DOMAIN'] ?? ''
  const projectId = process.env['FIREBASE_PROJECT_ID'] ?? ''

  // Labelled the same way the register screen does it, from the same three keys, so the two
  // screens cannot describe the same role differently.
  const roleLabels: Record<string, string> = {
    FARMER: t.t('auth.roleFarmer'),
    CONSUMER: t.t('auth.roleConsumer'),
    RETAILER: t.t('auth.roleRetailer'),
  }

  const roles = REGISTERABLE_ROLES.map((role) => ({
    value: role,
    label: roleLabels[role] ?? role,
  }))

  return (
    <Card>
      <h1 className="lg-title">
        {locale === 'bn' ? 'মোবাইল নম্বর দিয়ে প্রবেশ' : 'Sign in with your mobile number'}
      </h1>
      <p className="lg-subtitle">{t.t('auth.signInSubtitle')}</p>

      <FirebasePhoneForm
        config={{ apiKey, authDomain, projectId }}
        locale={locale}
        roles={roles}
        labels={{
          phone: t.t('auth.phoneLabel'),
          phoneHelp: t.t('auth.phoneHelp'),
          phonePlaceholder: t.t('auth.phonePlaceholder'),
          code: t.t('auth.codeLabel'),
          fullName: t.t('auth.nameLabel'),
          role: t.t('auth.registerRoleLabel'),
          sendCode: t.t('auth.sendCode'),
          verify: t.t('auth.verify'),
          loading: t.t('common.loading'),
        }}
      />
    </Card>
  )
}
