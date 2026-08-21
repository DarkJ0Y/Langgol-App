import { confirmEmail } from '@langgol/application'
import { createTranslator } from '@langgol/i18n'
import { Alert, Card, LinkButton } from '@langgol/ui/components'
import { headers } from 'next/headers'
import { emailVerificationDeps } from '@/lib/deps'
import { getLocale } from '@/lib/locale'

/**
 * Redeem an email verification link.
 *
 * Deliberately OUTSIDE `/account` and deliberately **not** behind a session. The link arrives in
 * an inbox that is very often opened on a different device from the one that is signed in, and
 * demanding a login first would strand most of the people who click it. The token is the
 * credential, which is why it is 256 bits, single-use and short-lived.
 *
 * Redeeming grants nothing else: no session is issued and no privilege is conferred. Someone who
 * intercepts a link can mark an address verified — an address they demonstrably receive mail at,
 * by virtue of having the link — and nothing more.
 *
 * `force-dynamic` because this page has a side effect. A cached render would either replay the
 * redemption or, worse, show one person's outcome to the next visitor.
 */
export const dynamic = 'force-dynamic'

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const t = createTranslator(await getLocale())

  if (token === undefined || token.length === 0) {
    return (
      <Card>
        <h1 className="lg-title">{t.t('verify.emailTitle')}</h1>
        <Alert tone="error">{t.t('verify.emailLinkDead')}</Alert>
        <LinkButton href="/account">{t.t('verify.backToAccount')}</LinkButton>
      </Card>
    )
  }

  const list = await headers()
  const forwarded = list.get('x-forwarded-for')
  const ipAddress = forwarded === null ? null : (forwarded.split(',')[0]?.trim() ?? null)

  const deps = await emailVerificationDeps()
  const result = await confirmEmail({ token, ipAddress }, deps)

  return (
    <Card>
      <h1 className="lg-title">{t.t('verify.emailTitle')}</h1>
      {result.ok ? (
        <Alert tone="success">{t.t('verify.emailConfirmed')}</Alert>
      ) : (
        // One message for expired, already used, unknown and address-changed. Telling them apart
        // would help someone probing links far more than it helps the person holding a dead one.
        <Alert tone="error">{t.t('verify.emailLinkDead')}</Alert>
      )}
      <LinkButton href="/account">{t.t('verify.backToAccount')}</LinkButton>
    </Card>
  )
}
