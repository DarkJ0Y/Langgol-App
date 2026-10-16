import './globals.css'
import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { Hind_Siliguri, Inter } from 'next/font/google'
import {
  DevelopmentBanner,
  LanguageSwitcher,
  SkipLink,
  ThemeSwitcher,
} from '@langgol/ui/components'
import { createTranslator } from '@langgol/i18n'
import { getLocale } from '@/lib/locale'
import { isDevelopmentAuth } from '@/lib/deps'
import { getSession } from '@/lib/session'
import { getTheme } from '@/lib/theme'

/*
 * The two faces, downloaded at build time and served from our own origin.
 *
 * `next/font` is not a convenience here. The Content-Security-Policy in middleware.ts sets
 * `font-src 'self'`, so a stylesheet link to Google Fonts is blocked with no error and no visible
 * text — self-hosting is the only way these load at all. It also removes the third-party request
 * on the critical path, which matters more on a 2G connection than it does on a laptop.
 *
 * `display: 'swap'` so text is readable in a fallback face while the real one arrives, rather
 * than the page showing nothing for the first second. On a slow connection the alternative is a
 * farmer looking at a blank screen.
 */
/*
 * Inter: a neutral grotesk built for interfaces. Numbers sit evenly in tables and prices, and it
 * reads as a tool rather than a poster — the register Langgol wants for money and produce.
 * Loaded as a variable font, so every weight below is one file.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--lg-font-latin',
  display: 'swap',
})

/*
 * Bengali only. Inter has no Bengali glyphs, so the browser falls through to this face for
 * exactly those codepoints and for nothing else — the split is per glyph, not per element, and
 * needs no `:lang()` rule. Hind Siliguri stops at 700; there is no 800 to ask for.
 */
const hindSiliguri = Hind_Siliguri({
  subsets: ['bengali'],
  weight: ['400', '500', '600', '700'],
  variable: '--lg-font-bangla',
  display: 'swap',
})

