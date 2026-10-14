import { redirect } from 'next/navigation'
import { getMyConsents } from '@langgol/application'
import { prisma } from '@langgol/db'
import { createTranslator } from '@langgol/i18n'
import { diagnosisRepository } from '@langgol/infrastructure'
import { isErr } from '@langgol/shared'
import { Card, LinkButton } from '@langgol/ui/components'
import { advisoryProvider, consentDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'
import { produceMark } from '@/lib/produce'
import { AssistantForm } from './form'

/**
 * The crop assistant: a photograph and a question in, an answer with its confidence out.
 *
 * The gates come first and each says plainly why it stopped — signed in, a farmer (the policy
 * gives `advisory:use` to FARMER), a provider configured, AI consent given — so a farmer is never
 * left at a form that will refuse them. The use case checks all of it again on submit; this page
 * only saves them the walk.
 *
 * In demo mode (ADVISORY_PROVIDER=demo) every answer is scripted, and the page says so above the
 * form, so nobody mistakes it for a diagnosis.
 */
export default async function AssistantPage() {
  const session = await getSession()
  if (session === null) redirect('/auth')

  const locale = await getLocale()
  const t = createTranslator(locale)
  const say = (bn: string, en: string) => (locale === 'bn' ? bn : en)
  const provider = advisoryProvider()

  const header = (
    <header className="lg-dash__head">
      <div>
        <h1 className="lg-dash__title">
          {say('ফসলের সহকারী', 'Crop assistant')}{' '}
          {provider === 'demo' ? <span className="lg-chip">{say('ডেমো', 'Demo')}</span> : null}
        </h1>
        <p className="lg-dash__lede">
          {say(
            'আক্রান্ত গাছের ছবি তুলুন, কী দেখছেন লিখুন। সম্ভাব্য কারণ আর প্রথম করণীয় জানুন।',
            'Photograph the affected plant and say what you see. Get the likely cause and first steps.',
          )}
        </p>
      </div>
    </header>
  )

  const stop = (title: string, body: string, href?: string, cta?: string) => (
    <div className="lg-dash">
      {header}
      <Card>
        <h2 className="lg-title">{title}</h2>
        <p className="lg-subtitle">{body}</p>
        {href !== undefined && cta !== undefined ? (
          <LinkButton href={href}>{cta}</LinkButton>
        ) : null}
      </Card>
    </div>
  )

  if (!session.roles.includes('FARMER')) {
    return stop(
      say('এই সহকারী কৃষকদের জন্য', 'The assistant is for farmers'),
      say(
        'ফসলের রোগ নির্ণয়ের এই সুবিধা কৃষক অ্যাকাউন্টে পাওয়া যায়।',
        'Crop diagnosis is available on farmer accounts.',
      ),
    )
  }

  if (provider === 'none') {
    return stop(
      say('সহকারী এখনও চালু হয়নি', 'The assistant is not connected yet'),
      say(
        'এখনও কোনো উত্তরদাতা সংযুক্ত নেই। শিগগিরই আসছে।',
        'No answering service is connected yet. It is coming soon.',
      ),
    )
  }

  // AI consent: given, and to the current version of the text.
  const consents = await getMyConsents(await currentActor(), locale, await consentDeps())
  const ai = isErr(consents)
    ? undefined
    : consents.value.consents.find((consent) => consent.type === 'AI_DATA_PROCESSING')
  if (ai === undefined || !ai.granted || ai.stale) {
    return stop(
      say('আগে আপনার অনুমতি দরকার', 'Your permission first'),
      say(
        'সহকারী আপনার ছবি একটি এআই সেবায় পাঠায় উত্তর তৈরির জন্য। ছবি সংরক্ষণ করা হয় না। অনুমতি দিতে বা পরে তুলে নিতে গোপনীয়তা পাতায় যান।',
        'The assistant sends your photo to an AI service to work out an answer. The photo is not kept. Give or withdraw permission on the privacy page.',
      ),
      '/account/privacy',
      say('অনুমতি দিন', 'Give permission'),
    )
  }

  const [products, history] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: { slug: true, nameEn: true, nameBn: true },
      orderBy: { nameEn: 'asc' },
    }),
    diagnosisRepository.listForUser(session.userId, 5),
  ])

  const formatWhen = (date: Date) =>
    new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)

  return (
    <div className="lg-dash">
      {header}

      {provider === 'demo' ? (
        <p className="lg-hint">
          {say(
            'ডেমো: উত্তরগুলো আগে থেকে লেখা নমুনা, আপনার ছবি দেখে তৈরি নয়। আসল সিদ্ধান্তের আগে কৃষি অফিসারের পরামর্শ নিন।',
            'Demo: the answers are pre-written samples, not worked out from your photo. Ask an agriculture officer before acting on them.',
          )}
        </p>
      ) : null}

      <div className="lg-dash__grid">
        <Card>
          <AssistantForm
            crops={products.map((product) => ({
              value: product.nameEn,
              label: `${produceMark(product.slug)} ${locale === 'bn' ? product.nameBn : product.nameEn}`,
            }))}
            labels={{
              photo: say('গাছের ছবি', 'Photo of the plant'),
              photoHint: say(
                'দিনের আলোয়, আক্রান্ত পাতার কাছ থেকে। সর্বোচ্চ ৪ MB।',
                'In daylight, close to an affected leaf. Up to 4 MB.',
              ),
              crop: say('ফসল', 'Crop'),
              anyCrop: say('বলতে চাই না', 'Not sure / other'),
              question: say('কী দেখছেন?', 'What do you see?'),
              questionHint: say(
                'যেমন: পাতা হলুদ হয়ে যাচ্ছে, বাদামি দাগ, পোকা, গাছ নেতিয়ে পড়ছে।',
                'For example: leaves turning yellow, brown spots, insects, plants wilting.',
              ),
              submit: say('উত্তর নিন', 'Get an answer'),
              loading: t.t('common.loading'),
              answerTitle: say('সম্ভাব্য কারণ ও করণীয়', 'Likely cause and what to do'),
              confidence: say('নিশ্চয়তা', 'Confidence'),
              confidenceLevels: {
                LOW: say('কম', 'Low'),
                MEDIUM: say('মাঝারি', 'Medium'),
                HIGH: say('বেশি', 'High'),
              },
              unusable: say(
                'ছবিটি পরিষ্কার নয়। দিনের আলোয় আরও কাছ থেকে আবার তুলুন।',
                'The photo is not clear enough. Take another, closer, in daylight.',
              ),
              errors: {
                photo: say('একটি ছবি যোগ করুন।', 'Add a photo.'),
                photoTooLarge: say('ছবিটি ৪ MB-এর বেশি।', 'That photo is over 4 MB.'),
                photoType: say('JPG, PNG বা WebP ছবি দিন।', 'Use a JPG, PNG or WebP photo.'),
                consent: say(
                  'এআই ব্যবহারের অনুমতি দরকার।',
                  'Permission to use AI is needed first.',
                ),
                limit: say(
                  'আজকের সীমা শেষ। কাল আবার চেষ্টা করুন।',
                  'Today’s limit is reached. Try again tomorrow.',
                ),
                unavailable: say(
                  'সহকারী এখন উত্তর দিতে পারছে না। একটু পরে চেষ্টা করুন।',
                  'The assistant cannot answer right now. Try again shortly.',
                ),
                unexpected: t.t('errors.unexpected'),
              },
            }}
          />
        </Card>

        <Card>
          <h2 className="lg-chart-card__title">{say('আগের প্রশ্ন', 'Your recent questions')}</h2>
          {history.length === 0 ? (
            <p className="lg-subtitle">{say('এখনও কোনো প্রশ্ন নেই।', 'Nothing asked yet.')}</p>
          ) : (
            <ul className="lg-rows">
              {history.map((item) => (
                <li key={item.id}>
                  <div className="lg-rows__main">
                    <span className="lg-rows__title">{item.answer.split('\n')[0]}</span>
                    <span className="lg-rows__meta">
                      {formatWhen(item.createdAt)} ·{' '}
                      {item.provider === 'demo' ? say('ডেমো উত্তর', 'demo answer') : item.provider}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
