import { redirect } from 'next/navigation'
import { myAgriProfile } from '@langgol/application'
import { isActor } from '@langgol/domain/policy'
import { roleLabel, isRole } from '@langgol/domain/identity'
import { createTranslator, type MessageKey } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import { agriProfileDeps } from '@/lib/deps'
import { getLocale } from '@/lib/locale'
import { currentActor } from '@/lib/guard'

/**
 * The agricultural identity card.
 *
 * A farmer has to be able to SEE their AGRI-ID for it to be worth anything — it is the number
 * they read out at a cooperative office or write on a delivery note. So this page exists beside
 * the endpoint, and shows exactly what the endpoint returns.
 *
 * Everything rendered here came through the same use case as the JSON, which means it came through
 * the disclosure tripwire. There is no separate assembly for the screen, deliberately: two paths
 * to the same card is two chances for one of them to show something the other would refuse.
 */

export default async function AgriProfilePage() {
  const actor = await currentActor()
  if (!isActor(actor)) redirect('/auth')

  const result = await myAgriProfile(actor, await agriProfileDeps())
  if (isErr(result)) redirect('/account')

  const profile = result.value
  const locale = await getLocale()
  const t = createTranslator(locale)

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('agri.title')}</h1>
        <p className="lg-subtitle">{t.t('agri.subtitle')}</p>

        {/*
         * The identifier itself, given room. This is the one thing on the page somebody has come
         * to read, and it will be copied by hand off a phone screen.
         */}
        <p className="lg-hint">{t.t('agri.idLabel')}</p>
        <p className="lg-title" style={{ letterSpacing: '0.08em', wordBreak: 'break-all' }}>
          {profile.agriId}
        </p>
        <p className="lg-hint">{t.t('agri.idHint')}</p>

        <p className="lg-subtitle">{profile.displayName}</p>
        <p className="lg-hint">
          {t.t('agri.memberSince', { date: t.formatDate(profile.memberSince) })}
        </p>
      </Card>

      {profile.completion === null ? null : (
        <Card>
          <h2 className="lg-title">{t.t('agri.completionTitle')}</h2>
          <p className="lg-subtitle">
            {t.t('agri.completionValue', { percent: profile.completion.percent })}
          </p>
          {profile.completion.missing.length === 0 ? null : (
            <>
              <p className="lg-hint">{t.t('agri.missingTitle')}</p>
              <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {profile.completion.missing.map((section) => (
                  <li key={section} className="lg-hint">
                    {t.t(
                      `agri.section${section.charAt(0).toUpperCase()}${section.slice(1)}` as MessageKey,
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      <Card>
        <h2 className="lg-title">{t.t('agri.rolesTitle')}</h2>
        {profile.roles.length === 0 ? (
          <p className="lg-hint">{t.t('agri.nothingYet')}</p>
        ) : (
          <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {profile.roles.map((entry) => (
              <li key={entry.role}>
                <strong>
                  {isRole(entry.role) ? roleLabel(entry.role, locale).name : entry.role}
                </strong>
                <span className="lg-subtitle">
                  {' · '}
                  {entry.verified ? t.t('agri.verified') : t.t('agri.notYet')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="lg-title">{t.t('agri.verificationTitle')}</h2>
        <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {profile.verifications.map((entry) => (
            <li key={entry.type}>
              <strong>{t.t(`kyc.type${entry.type}` as MessageKey)}</strong>
              <span className="lg-subtitle">
                {' · '}
                {t.t(
                  `kyc.status${entry.status
                    .split('_')
                    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
                    .join('')}` as MessageKey,
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {profile.location === null ? null : (
        <Card>
          <h2 className="lg-title">{t.t('agri.locationTitle')}</h2>
          <p className="lg-subtitle">
            {[profile.location.district, profile.location.division].filter(Boolean).join(', ')}
          </p>
        </Card>
      )}

      {profile.farm === null ? null : (
        <Card>
          <h2 className="lg-title">{t.t('agri.farmTitle')}</h2>
          <p className="lg-subtitle">
            {t.t('agri.farmCount', { count: profile.farm.farmCount })}
            {' · '}
            {t.t('agri.plotCount', { count: profile.farm.plotCount })}
          </p>
          {/* A band, never an area. Land is wealth, and a precise holding beside a name invites trouble. */}
          {profile.farm.landBand === null ? null : (
            <p className="lg-hint">{t.t(`agri.band${profile.farm.landBand}` as MessageKey)}</p>
          )}
          {profile.farm.experienceYears === null ? null : (
            <p className="lg-hint">
              {t.t('agri.experience', { years: profile.farm.experienceYears })}
            </p>
          )}
          {profile.farm.irrigationAvailable === true ? (
            <p className="lg-hint">{t.t('agri.irrigated')}</p>
          ) : null}
        </Card>
      )}

      {profile.production === null ? null : (
        <Card>
          <h2 className="lg-title">{t.t('agri.productionTitle')}</h2>
          <p className="lg-subtitle">{profile.production.crops.join(', ')}</p>
          <p className="lg-hint">
            {t.t('agri.seasons', { count: profile.production.seasonsRecorded })}
          </p>
        </Card>
      )}

      {profile.business === null ? null : (
        <Card>
          <h2 className="lg-title">{t.t('agri.businessTitle')}</h2>
          <p className="lg-subtitle">{profile.business.businessName}</p>
          <p className="lg-hint">
            {profile.business.verified ? t.t('agri.verified') : t.t('agri.notYet')}
            {profile.business.serviceAreaCount === 0
              ? ''
              : ` · ${t.t('agri.serviceAreas', { count: profile.business.serviceAreaCount })}`}
          </p>
        </Card>
      )}

      <Card>
        {/* Said plainly. Somebody being asked to share an identifier deserves to know its limits. */}
        <p className="lg-hint">{t.t('agri.privacyNote')}</p>
      </Card>

      <LinkButton href="/account" variant="ghost">
        {t.t('common.back')}
      </LinkButton>
    </div>
  )
}