export const metadata = {
  title: 'Langgol',
  description: 'Digital operating system for the agricultural ecosystem of Bangladesh',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom is never disabled. Pinch-zoom is how a farmer with tired eyes reads a price.
  maximumScale: 5,
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  const theme = await getTheme()
  const t = createTranslator(locale)
  const path = (await headers()).get('x-pathname') ?? '/'

  /*
   * The marketing homepage brings its own navigation, its own width and its own visual register,
   * so the product shell steps out of its way entirely. Every other route keeps the header and
   * the reading measure — this is one exception, not a second layout system.
   */
  /*
   * A guest who chose "Continue as guest" on the landing page needs the way back to signing in
   * on every screen, not only on the one that refuses them. Without a session cookie this costs
   * nothing: getSession returns before touching the database.
   */
  const session = await getSession()
  const isGuest = session === null

  // Only a visitor gets the marketing page at "/". A signed-in person gets their feature hub
  // there, inside the ordinary shell with its header and reading width.
  const isLanding = path === '/' && isGuest

  // Browse and order screens need a grid, and so does the signed-in home's feature hub; auth and
  // form screens need a reading measure. The shell picks the width rather than each page fighting
  // the container.
  const isWide =
    path.startsWith('/market') ||
    path.startsWith('/orders') ||
    path === '/' ||
    // The dashboards: stat tiles and charts need the width a reading column would deny them.
    path === '/farmer' ||
    path === '/assistant' ||
    path === '/nearby' ||
    path.startsWith('/admin')

  // Sign-in keeps its narrow column on purpose: one decision at a time. Every other page —
  // account, profile, farms, verification — gets a page-width container.
  const isAuth = path.startsWith('/auth')

  return (
    /*
     * Dark is the default; bright is the visitor's choice, from the switch in the header and
     * remembered in a cookie (lib/theme.ts). `data-theme` is always explicit, so the choice wins
     * over the OS setting in both directions.
     */
    <html lang={locale} data-theme={theme} className={`${inter.variable} ${hindSiliguri.variable}`}>
      {/*
       * `suppressHydrationWarning` covers ONE thing: browser extensions that write attributes
       * onto <body> before React hydrates. Grammarly is the usual culprit — it adds
       * `data-gr-ext-installed` and `data-new-gr-c-s-check-loaded` — and password managers and
       * dark-mode extensions do the same. The server cannot know about them, so every affected
       * developer sees a hydration warning about markup the app never produced.
       *
       * Deliberately narrow: React applies this to this element's own attributes only, one level
       * deep. A genuine hydration mismatch anywhere inside still reports normally, so this hides
       * the extension noise without hiding our own bugs.
       */}
      <body suppressHydrationWarning>
        <SkipLink label={locale === 'bn' ? 'মূল অংশে যান' : 'Skip to content'} />
        {isDevelopmentAuth() ? (
          <DevelopmentBanner
            message={
              locale === 'bn'
                ? 'ডেভেলপমেন্ট মোড — এটি আসল অ্যাকাউন্ট নয়'
                : 'DEVELOPMENT MODE — this is not a real account'
            }
          />
        ) : null}
        <div className={isLanding ? 'lg-page lg-page--bleed' : 'lg-page'}>
          {isLanding ? null : (
            <header className="lg-header">
              <a className="lg-brand" href="/">
                {/* The wordmark is part of the image, so its alt text is the link's name. */}
                <img
                  className="lg-logo"
                  src="/logo.png"
                  alt={t.t('common.appName')}
                  width={1200}
                  height={561}
                />
              </a>
              {/*
                The places this person can go, by role. Each page re-checks access on its own;
                this list only decides what is worth offering. The current section is marked.
              */}
              <nav className="lg-header-links" aria-label={t.t('home.menu')}>
                {[
                  { href: '/market', label: t.t('home.navMarket'), show: true },
                  {
                    href: '/nearby',
                    label: locale === 'bn' ? 'কাছের খামার' : 'Near me',
                    show: true,
                  },
                  {
                    href: '/orders',
                    label: locale === 'bn' ? 'আমার অর্ডার' : 'My orders',
                    show: session !== null,
                  },
                  {
                    href: '/farmer',
                    label: locale === 'bn' ? 'আমার খামার' : 'My farm',
                    show: session?.roles.includes('FARMER') === true,
                  },
                  {
                    href: '/assistant',
                    label: locale === 'bn' ? 'সহকারী' : 'Assistant',
                    show: session?.roles.includes('FARMER') === true,
                  },
                  {
                    href: '/admin',
                    label: locale === 'bn' ? 'প্রশাসন' : 'Admin',
                    show: session?.roles.includes('ADMIN') === true,
                  },
                ]
                  .filter((link) => link.show)
                  .map((link) => (
                    <a
                      key={link.href}
                      className="lg-header-link"
                      href={link.href}
                      aria-current={path.startsWith(link.href) ? 'page' : undefined}
                    >
                      {link.label}
                    </a>
                  ))}
              </nav>
              <div className="lg-header-nav">
                <LanguageSwitcher
                  currentLocale={locale}
                  otherLabel={t.t('common.switchToEnglish')}
                  action="/api/locale"
                  returnTo={path}
                />
                <ThemeSwitcher
                  currentTheme={theme}
                  label={t.t(theme === 'dark' ? 'common.themeToLight' : 'common.themeToDark')}
                  action="/api/theme"
                  returnTo={path}
                />
                {isGuest && !path.startsWith('/auth') ? (
                  <a className="lg-header-signin" href="/auth">
                    {t.t('home.signIn')}
                  </a>
                ) : null}
              </div>
            </header>
          )}
          <main
            className={
              isLanding
                ? 'lg-main lg-main--bleed'
                : isWide
                  ? 'lg-main lg-main--wide'
                  : isAuth
                    ? 'lg-main'
                    : 'lg-main lg-main--page'
            }
            id="main"
          >
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
