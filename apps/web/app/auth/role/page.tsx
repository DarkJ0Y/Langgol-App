import { redirect } from 'next/navigation'
import { SELF_SELECTABLE_ROLES } from '@langgol/application'
import { createTranslator } from '@langgol/i18n'
import { Card } from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'
import { RoleForm } from './form'

/**
 * Role selection.
 *
 * Renders ONLY the self-selectable roles, read from the domain constant rather than hard-coded
 * here — so the screen cannot drift from what the server will accept. `ADMIN` and `OPS_AGENT`
 * are controlled roles and never appear.
 *
 * The list being short is a courtesy. The boundary is `selectRole`, which rejects anything
 * outside the allowlist whether the request came from this form or from curl.
 */
export default async function RolePage() {
  const session = await getSession()
  if (session === null) redirect('/auth')

  const locale = await getLocale()
  const t = createTranslator(locale)

  const labels: Record<string, string> = {
    FARMER: t.t('auth.roleFarmer'),
    CONSUMER: t.t('auth.roleConsumer'),
    RETAILER: t.t('auth.roleRetailer'),
  }

  const roles = SELF_SELECTABLE_ROLES.map((role) => ({
    value: role,
    label: labels[role] ?? role,
    selected: session.roles.includes(role),
  }))

  return (
    <Card>
      <h1 className="lg-title">{t.t('auth.chooseRole')}</h1>
      <p className="lg-subtitle">{session.fullName}</p>
      <RoleForm
        roles={roles}
        submitLabel={t.t('common.continue')}
        loadingLabel={t.t('common.loading')}
        errorLabel={t.t('errors.notAllowed')}
      />
    </Card>
  )
}
