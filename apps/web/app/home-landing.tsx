import * as Money from '@langgol/domain/money'
import type { Translator } from '@langgol/i18n'
import { ColumnChart, LanguageSwitcher, ThemeSwitcher } from '@langgol/ui/components'
import type { LandingData } from '@/lib/landing'
import { produceMark } from '@/lib/produce'

/**
 * The Langgol landing page.
 *
 * Built the way the strongest product sites are built, not the way agricultural sites usually
 * are: the hero IS the product (say what you need, see prices — one action), the interface
 * recedes into black and white, and one green carries every action. Real numbers from the
 * database instead of marketing claims; real product pieces as evidence instead of decoration;
 * no 3D, and motion only where it explains something.
 *
 * Section order: navigation · hero with the price check · live numbers · what you can do · how
 * it works · for farmers · for buyers · our principles · closing call · footer.
 *
 * Everything works without JavaScript. The hero form is a plain GET to the market.
 */

/** Where "Log in" goes. `/auth` picks the screen for the server's AUTH_MODE. */
const SIGN_IN_HREF = '/auth'

/** A guest starts at the market: public, and the part of Langgol worth seeing without an account. */
const GUEST_HREF = '/market'

type Locale = 'bn' | 'en'

/* ------------------------------------------------------------------ icons */

