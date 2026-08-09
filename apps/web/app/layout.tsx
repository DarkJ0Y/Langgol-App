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

  return (
    <html lang={locale}>
      <body>
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
          <main className="lg-main" id="main">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
