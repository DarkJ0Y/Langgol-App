import { searchUsers } from '@langgol/application'
import { ROLES } from '@langgol/domain/identity'
import { ONBOARDING_STATES } from '@langgol/domain/onboarding'
import { createTranslator } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import { adminDeps } from '@/lib/deps'
import { getLocale } from '@/lib/locale'
import { requirePermission } from '@/lib/guard'
import { one, pageCount, pageHref, readPaging, type Query } from '../paging'

/**
 * User search.
 *
 * ## What a list shows, and what it does not
 *
 * A name, a masked phone, a status and the roles. No email, no date of birth, no address and
 * nothing from an identity document. Support work sometimes needs those; a list of fifty people
 * never does, and putting fifty phone numbers on a screen to answer "which of these is Rahim" is a
 * disclosure fifty times over.
 *
 * ## Searching by phone without listing phones
 *
 * The search box matches a full number exactly, so an operator holding a number from a support
 * call can find the account. It does not match a partial one, because that would let somebody walk
 * the number space by prefix — a different capability from looking one up.
 *
 * Refs: docs/07_SECURITY.md §4, §7, §11
 */

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Query> }) {
  // Server-side, on every render. The link on the dashboard is a courtesy; this is the control.
  const actor = await requirePermission('admin:user-read')

  const query = await searchParams
  const { limit, offset, page } = readPaging(query)
  const t = createTranslator(await getLocale())

  const filter = {
    search: one(query, 'search'),
    role: one(query, 'role'),
    status: one(query, 'status'),
    onboardingStatus: one(query, 'onboarding'),
    limit,
    offset,
  }

  const result = await searchUsers(actor, filter, await adminDeps())
  if (isErr(result)) {
    return (
      <Card>
        <h1 className="lg-title">{t.t('admin.usersTitle')}</h1>
        <p className="lg-subtitle">{t.t('errors.notAllowed')}</p>
      </Card>
    )
  }

  const { items, total } = result.value
  const pages = pageCount(total, limit)

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('admin.usersTitle')}</h1>

        {/*
         * A GET form, so a filtered view is a URL an operator can bookmark, share with a colleague
         * and reload. No client JavaScript, and the browser's own back button works.
         */}
        <form method="get" className="lg-stack-tight">
          <label htmlFor="search">{t.t('admin.searchLabel')}</label>
          <input
            id="search"
            name="search"
            className="lg-input"
            defaultValue={filter.search ?? ''}
            placeholder={t.t('admin.searchHint')}
          />

          <label htmlFor="role">{t.t('admin.roleFilter')}</label>
          <select id="role" name="role" className="lg-input" defaultValue={filter.role ?? ''}>
            <option value="">{t.t('admin.anyRole')}</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>

          <label htmlFor="status">{t.t('admin.statusFilter')}</label>
          <select id="status" name="status" className="lg-input" defaultValue={filter.status ?? ''}>
            <option value="">{t.t('admin.anyStatus')}</option>
            {['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>

          <label htmlFor="onboarding">{t.t('admin.onboardingFilter')}</label>
          <select
            id="onboarding"
            name="onboarding"
            className="lg-input"
            defaultValue={filter.onboardingStatus ?? ''}
          >
            <option value="">{t.t('admin.anyOnboarding')}</option>
            {ONBOARDING_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>

          <button type="submit" className="lg-button">
            {t.t('admin.applyFilters')}
          </button>
        </form>

        <p className="lg-hint">{t.t('admin.resultCount', { total, page, pages })}</p>
      </Card>

      {items.length === 0 ? (
        <Card>
          <p className="lg-subtitle">{t.t('admin.noResults')}</p>
        </Card>
      ) : (
        items.map((user) => (
          <Card key={user.userId}>
            <h2 className="lg-title">{user.fullName}</h2>
            <p className="lg-subtitle">
              {/* Masked in the repository. There is no unmasked form for this page to render. */}
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
            <LinkButton href={`/admin/users/${user.userId}`} variant="secondary">
              {t.t('admin.open')}
            </LinkButton>
          </Card>
        ))
      )}

      <Card>
        <div className="lg-row">
          {page > 1 ? (
            <LinkButton href={pageHref('/admin/users', query, page - 1)} variant="ghost">
              {t.t('admin.previous')}
            </LinkButton>
          ) : null}
          {page < pages ? (
            <LinkButton href={pageHref('/admin/users', query, page + 1)} variant="ghost">
              {t.t('admin.next')}
            </LinkButton>
          ) : null}
        </div>
      </Card>

      <LinkButton href="/admin" variant="ghost">
        {t.t('common.back')}
      </LinkButton>
    </div>
  )
}
