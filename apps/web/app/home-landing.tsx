import { LanguageSwitcher, ThemeSwitcher } from '@langgol/ui/components'
import type { Translator } from '@langgol/i18n'
import { DEMO_ECOSYSTEM, DEMO_METRICS, DEMO_PLOTS, DEMO_PRODUCTS } from './home-demo'

/**
 * Where "Log in" goes. `/auth` picks the screen for the server's AUTH_MODE — the demo identities,
 * Firebase or OTP — so the landing page never has to know which one is active.
 */
const SIGN_IN_HREF = '/auth'

/** A guest starts at the market: public, and the part of Langgol worth seeing without an account. */
const GUEST_HREF = '/market'

/**
 * The landing page's one decision: sign in, or look around first.
 *
 * Shown in the hero and again at the foot of the page. The hint says what a guest can and cannot
 * do, so choosing "guest" is not a surprise later — a quote or an order asks for sign-in at that
 * point (app/market/actions.ts), and nothing before it does.
 */
function EntryChoice({ t, centred = false }: { t: Translator; centred?: boolean }) {
  return (
    <div className={centred ? 'lgh__entry lgh__entry--centred' : 'lgh__entry'}>
      <div className="lgh__cta-row">
        <a className="lgh__btn lgh__btn--primary lgh__btn--lg" href={SIGN_IN_HREF}>
          {t.t('home.signIn')}
        </a>
        <a className="lgh__btn lgh__btn--ghost lgh__btn--lg" href={GUEST_HREF}>
          {t.t('home.guest')}
        </a>
      </div>
      <p className="lgh__entry-hint">{t.t('home.guestHint')}</p>
      <p className="lgh__entry-hint">
        {t.t('home.newHere')} <a href="/auth/register">{t.t('home.createAccount')}</a>
      </p>
    </div>
  )
}

/**
 * The Langgol marketing homepage.
 *
 * A server component with no client JavaScript at all. Every effect — the reveal, the filling
 * bar, the pulsing indicator, the sparklines — is CSS in `home.css`. That is not a limitation
 * worked around: the product screens ship almost no client JS because a farmer on 2G cannot
 * afford it, and pulling an animation library in for the marketing page would put that bundle in
 * the same application.
 *
 * The numbers are illustrative and the page says so, in both languages, right under the hero.
 * See `home-demo.ts` for why they live apart from everything else.
 */
/**
 * The farmland under the hero: plots of crop, drawn as coloured rectangles on a 3D plane that
 * drifts toward the viewer. Positions are percentages of one tile; the tile is drawn twice, one
 * above the other, so the drift loops without a seam (home.css, `lgh-drift`). `glow` marks a plot
 * carrying a sensor node.
 */
const TERRAIN_PLOTS = [
  { x: 6, y: 4, w: 18, h: 9, tone: 'lime' },
  { x: 30, y: 2, w: 14, h: 13, tone: 'green', glow: true },
  { x: 52, y: 6, w: 22, h: 8, tone: 'sun' },
  { x: 80, y: 3, w: 12, h: 12, tone: 'sky' },
  { x: 10, y: 22, w: 13, h: 14, tone: 'green' },
  { x: 28, y: 24, w: 24, h: 9, tone: 'sky', glow: true },
  { x: 60, y: 20, w: 15, h: 15, tone: 'lime' },
  { x: 82, y: 23, w: 12, h: 9, tone: 'green' },
  { x: 4, y: 41, w: 20, h: 7, tone: 'sun', glow: true },
  { x: 34, y: 38, w: 12, h: 10, tone: 'lime' },
  { x: 54, y: 40, w: 20, h: 8, tone: 'green' },
  { x: 79, y: 37, w: 15, h: 11, tone: 'sun' },
] as const

