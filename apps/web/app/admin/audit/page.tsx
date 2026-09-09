import { listAuditLog } from '@langgol/application'
import { createTranslator } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import { adminDeps } from '@/lib/deps'
import { getLocale } from '@/lib/locale'
import { requirePermission } from '@/lib/guard'
import { one, pageCount, pageHref, readPaging, type Query } from '../paging'

/**
 * The audit log.
 *
 * ## Its own permission, held by fewer people than you might expect
 *
 * The log records who looked at whose account, so unrestricted access to it is itself a way of
 * watching colleagues. `AUDIT_VIEW` is separate from every other permission for that reason, and
 * is not implied by being able to do the things the log records.
 *
 * ## What a page of it carries
 *
 * Who, what, which record, when, and the reason the operator typed. Not the `before` and `after`
 * payloads, which can hold whatever a past write put there and are exactly the shape of thing that
 * should not be rendered by default. An investigation that needs them is a deliberate query, not a
 * page of a list.
 *
 * Reading this page is not itself audited — see the note in the use case about why a log that
 * records reads of itself grows without bound.
 *
 * Refs: docs/07_SECURITY.md §5, §11
 */
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Query> }) {
  const actor = await requirePermission('admin:audit-read')

  const query = await searchParams
  const { limit, offset, page } = readPaging(query)
  const t = createTranslator(await getLocale())

  const result = await listAuditLog(
    actor,
    {
      action: one(query, 'action'),
      entityType: one(query, 'entityType'),
      entityId: one(query, 'entityId'),
      actorUserId: one(query, 'actorUserId'),
      limit,
      offset,
    },
    await adminDeps(),
  )

  if (isErr(result)) {
    return (
      <Card>
        <h1 className="lg-title">{t.t('admin.auditTitle')}</h1>
        <p className="lg-subtitle">{t.t('errors.notAllowed')}</p>
      </Card>
    )
  }

  const { items, total } = result.value
  const pages = pageCount(total, limit)

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('admin.auditTitle')}</h1>

        {/* A GET form: a filtered view is a URL somebody can bookmark and share with a colleague. */}
        <form method="get" className="lg-stack-tight">
          <label htmlFor="action">{t.t('admin.actionFilter')}</label>
          <input
            id="action"
            name="action"
            className="lg-input"
            defaultValue={one(query, 'action') ?? ''}
          />

          <label htmlFor="entityType">{t.t('admin.entityTypeFilter')}</label>
          <input
            id="entityType"
            name="entityType"
            className="lg-input"
            defaultValue={one(query, 'entityType') ?? ''}
          />

          <label htmlFor="entityId">{t.t('admin.entityIdFilter')}</label>
          <input
            id="entityId"
            name="entityId"
            className="lg-input"
            defaultValue={one(query, 'entityId') ?? ''}
          />

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
        <Card>
          <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((entry) => (
              <li key={entry.id} className="lg-stack-tight">
                <strong>{entry.action}</strong>
                <span className="lg-subtitle">
                  {' · '}
                  {entry.entityType}
                  {' · '}
                  {t.formatDate(entry.createdAt)}
                </span>
                {entry.reason === null ? null : <p className="lg-hint">{entry.reason}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="lg-row">
          {page > 1 ? (
            <LinkButton href={pageHref('/admin/audit', query, page - 1)} variant="ghost">
              {t.t('admin.previous')}
            </LinkButton>
          ) : null}
          {page < pages ? (
            <LinkButton href={pageHref('/admin/audit', query, page + 1)} variant="ghost">
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
