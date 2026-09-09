import { viewUser } from '@langgol/application'
import { ADMIN_PERMISSIONS } from '@langgol/domain/admin'
import { createTranslator, type MessageKey } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import { adminDeps } from '@/lib/deps'
import { getLocale } from '@/lib/locale'
import { authorize, requirePermission } from '@/lib/guard'
import { UserActions } from './user-actions'

/**
 * One user, opened by an operator.
 *
 * ## What is shown
 *
 * A masked phone, whether contact details are verified, the roles, and which verifications exist
 * with their statuses. Not the email, not the date of birth, not the address, and nothing from an
 * identity document — not even the masked number, which lives on the KYC screen behind its own
 * permission. Browsing a profile and investigating an identity are different jobs.
 *
 * ## The controls appear only for somebody who may use them
 *
 * And are checked again in the action, and again in the use case. The visibility here is so an
 * operator is not shown a button that will refuse them; it is not what stops them.
 *
 * Refs: docs/07_SECURITY.md §4, §5, §7
 */
export default async function AdminUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const actor = await requirePermission('admin:user-read')
  const { userId } = await params
  const t = createTranslator(await getLocale())

  const result = await viewUser(actor, userId, await adminDeps())
  if (isErr(result)) {
    return (
      <Card>
        <h1 className="lg-title">{t.t('admin.usersTitle')}</h1>
        <p className="lg-subtitle">{t.t('errors.notFound')}</p>
      </Card>
    )
  }

  const user = result.value
  const maySuspend = (await authorize('admin:user-suspend')).ok
  const mayManagePermissions = (await authorize('admin:permission-manage')).ok

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{user.fullName}</h1>
        <p className="lg-subtitle">
          {/* Masked in the repository. This page never holds the real number. */}
          {user.phoneMasked}
          {' · '}
          {user.status}
        </p>
        <p className="lg-hint">
          {user.roles.join(', ')}
          {' · '}
          {user.onboardingStatus}
          {' · '}
          {t.formatDate(user.createdAt)}
        </p>
        <p className="lg-hint">
          {user.phoneVerified ? t.t('admin.phoneVerified') : t.t('admin.phoneUnverified')}
          {' · '}
          {user.emailVerified ? t.t('admin.emailVerified') : t.t('admin.emailUnverified')}
        </p>
        {user.suspendedReason === null ? null : (
          <p className="lg-hint">
            {t.t('admin.suspendedFor')} {user.suspendedReason}
          </p>
        )}
      </Card>

      <Card>
        <h2 className="lg-title">{t.t('admin.verificationsTitle')}</h2>
        {/*
         * Types and statuses. Whether somebody is verified is the useful fact here; the document
         * they used and the number on it are the KYC reviewer's business, behind their own
         * permission, on their own screen.
         */}
        {user.verifications.length === 0 ? (
          <p className="lg-hint">{t.t('admin.noVerifications')}</p>
        ) : (
          <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {user.verifications.map((entry) => (
              <li key={entry.type}>
                {entry.type}
                {' · '}
                {entry.status}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <UserActions
        userId={user.userId}
        suspended={user.status === 'SUSPENDED'}
        maySuspend={maySuspend}
        mayManagePermissions={mayManagePermissions}
        held={user.permissions}
        allPermissions={ADMIN_PERMISSIONS.map((permission) => ({
          value: permission,
          label: t.t(`admin.permission${permission}` as MessageKey),
        }))}
        labels={{
          suspendTitle: t.t('admin.suspendTitle'),
          restoreTitle: t.t('admin.restoreTitle'),
          reasonLabel: t.t('admin.reasonLabel'),
          reasonHint: t.t('admin.reasonHint'),
          suspend: t.t('admin.suspend'),
          restore: t.t('admin.restore'),
          permissionsTitle: t.t('admin.permissionsTitle'),
          permissionsHint: t.t('admin.permissionsHint'),
          grant: t.t('admin.grant'),
          revoke: t.t('admin.revoke'),
          granted: t.t('admin.granted'),
          notGranted: t.t('admin.notGranted'),
          loading: t.t('common.loading'),
          saved: t.t('admin.saved'),
          errorUnexpected: t.t('errors.unexpected'),
          messages: {
            'admin.errorReason': t.t('admin.errorReason'),
            'admin.errorNoChange': t.t('admin.errorNoChange'),
            'errors.notAllowed': t.t('errors.notAllowed'),
            'errors.unexpected': t.t('errors.unexpected'),
          },
        }}
      />

      <LinkButton href="/admin/users" variant="ghost">
        {t.t('common.back')}
      </LinkButton>
    </div>
  )
}
