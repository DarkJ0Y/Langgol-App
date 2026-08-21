import { redirect } from 'next/navigation'
import { getMyConsentHistory, getMyConsents } from '@langgol/application'
import { consentLabel, isConsentType } from '@langgol/domain/consent'
import { createTranslator } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { consentDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import { ConsentForm, type ConsentItem } from './consent-form'

/**
 * Permissions and privacy.
 *
 * Reads through the use case, so the same authorization that guards an action guards this render.
 * `getMyConsents` takes no subject id — the subject is the actor — so there is no argument here
 * that could show somebody else's decisions.
 *
 * The history below is the user's own record of what they agreed to and when. It exists because
 * consent that cannot be reviewed afterwards is a checkbox, not consent; it is also half of what
 * a data-subject request has to return.
 */
export default async function PrivacyPage() {
  const actor = await currentActor()
  const deps = await consentDeps()

  const locale = await getLocale()
  const t = createTranslator(locale)

  const summary = await getMyConsents(actor, locale, deps)
  if (!summary.ok) redirect('/auth')

  const toItem = (view: (typeof summary.value.consents)[number]): ConsentItem => ({
    type: view.type,
    title: view.title,
    purpose: view.purpose,
    granted: view.granted,
    stale: view.stale,
    // Formatted here: the client never receives a raw date to format itself.
    decidedOn:
      view.decidedAt === null
        ? null
        : t.t(view.granted ? 'consent.grantedOn' : 'consent.withdrawnOn', {
            date: t.formatDate(view.decidedAt),
          }),
  })

  const required = summary.value.consents.filter((view) => view.required).map(toItem)
  const optional = summary.value.consents.filter((view) => !view.required).map(toItem)

  const history = await getMyConsentHistory(actor, deps)

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('consent.title')}</h1>
        <p className="lg-subtitle">{t.t('consent.subtitle')}</p>

        <ConsentForm
          required={required}
          optional={optional}
          labels={{
            requiredTitle: t.t('consent.requiredTitle'),
            requiredSubtitle: t.t('consent.requiredSubtitle'),
            optionalTitle: t.t('consent.optionalTitle'),
            optionalSubtitle: t.t('consent.optionalSubtitle'),
            accepted: t.t('consent.accepted'),
            notAccepted: t.t('consent.notAccepted'),
            accept: t.t('consent.accept'),
            updated: t.t('consent.updated'),
            save: t.t('consent.save'),
            saved: t.t('consent.saved'),
            loading: t.t('common.loading'),
            errorInvalid: t.t('errors.consentInvalid'),
            errorNotAllowed: t.t('errors.notAllowed'),
            errorUnexpected: t.t('errors.unexpected'),
          }}
        />
      </Card>

      <Card>
        <h2 className="lg-title">{t.t('consent.historyTitle')}</h2>
        {!history.ok || history.value.length === 0 ? (
          <p className="lg-subtitle">{t.t('consent.historyEmpty')}</p>
        ) : (
          <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {history.value.map((entry, index) => (
              <li key={`${entry.consentType}-${String(index)}`}>
                <strong>
                  {isConsentType(entry.consentType)
                    ? consentLabel(entry.consentType, locale).title
                    : entry.consentType}
                </strong>
                <span className="lg-subtitle">
                  {' · '}
                  {t.t(entry.granted ? 'consent.grantedOn' : 'consent.withdrawnOn', {
                    date: t.formatDate(entry.decidedAt),
                  })}
                  {' · '}
                  {t.t('consent.version', { version: entry.version })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <LinkButton href="/account" variant="ghost">
        {t.t('verify.backToAccount')}
      </LinkButton>
    </div>
  )
}