/** A six-faced CSS cube. Purely decorative; the faces are empty and styled in home.css. */
function Cube({ className }: { className: string }) {
  return (
    <span className={`lgh__cube ${className}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

export function HomeLanding({
  t,
  locale,
  theme,
}: {
  t: Translator
  locale: 'bn' | 'en'
  theme: 'dark' | 'light'
}) {
  const bn = locale === 'bn'
  const nav = [
    { href: '#platform', label: t.t('home.navPlatform') },
    { href: '#assistant', label: t.t('home.navAssistant') },
    { href: '#farmers', label: t.t('home.navFarmers') },
    { href: '#market', label: t.t('home.navMarket') },
    { href: '#ecosystem', label: t.t('home.navEcosystem') },
  ]

  return (
    <div className="lgh" lang={locale}>
      {/* ------------------------------------------------------------ nav */}
      <nav className="lgh__nav" aria-label={t.t('home.menu')}>
        <div className="lgh__inner lgh__nav-inner">
          <a className="lgh__logo" href="/">
            <span className="lgh__mark" aria-hidden="true" />
            {t.t('common.appName')}
          </a>

          <ul className="lgh__nav-links">
            {nav.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>

          <div className="lgh__nav-actions">
            {/* The product shell's header is hidden here, so the switcher travels with the nav. */}
            <LanguageSwitcher
              currentLocale={locale}
              otherLabel={t.t('common.switchToEnglish')}
              action="/api/locale"
              returnTo="/"
            />
            <ThemeSwitcher
              currentTheme={theme}
              label={t.t(theme === 'dark' ? 'common.themeToLight' : 'common.themeToDark')}
              action="/api/theme"
              returnTo="/"
            />
            <a className="lgh__btn lgh__btn--ghost lgh__nav-guest" href={GUEST_HREF}>
              {t.t('home.guest')}
            </a>
            <a className="lgh__btn lgh__btn--primary" href={SIGN_IN_HREF}>
              {t.t('home.signIn')}
            </a>
          </div>
        </div>
      </nav>

      {/* ----------------------------------------------------------- hero */}
      <header className="lgh__hero">
        {/*
          The 3D field. A perspective plane of crop plots drifting toward the viewer, with a scan
          line sweeping it — farmland seen by an instrument. CSS only; still under reduced motion.
        */}
        <div className="lgh__scene" aria-hidden="true">
          <div className="lgh__terrain">
            <div className="lgh__terrain-track">
              {[0, 50].map((offset) =>
                TERRAIN_PLOTS.map((plot, index) => (
                  <span
                    key={`${String(offset)}-${String(index)}`}
                    className={`lgh__plot lgh__plot--${plot.tone}${'glow' in plot ? ' lgh__plot--node' : ''}`}
                    style={
                      {
                        left: `${String(plot.x)}%`,
                        top: `${String(plot.y + offset)}%`,
                        width: `${String(plot.w)}%`,
                        height: `${String(plot.h)}%`,
                      } as never
                    }
                  />
                )),
              )}
            </div>
            <div className="lgh__scan" />
          </div>
        </div>

        <div className="lgh__inner lgh__hero-grid">
          <div className="lgh__hero-copy lgh__reveal">
            <p className="lgh__eyebrow">{t.t('home.heroEyebrow')}</p>
            <h1 className="lgh__display">{t.t('home.heroTitle')}</h1>
            <p className="lgh__lede">{t.t('home.heroBody')}</p>

            <EntryChoice t={t} />

            {/* The page states plainly that the panel beside it is an example. */}
            <p className="lgh__note">{t.t('home.heroNote')}</p>
          </div>

          {/* The instrument panel, floating in 3D. Static markup; every motion is CSS. */}
          <div className="lgh__stage">
            <Cube className="lgh__cube--a" />
            <Cube className="lgh__cube--b" />
            <Cube className="lgh__cube--c" />
            <div
              className="lgh__panel lgh__panel--3d lgh__reveal"
              style={{ '--delay': '120ms' } as never}
            >
              <div className="lgh__panel-head">
                <span className="lgh__dot" aria-hidden="true" />
                <h2 className="lgh__panel-title">{t.t('home.panelTitle')}</h2>
                <span className="lgh__panel-meta">
                  {t.t('home.panelCrop')} · {t.t('home.panelDays')}
                </span>
              </div>

              <div className="lgh__stat">
                <div className="lgh__stat-row">
                  <span className="lgh__stat-label">{t.t('home.panelHealth')}</span>
                  <span className="lgh__stat-value">94%</span>
                </div>
                <div className="lgh__bar" style={{ '--fill': '94%' } as never}>
                  <i />
                </div>
              </div>

              <dl className="lgh__panel-facts">
                <div className="lgh__fact">
                  <dt>{t.t('home.panelMoisture')}</dt>
                  <dd>68%</dd>
                </div>
                <div className="lgh__fact">
                  <dt>{t.t('home.panelRisk')}</dt>
                  <dd>{t.t('home.panelRiskLow')}</dd>
                </div>
                <div className="lgh__fact">
                  <dt>{t.t('home.panelYield')}</dt>
                  <dd>+12%</dd>
                </div>
                <div className="lgh__fact">
                  <dt>{t.t('home.farmArea')}</dt>
                  <dd>{bn ? '২.৫ বিঘা' : '2.5 bigha'}</dd>
                </div>
              </dl>

              <div className="lgh__advice">
                <strong>{t.t('home.panelAdvice')}</strong>
                <p>{t.t('home.panelAdviceText')}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ------------------------------------------- live intelligence */}
      <section className="lgh__section" id="platform">
        <div className="lgh__inner">
          <div className="lgh__head">
            <h2 className="lgh__h2">{t.t('home.liveTitle')}</h2>
            <p className="lgh__lede">{t.t('home.liveBody')}</p>
          </div>

          <div className="lgh__grid lgh__grid--three">
            {DEMO_METRICS.map((metric, index) => (
              <article
                key={metric.key}
                className="lgh__card lgh__reveal"
                style={{ '--delay': `${String(index * 60)}ms` } as never}
              >
                <p className="lgh__card-label">
                  {t.t(`home.${metric.key}` as 'home.metricHealth')}
                </p>
                <p className="lgh__card-value">{metric.value}</p>
                <span className={`lgh__delta lgh__delta--${metric.tone === 'up' ? 'up' : 'warn'}`}>
                  {metric.delta}
                </span>
                <div
                  className="lgh__spark"
                  aria-hidden="true"
                  style={{ '--spark': metric.spark } as never}
                />
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------- farmer intelligence */}
      <section className="lgh__section" id="farmers">
        <div className="lgh__inner lgh__split">
          <div className="lgh__head">
            <h2 className="lgh__h2">{t.t('home.farmTitle')}</h2>
            <p className="lgh__lede">{t.t('home.farmBody')}</p>
            <a className="lgh__btn lgh__btn--ghost" href="/auth/register">
              {t.t('home.getStarted')}
            </a>
          </div>

          <div className="lgh__panel">
            <div className="lgh__panel-head">
              <span className="lgh__dot" aria-hidden="true" />
              <h3 className="lgh__panel-title">{t.t('home.farmPlots')}</h3>
              <span className="lgh__panel-meta">{DEMO_PLOTS.length}</span>
            </div>

            {DEMO_PLOTS.map((plot) => (
              <div key={plot.name} className="lgh__stat">
                <div className="lgh__stat-row">
                  <span className="lgh__stat-label">
                    <strong style={{ color: 'var(--lgh-ink)' }}>{plot.name}</strong> ·{' '}
                    {bn ? plot.cropBn : plot.crop}
                  </span>
                  <span className="lgh__stat-value">{plot.health}%</span>
                </div>
                <div className="lgh__bar" style={{ '--fill': `${String(plot.health)}%` } as never}>
                  <i />
                </div>
                <span className="lgh__stat-label">
                  {t.t('home.farmStage')}: {bn ? plot.stageBn : plot.stage} · {plot.area}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- AI assistant */}
      <section className="lgh__section" id="assistant">
        <div className="lgh__inner lgh__split">
          <div className="lgh__head">
            <h2 className="lgh__h2">{t.t('home.aiTitle')}</h2>
            <p className="lgh__lede">{t.t('home.aiBody')}</p>
          </div>

          <div className="lgh__chat">
            <div className="lgh__bubble lgh__bubble--ask">{t.t('home.aiQuestion')}</div>
            <div className="lgh__bubble lgh__bubble--answer">{t.t('home.aiAnswer')}</div>
            {/*
              The caution is part of the example, not decoration. An assistant that recommends a
              pesticide can cost a farmer their season, and the marketing page should not promise
              a certainty the product deliberately refuses to claim.
            */}
            <p className="lgh__caution">{t.t('home.aiCaution')}</p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ marketplace */}
      <section className="lgh__section" id="market">
        <div className="lgh__inner">
          <div className="lgh__head">
            <h2 className="lgh__h2">{t.t('home.marketTitle')}</h2>
            <p className="lgh__lede">{t.t('home.marketBody')}</p>
          </div>

          <div className="lgh__grid">
            {DEMO_PRODUCTS.map((product) => (
              <article key={product.name} className="lgh__product">
                <div
                  className="lgh__product-art"
                  aria-hidden="true"
                  style={{ '--art-a': product.art[0], '--art-b': product.art[1] } as never}
                />
                <div className="lgh__product-body">
                  <span className="lgh__badge">✓ {t.t('home.marketVerified')}</span>
                  <p className="lgh__product-name">{bn ? product.nameBn : product.name}</p>
                  <p className="lgh__product-meta">
                    {t.t('home.marketFrom', { place: bn ? product.placeBn : product.place })}
                  </p>
                  <p className="lgh__price">{product.price}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- ecosystem */}
      <section className="lgh__section" id="ecosystem">
        <div className="lgh__inner">
          <div className="lgh__head">
            <h2 className="lgh__h2">{t.t('home.ecoTitle')}</h2>
            <p className="lgh__lede">{t.t('home.ecoBody')}</p>
          </div>

          {/*
            A tilted ring spinning in 3D, every role equidistant from Langgol at the centre. Each
            label counter-rotates so it always faces the reader. Narrow screens get the plain grid
            (home.css): seven labels on a phone-sized ring would collide.
          */}
          <div className="lgh__eco">
            <div className="lgh__node lgh__node--core">{t.t('common.appName')}</div>
            <div className="lgh__ring" aria-hidden="true" />
            {DEMO_ECOSYSTEM.map((key, index) => (
              <div
                key={key}
                className="lgh__node lgh__node--orbit"
                style={
                  {
                    '--angle': `${String((360 / DEMO_ECOSYSTEM.length) * index)}deg`,
                  } as never
                }
              >
                <span>{t.t(`home.${key}` as 'home.ecoFarmer')}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ trust */}
      <section className="lgh__section">
        <div className="lgh__inner">
          <div className="lgh__head">
            <h2 className="lgh__h2">{t.t('home.trustTitle')}</h2>
            <p className="lgh__lede">{t.t('home.trustBody')}</p>
          </div>

          <div className="lgh__trust">
            {([1, 2, 3, 4] as const).map((n) => (
              <div key={n}>
                <h3>{t.t(`home.trust${n}` as 'home.trust1')}</h3>
                <p>{t.t(`home.trust${n}Body` as 'home.trust1Body')}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- CTA */}
      <section className="lgh__section">
        <div className="lgh__inner lgh__cta">
          <h2 className="lgh__display">{t.t('home.ctaTitle')}</h2>
          <p className="lgh__lede" style={{ textAlign: 'center' }}>
            {t.t('home.ctaBody')}
          </p>
          <EntryChoice t={t} centred />
        </div>
      </section>

      {/* ----------------------------------------------------------- footer */}
      <footer className="lgh__footer">
        <div className="lgh__inner">
          <div className="lgh__footer-grid">
            <div>
              <h4>{t.t('home.footerPlatform')}</h4>
              <ul>
                <li>
                  <a href="/market">{t.t('home.navMarket')}</a>
                </li>
                <li>
                  <a href="#farmers">{t.t('home.navFarmers')}</a>
                </li>
                <li>
                  <a href="#assistant">{t.t('home.navAssistant')}</a>
                </li>
              </ul>
            </div>

            <div>
              <h4>{t.t('home.footerUsers')}</h4>
              <ul>
                <li>{t.t('home.ecoFarmer')}</li>
                <li>{t.t('home.ecoConsumer')}</li>
                <li>{t.t('home.ecoRetailer')}</li>
                <li>{t.t('home.ecoExpert')}</li>
              </ul>
            </div>

            <div>
              <h4>{t.t('home.footerCompany')}</h4>
              <ul>
                <li>{t.t('home.footerAbout')}</li>
                <li>
                  <a href="/account/privacy">{t.t('home.footerPrivacy')}</a>
                </li>
                <li>{t.t('home.footerTerms')}</li>
              </ul>
            </div>
          </div>

          <div className="lgh__colophon">
            <span>
              © {new Date().getUTCFullYear()} {t.t('common.appName')} · {t.t('home.footerRights')}
            </span>
            {/* Repeated at the bottom so a reader who skipped the hero still meets it. */}
            <span style={{ opacity: 0.8 }}>{t.t('home.demoNotice')}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
