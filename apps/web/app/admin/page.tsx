import { createTranslator, type MessageKey } from '@langgol/i18n'
import { ADMIN_PERMISSIONS } from '@langgol/domain/admin'
import { Card, LinkButton } from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'
import { requirePermission } from '@/lib/guard'

/**
 * The back office.
 *
 * ## Why this page renders for an administrator holding nothing
 *
 * `admin:access` is a plain role check, so somebody with the role and an empty permission set gets
 * in and is shown a list of what they cannot do. That is deliberate. The alternative — redirecting
 * them away — produces an operator who has been told they are an administrator, cannot open the
 * admin area, and has no way to find out why.
 *
 * ## The links are a courtesy, not a control
 *
 * A section is hidden when its permission is absent, and every page and every action behind it
 * checks the same permission again server-side. A hidden link is a tidy screen; it is not
 * security, and nothing here is treated as though it were.
 *
 * Refs: docs/07_SECURITY.md §4, §5
 */

interface Section {
  readonly permission: (typeof ADMIN_PERMISSIONS)[number]
  readonly href: string
  readonly titleKey: MessageKey
}

const SECTIONS: readonly Section[] = [
  { permission: 'USER_VIEW', href: '/admin/users', titleKey: 'admin.usersTitle' },
  { permission: 'KYC_VIEW', href: '/admin/kyc', titleKey: 'admin.kycTitle' },
  {
    permission: 'BUSINESS_REVIEW',
    href: '/admin/verification/BUSINESS',
    titleKey: 'admin.businessTitle',
  },
  { permission: 'FARM_REVIEW', href: '/admin/verification/FARM', titleKey: 'admin.farmTitle' },
  {
    permission: 'EXPERT_REVIEW',
    href: '/admin/verification/EXPERT',
    titleKey: 'admin.expertTitle',
  },
  { permission: 'AUDIT_VIEW', href: '/admin/audit', titleKey: 'admin.auditTitle' },
]

export default async function AdminHomePage() {
  // The door. Every section below re-checks its own permission, and so does every page behind it.
  const actor = await requirePermission('admin:access')
  const t = createTranslator(await getLocale())

  const held = actor.permissions ?? []
  const available = SECTIONS.filter((section) => held.includes(section.permission))

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('admin.title')}</h1>
        <p className="lg-subtitle">{t.t('admin.subtitle')}</p>
      </Card>

      {available.length === 0 ? (
        <Card>
          {/*
           * Said plainly rather than shown as an empty page. An operator who has been told they
           * are an administrator and finds nothing here deserves to know that the account is
           * working and the permissions have not been granted yet.
           */}
          <h2 className="lg-title">{t.t('admin.noPermissionsTitle')}</h2>
          <p className="lg-subtitle">{t.t('admin.noPermissionsBody')}</p>
        </Card>
      ) : (
        available.map((section) => (
          <Card key={section.href}>
            <h2 className="lg-title">{t.t(section.titleKey)}</h2>
            <LinkButton href={section.href} variant="secondary">
              {t.t('admin.open')}
            </LinkButton>
          </Card>
        ))
      )}

      <Card>
        <h2 className="lg-title">{t.t('admin.yourPermissionsTitle')}</h2>
        <p className="lg-subtitle">{t.t('admin.yourPermissionsBody')}</p>
        <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {ADMIN_PERMISSIONS.map((permission) => (
            <li key={permission} className={held.includes(permission) ? '' : 'lg-hint'}>
              {t.t(`admin.permission${permission}` as MessageKey)}
              {' · '}
              {held.includes(permission) ? t.t('admin.granted') : t.t('admin.notGranted')}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
