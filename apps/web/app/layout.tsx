import './globals.css'
import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { DevelopmentBanner, LanguageSwitcher, SkipLink } from '@langgol/ui/components'
import { createTranslator } from '@langgol/i18n'
import { getLocale } from '@/lib/locale'
import { isDevelopmentAuth } from '@/lib/deps'

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
  const t = createTranslator(locale)
  const path = (await headers()).get('x-pathname') ?? '/'

  // Browse and order screens need a grid; auth and form screens need a reading measure. The
  // shell picks the width rather than each page fighting the container.
  const isWide = path.startsWith('/market') || path.startsWith('/orders')

  return (
    /*
     * The dark surface is the default. Langgol is used outdoors and after dark, and the
     * buyer screens are dense with figures — a near-black ground lets the money carry the
     * emphasis. `data-theme` is explicit so a future preference toggle wins over the OS
     * setting in both directions; the stylesheet honours `prefers-color-scheme` when no
     * explicit choice is present.
     */
    <html lang={locale} data-theme="dark">
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
        <div className="lg-page">
          <header className="lg-header">
            <a className="lg-brand" href="/">
              {t.t('common.appName')}
            </a>
            <LanguageSwitcher
              currentLocale={locale}
              otherLabel={t.t('common.switchToEnglish')}
              action="/api/locale"
              returnTo={path}
            />
          </header>
          <main className={isWide ? 'lg-main lg-main--wide' : 'lg-main'} id="main">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