/** Simple 24px line icons. Decorative: every one sits beside a text label that says the same. */
function Icon({ name }: { name: 'basket' | 'sprout' | 'truck' | 'store' | 'check' | 'shield' }) {
  const paths: Record<typeof name, string> = {
    basket: 'M3 9h18l-2 10H5L3 9Zm4 0 3-5m7 5-3-5M9 13v3m6-3v3',
    sprout: 'M12 21v-9m0 0C12 8 9 5 4 5c0 5 3 7 8 7Zm0 0c0-3 2-6 7-6 0 4-3 6-7 6Z',
    truck: 'M3 6h11v9H3V6Zm11 3h4l3 3v3h-7m-9 0a2 2 0 1 0 4 0m7 0a2 2 0 1 0 4 0',
    store: 'M4 10v10h16V10M3 10l2-6h14l2 6H3Zm6 10v-5h6v5',
    check: 'M5 12l4 4 10-10',
    shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4',
  }
  return (
    <svg
      className="lp-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={paths[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* ------------------------------------------------------------ the example quote */

/**
 * An example delivered-price breakdown — the product's central idea, shown rather than claimed.
 * Labelled as an example on the card itself. Exact money throughout (poisha, summed by the money
 * module), so the example adds up to the paisa like a real quote does.
 */
function ExampleQuote({ t, say }: { t: Translator; say: (bn: string, en: string) => string }) {
  const produce = Money.fromPoisha(42000n) // 10 kg at ৳42.00
  const delivery = Money.fromPoisha(6000n)
  const handling = Money.fromPoisha(1000n)
  const service = Money.fromPoisha(1200n)
  const total = Money.sum([produce, delivery, handling, service])
  const lines: [string, string][] = [
    [say('টমেটো · ১০ কেজি × ৳৪২', 'Tomatoes · 10 kg × ৳42'), t.formatMoney(produce)],
    [say('ঘরে পৌঁছে দেওয়া', 'Delivery to your door'), t.formatMoney(delivery)],
    [say('প্যাকিং', 'Handling'), t.formatMoney(handling)],
    [say('সেবা মূল্য', 'Service'), t.formatMoney(service)],
  ]

  return (
    <aside className="lp-quote" aria-label={say('উদাহরণ: দামের হিসাব', 'Example price breakdown')}>
      <div className="lp-quote__head">
        <span className="lp-quote__mark" aria-hidden="true">
          🍅
        </span>
        <div>
          <p className="lp-quote__title">
            {say('আপনার দরজায় পৌঁছানো দাম', 'Your delivered price')}
          </p>
          <p className="lp-quote__meta">
            {say('শিরিন সবজি বাগান · রংপুর', 'Shirin Sobji Bagan · Rangpur')}
          </p>
        </div>
        <span className="lp-quote__tag">{say('উদাহরণ', 'Example')}</span>
      </div>

      <dl className="lp-quote__lines">
        {lines.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="lp-quote__total">
        <span>{say('মোট', 'Total')}</span>
        <strong>{t.formatMoney(total)}</strong>
      </div>
      <p className="lp-quote__note">
        <Icon name="check" />
        {say(
          'কোনো লুকানো খরচ নেই। কৃষক পান তাঁর দাম, পুরোটা।',
          'No hidden charges. The farmer gets their price, in full.',
        )}
      </p>
    </aside>
  )
}

/* ------------------------------------------------------------------- the page */

export function HomeLanding({
  t,
  locale,
  theme,
  data,
}: {
  t: Translator
  locale: Locale
  theme: 'dark' | 'light'
  data: LandingData
}) {
  const say = (bn: string, en: string) => (locale === 'bn' ? bn : en)
  const n = (value: number) => t.digits(value.toLocaleString('en-IN'))

  const nav = [
    { href: GUEST_HREF, label: say('বাজার', 'Market') },
    { href: '/nearby', label: say('কাছের খামার', 'Near me') },
    { href: '#farmers', label: say('কৃষকদের জন্য', 'For farmers') },
    { href: '#buyers', label: say('ক্রেতাদের জন্য', 'For buyers') },
    { href: '#how', label: say('কীভাবে কাজ করে', 'How it works') },
  ]

  const tiles = [
    {
      icon: 'basket' as const,
      title: say('তাজা ফসল কিনুন', 'Buy fresh produce'),
      body: say(
        'কৃষকের কাছ থেকে সরাসরি, ঠিকানায় পৌঁছে দেওয়ার দাম আগেই জেনে।',
        'Straight from the farmer, with the delivered price known before you order.',
      ),
      cta: say('বাজার দেখুন', 'Browse the market'),
      href: GUEST_HREF,
    },
    {
      icon: 'sprout' as const,
      title: say('ফসল বিক্রি করুন', 'Sell your harvest'),
      body: say(
        'নিজের দাম নিজে ঠিক করুন। আয়, খরচ আর ফসলের হিসাব এক জায়গায়।',
        'Set your own price. Income, costs and harvests in one place.',
      ),
      cta: say('কৃষক হিসেবে যোগ দিন', 'Join as a farmer'),
      href: '/auth/register',
    },
    {
      icon: 'store' as const,
      title: say('দোকান ও পাইকারি', 'Shops and wholesale'),
      body: say(
        'বড় পরিমাণে নিয়মিত কিনুন, যাচাই করা খামার থেকে।',
        'Buy in volume, regularly, from verified farms.',
      ),
      cta: say('ব্যবসা হিসেবে যোগ দিন', 'Join as a business'),
      href: '/auth/register',
    },
    {
      icon: 'truck' as const,
      title: say('পৌঁছে দেওয়া', 'Deliver with Langgol'),
      body: say(
        'খামার থেকে বাজারে ফসল পৌঁছে দিয়ে আয় করুন।',
        'Earn by moving produce from farm to market.',
      ),
      cta: say('পরিবহনকারী হিসেবে যোগ দিন', 'Join as a transporter'),
      href: '/auth/register',
    },
  ]

  const steps = [
    {
      title: say('যা দরকার বেছে নিন', 'Choose what you need'),
      body: say(
        'ফসল আর পরিমাণ বাছুন। প্রতিটি তালিকায় খামার আর জেলার নাম থাকে।',
        'Pick the crop and quantity. Every listing names its farm and district.',
      ),
    },
    {
      title: say('আসল দাম দেখুন', 'See the real price'),
      body: say(
        'অর্ডারের আগেই আপনার ঠিকানায় পৌঁছানোর পুরো দাম, প্রতিটি অংশ আলাদা করে।',
        'The full price to your door before you order, every part itemised.',
      ),
    },
    {
      title: say('কৃষক প্যাক করেন', 'The farmer packs it'),
      body: say(
        'অর্ডার নিশ্চিত হলে কৃষক ফসল তোলেন আর প্রস্তুত করেন।',
        'Once confirmed, the farmer harvests and prepares your order.',
      ),
    },
    {
      title: say('পৌঁছায়, কৃষক টাকা পান', 'Delivered, farmer paid'),
      body: say(
        'ঘরে পৌঁছে দেওয়া হয়। কৃষক পান তাঁর দামের পুরোটা।',
        'It arrives at your door. The farmer is paid their full price.',
      ),
    },
  ]

  const principles = [
    {
      icon: 'check' as const,
      title: say('লুকানো খরচ নেই', 'No hidden charges'),
      body: say(
        'যা দেখবেন তা-ই দেবেন। পরিবহন, প্যাকিং আর সেবা মূল্য আলাদা করে লেখা।',
        'What you see is what you pay. Delivery, handling and service each shown.',
      ),
    },
    {
      icon: 'sprout' as const,
      title: say('কৃষকের ন্যায্য দাম', 'Fair to farmers'),
      body: say(
        'দাম ঠিক করেন কৃষক। লাঙ্গল কত রাখে, তা কৃষক নিজে দেখতে পান।',
        'Farmers set their price, and see exactly what Langgol keeps.',
      ),
    },
    {
      icon: 'shield' as const,
      title: say('যাচাই করা খামার', 'Verified farms'),
      body: say(
        'কৃষক, জমি আর ব্যবসা যাচাই করা হয়, প্রমাণ সহ।',
        'Farmers, land and businesses are verified, with evidence.',
      ),
    },
    {
      icon: 'store' as const,
      title: say('বাংলা প্রথমে', 'Bangla first'),
      body: say(
        'পুরো প্ল্যাটফর্ম বাংলায়, সাধারণ ফোনে, ধীর ইন্টারনেটেও।',
        'The whole platform in Bangla, on ordinary phones and slow connections.',
      ),
    },
  ]

  return (
    <div className="lp" lang={locale}>
      {/* ------------------------------------------------------------- navigation */}
      <header className="lp-nav">
        <div className="lp-wrap lp-nav__inner">
          <a className="lp-logo" href="/">
            <span className="lp-logo__mark" aria-hidden="true" />
            {t.t('common.appName')}
          </a>

          <nav aria-label={t.t('home.menu')} className="lp-nav__links">
            {nav.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="lp-nav__actions">
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
            <a className="lp-link lp-nav__login" href={SIGN_IN_HREF}>
              {t.t('home.signIn')}
            </a>
            <a className="lp-btn lp-btn--primary lp-btn--sm" href="/auth/register">
              {say('শুরু করুন', 'Sign up')}
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* ------------------------------------------------------------------ hero */}
        <section className="lp-hero">
          <div className="lp-wrap lp-hero__grid">
            <div className="lp-hero__copy">
              <h1 className="lp-h1">
                {say('খামার থেকে সরাসরি, ন্যায্য দামে', 'Straight from the farm, priced fairly')}
              </h1>
              <p className="lp-lede">
                {say(
                  'বাংলাদেশের কৃষকের কাছ থেকে তাজা ফসল কিনুন। অর্ডারের আগেই জানুন আপনার দরজায় পৌঁছানোর পুরো দাম।',
                  'Buy fresh produce from Bangladesh’s farmers. Know the full price to your door before you order.',
                )}
              </p>

              {/* The product, in the hero: say what you need, see prices. A plain GET form. */}
              <form className="lp-search" action="/market" method="get">
                <label className="lp-field">
                  <span className="lp-field__label">{say('কী লাগবে', 'What do you need?')}</span>
                  <select name="crop" defaultValue="">
                    <option value="">{say('সব ফসল', 'Any crop')}</option>
                    {data.crops.map((crop) => (
                      <option key={crop.slug} value={crop.slug}>
                        {produceMark(crop.slug)} {locale === 'bn' ? crop.nameBn : crop.nameEn}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lp-field">
                  <span className="lp-field__label">
                    {say('কোন জেলা থেকে', 'From which district?')}
                  </span>
                  <select name="district" defaultValue="">
                    <option value="">{say('যেকোনো জেলা', 'Any district')}</option>
                    {data.districts.map((district) => (
                      <option key={district.id} value={district.id}>
                        {locale === 'bn' ? district.nameBn : district.nameEn}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="lp-btn lp-btn--primary lp-btn--block">
                  {say('দাম দেখুন', 'See prices')}
                </button>
                <a className="lp-btn lp-btn--secondary lp-btn--block" href={SIGN_IN_HREF}>
                  {say('প্রবেশ করে আপনার অর্ডার দেখুন', 'Log in to see your orders')}
                </a>
              </form>
              <p className="lp-small">{t.t('home.guestHint')}</p>
            </div>

            <ExampleQuote t={t} say={say} />
          </div>
        </section>

        {/* ------------------------------------------------------------- live numbers */}
        <section className="lp-numbers" aria-label={say('আজকের লাঙ্গল', 'Langgol today')}>
          <div className="lp-wrap lp-numbers__grid">
            {[
              [n(data.counts.farmers), say('যাচাই করা কৃষক', 'Verified farmers')],
              [n(data.counts.listings), say('চালু তালিকা', 'Live listings')],
              [n(data.counts.crops), say('ফসলের ধরন', 'Crops on sale')],
              [n(data.counts.districts), say('জেলা', 'Districts')],
              [n(data.counts.delivered), say('পৌঁছে দেওয়া অর্ডার', 'Orders delivered')],
            ].map(([value, label]) => (
              <div key={label} className="lp-number">
                <span className="lp-number__value">{value}</span>
                <span className="lp-number__label">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------- what you can do */}
        <section className="lp-section">
          <div className="lp-wrap">
            <h2 className="lp-h2">{say('লাঙ্গলে যা করতে পারেন', 'What you can do on Langgol')}</h2>
            <div className="lp-tiles">
              {tiles.map((tile) => (
                <a key={tile.title} className="lp-tile" href={tile.href}>
                  <span className="lp-tile__icon">
                    <Icon name={tile.icon} />
                  </span>
                  <span className="lp-tile__title">{tile.title}</span>
                  <span className="lp-tile__body">{tile.body}</span>
                  <span className="lp-tile__cta">{tile.cta} →</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- how it works */}
        <section className="lp-section lp-section--alt" id="how">
          <div className="lp-wrap lp-split">
            <div>
              <p className="lp-eyebrow">{say('কীভাবে কাজ করে', 'How it works')}</p>
              <h2 className="lp-h2">
                {say('অর্ডার থেকে দরজা পর্যন্ত, চার ধাপে', 'From order to door, in four steps')}
              </h2>
              <p className="lp-lede">
                {say(
                  'প্রতিটি ধাপে আপনি জানেন কী হচ্ছে আর কত খরচ হচ্ছে।',
                  'At every step you know what is happening and what it costs.',
                )}
              </p>
            </div>
            <ol className="lp-steps">
              {steps.map((step, index) => (
                <li key={step.title} className="lp-step">
                  <span className="lp-step__num">{t.digits(String(index + 1))}</span>
                  <div>
                    <h3 className="lp-h3">{step.title}</h3>
                    <p className="lp-body">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------------ for farmers */}
        <section className="lp-section" id="farmers">
          <div className="lp-wrap lp-split">
            <div>
              <p className="lp-eyebrow">{say('কৃষকদের জন্য', 'For farmers')}</p>
              <h2 className="lp-h2">{say('আপনার খামার, এক নজরে', 'Your farm, at a glance')}</h2>
              <p className="lp-lede">
                {say(
                  'প্রতি মৌসুমের আয় আর খরচ, কোন ফসল কত হলো, বিক্রির জন্য কতটা বাকি — সব ছবিতে।',
                  'Income and cost for every season, what each crop yielded, what is left to sell — all drawn for you.',
                )}
              </p>
              <ul className="lp-checks">
                <li>
                  <Icon name="check" />
                  {say('নিজের দাম নিজে ঠিক করুন', 'Set your own price')}
                </li>
                <li>
                  <Icon name="check" />
                  {say('কমিশন কত, আগেই দেখুন', 'See the commission before you sell')}
                </li>
                <li>
                  <Icon name="check" />
                  {say('বাংলায়, সাধারণ ফোনে', 'In Bangla, on an ordinary phone')}
                </li>
              </ul>
              <a className="lp-btn lp-btn--primary" href="/auth/register">
                {say('কৃষক হিসেবে যোগ দিন', 'Join as a farmer')}
              </a>
            </div>

            <figure className="lp-panel">
              <figcaption className="lp-panel__head">
                <span>{say('মৌসুম অনুযায়ী আয় ও খরচ', 'Income and cost by season')}</span>
                <span className="lp-quote__tag">{say('উদাহরণ', 'Example')}</span>
              </figcaption>
              <ColumnChart
                series={[
                  { label: say('আয়', 'Income'), slot: 'a' },
                  { label: say('খরচ', 'Cost'), slot: 'b' },
                ]}
                data={[
                  [say('বোরো', 'Boro'), 142, 78],
                  [say('আউশ', 'Aus'), 96, 61],
                  [say('আমন', 'Aman'), 168, 82],
                  [say('রবি', 'Rabi'), 131, 70],
                  [say('খরিফ', 'Kharif'), 185, 88],
                ].map(([label, income, cost]) => ({
                  label: String(label),
                  values: [Number(income), Number(cost)],
                }))}
                format={(value) => `৳${t.digits(String(value))}K`}
                formatTick={(value) => `৳${t.digits(String(Math.round(value)))}K`}
              />
            </figure>
          </div>
        </section>

        {/* ------------------------------------------------------------- for buyers */}
        <section className="lp-section lp-section--alt" id="buyers">
          <div className="lp-wrap lp-split lp-split--reverse">
            <div>
              <p className="lp-eyebrow">{say('ক্রেতাদের জন্য', 'For buyers')}</p>
              <h2 className="lp-h2">{say('দাম তুলনা করুন, তারপর কিনুন', 'Compare, then buy')}</h2>
              <p className="lp-lede">
                {say(
                  'একই ফসল কোন কৃষক কত দামে বেচছেন, পাশাপাশি দেখুন। ঘরে পৌঁছানোর দাম অর্ডারের আগেই।',
                  'See what each farmer charges for the same crop, side by side — and the delivered price before you order.',
                )}
              </p>
              <div className="lp-actions">
                <a className="lp-btn lp-btn--primary" href={GUEST_HREF}>
                  {say('বাজার দেখুন', 'Browse the market')}
                </a>
                <a className="lp-btn lp-btn--secondary" href="/auth/register">
                  {say('অ্যাকাউন্ট খুলুন', 'Create an account')}
                </a>
              </div>
            </div>

            <figure className="lp-panel">
              <figcaption className="lp-panel__head">
                <span>
                  {say('টমেটো · প্রতি কেজি, খামারের দাম', 'Tomatoes · per kg at the farm gate')}
                </span>
                <span className="lp-quote__tag">{say('উদাহরণ', 'Example')}</span>
              </figcaption>
              <ul className="lp-compare">
                {[
                  [say('রহিমের খামার', 'Rahim’s Farm'), 38, false],
                  [say('শিরিন সবজি বাগান', 'Shirin Sobji Bagan'), 42, true],
                  [say('রিনা পারিবারিক খামার', 'Rina Family Farm'), 45, false],
                  [say('করিম অ্যাগ্রো', 'Karim Agro Farm'), 49, false],
                ].map(([farm, price, chosen]) => (
                  <li key={String(farm)} className={chosen === true ? 'is-chosen' : undefined}>
                    <span className="lp-compare__farm">{farm}</span>
                    <span className="lp-compare__bar">
                      <i style={{ width: `${String((Number(price) / 50) * 100)}%` }} />
                    </span>
                    <span className="lp-compare__price">৳{t.digits(String(price))}</span>
                  </li>
                ))}
              </ul>
            </figure>
          </div>
        </section>

        {/* ------------------------------------------------------------- principles */}
        <section className="lp-section">
          <div className="lp-wrap">
            <h2 className="lp-h2">{say('যেভাবে আমরা কাজ করি', 'How we work')}</h2>
            <div className="lp-principles">
              {principles.map((item) => (
                <div key={item.title} className="lp-principle">
                  <span className="lp-tile__icon">
                    <Icon name={item.icon} />
                  </span>
                  <h3 className="lp-h3">{item.title}</h3>
                  <p className="lp-body">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ closing call */}
        <section className="lp-cta">
          <div className="lp-wrap lp-cta__inner">
            <div>
              <h2 className="lp-h2">{say('আজই শুরু করুন', 'Start today')}</h2>
              <p className="lp-lede">{t.t('home.guestHint')}</p>
            </div>
            <div className="lp-actions">
              <a className="lp-btn lp-btn--primary" href={SIGN_IN_HREF}>
                {t.t('home.signIn')}
              </a>
              <a className="lp-btn lp-btn--secondary" href={GUEST_HREF}>
                {t.t('home.guest')}
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------------ footer */}
      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer__grid">
            <div>
              <a className="lp-logo" href="/">
                <span className="lp-logo__mark" aria-hidden="true" />
                {t.t('common.appName')}
              </a>
              <p className="lp-small">
                {say(
                  'বাংলাদেশের কৃষি ব্যবস্থার জন্য একটি ডিজিটাল প্ল্যাটফর্ম।',
                  'A digital platform for the agricultural ecosystem of Bangladesh.',
                )}
              </p>
            </div>
            {[
              {
                title: say('কিনুন', 'Buy'),
                links: [
                  [say('বাজার', 'Market'), GUEST_HREF],
                  [say('আমার অর্ডার', 'My orders'), '/orders'],
                ],
              },
              {
                title: say('বিক্রি করুন', 'Sell'),
                links: [
                  [say('কৃষক হিসেবে যোগ দিন', 'Join as a farmer'), '/auth/register'],
                  [say('আমার খামার', 'My farm'), '/farmer'],
                ],
              },
              {
                title: say('লাঙ্গল', 'Langgol'),
                links: [
                  [say('কীভাবে কাজ করে', 'How it works'), '#how'],
                  [say('গোপনীয়তা', 'Privacy'), '/account/privacy'],
                ],
              },
            ].map((column) => (
              <div key={column.title}>
                <h3 className="lp-footer__title">{column.title}</h3>
                <ul className="lp-footer__links">
                  {column.links.map(([label, href]) => (
                    <li key={label}>
                      <a href={href}>{label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="lp-footer__bottom">
            <span>
              © {t.digits(String(new Date().getUTCFullYear()))} {t.t('common.appName')} ·{' '}
              {t.t('home.footerRights')}
            </span>
            <span>
              {say(
                'উদাহরণ লেখা কার্ডগুলো নমুনা; সংখ্যার সারি আসল।',
                'Cards marked “Example” are samples; the numbers strip is live.',
              )}
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}
