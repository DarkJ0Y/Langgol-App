'use client'

/**
 * Last-resort boundary: the root layout itself failed, so there is no design system, no
 * translator and no styling to rely on. Bilingual, minimal, and no error detail.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="bn">
      <body style={{ fontFamily: 'sans-serif', padding: '2rem', lineHeight: 1.8 }}>
        <h1>কিছু একটা সমস্যা হয়েছে</h1>
        <p lang="en">Something went wrong.</p>
        <button type="button" onClick={reset} style={{ minHeight: 48, padding: '0 1.5rem' }}>
          আবার চেষ্টা করুন / Try again
        </button>
      </body>
    </html>
  )
}
