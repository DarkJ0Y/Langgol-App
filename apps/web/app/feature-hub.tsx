import type { Action, Role } from '@langgol/domain/policy'
import { authorize } from '@/lib/guard'

/**
 * Everything the signed-in person can open, grouped by what it is for.
 *
 * The signed-in home page. A link appears only if its page would let this person in: farmer
 * screens by role, admin screens by the SAME policy action the page itself checks (`authorize`),
 * so the hub can never offer a door that turns out to be locked. With the all-features demo
 * account every section shows, which is the point of that account.
 */

type Text = { readonly bn: string; readonly en: string }

interface HubLink {
  readonly href: string
  readonly title: Text
  readonly body: Text
}

interface HubSection {
  readonly title: Text
  readonly links: readonly HubLink[]
}

const MARKET: HubSection = {
  title: { bn: 'বাজার', en: 'Marketplace' },
  links: [
    {
      href: '/market',
      title: { bn: 'বাজার দেখুন', en: 'Browse the market' },
      body: {
        bn: 'কৃষকের তালিকা, দাম, আর আপনার ঠিকানায় পৌঁছে দেওয়ার দাম। দর নিয়ে অর্ডার দিন।',
        en: 'Farmers’ listings and prices, delivered-price quotes to your address, and checkout.',
      },
    },
    {
      href: '/nearby',
      title: { bn: 'কাছের খামার', en: 'Farms near you' },
      body: {
        bn: 'মানচিত্রে আপনার সবচেয়ে কাছের কৃষক আর তাঁদের আজকের ফসল।',
        en: 'The farmers closest to you on a map, with what they have today.',
      },
    },
    {
      href: '/orders',
      title: { bn: 'আমার অর্ডার', en: 'My orders' },
      body: {
        bn: 'যা কিনেছেন আর যা পথে আছে, মাসের খরচের চার্ট সহ।',
        en: 'What you bought and what is on its way, with spending by month.',
      },
    },
  ],
}

const FARMER: HubSection = {
  title: { bn: 'কৃষক', en: 'Farmer' },
  links: [
    {
      href: '/farmer',
      title: { bn: 'কৃষকের ড্যাশবোর্ড', en: 'Farmer dashboard' },
      body: {
        bn: 'আপনার জমি, ফসল আর যা এখনও বাকি।',
        en: 'Your farm at a glance, and what is still missing.',
      },
    },
    {
      href: '/farmer/farms',
      title: { bn: 'আমার জমি', en: 'My farms' },
      body: {
        bn: 'জমি আর প্লট যোগ করুন, সীমানা আর উৎপাদনের ইতিহাস সহ।',
        en: 'Add farms and plots, with boundaries and production history.',
      },
    },
    {
      href: '/farmer/onboarding',
      title: { bn: 'কৃষকের প্রশ্নপত্র', en: 'Farmer questionnaire' },
      body: {
        bn: 'অভিজ্ঞতা, জমির পরিমাণ, সেচ আর চাষের তথ্য।',
        en: 'Experience, land, irrigation and farming practice.',
      },
    },
    {
      href: '/assistant',
      title: { bn: 'ফসলের সহকারী', en: 'Crop assistant' },
      body: {
        bn: 'আক্রান্ত গাছের ছবি দিন, সম্ভাব্য কারণ আর করণীয় জানুন।',
        en: 'Send a photo of a sick plant; get the likely cause and first steps.',
      },
    },
    {
      href: '/agri-profile',
      title: { bn: 'কৃষি পরিচয় (AGRI-ID)', en: 'Agricultural ID (AGRI-ID)' },
      body: {
        bn: 'আপনার ডিজিটাল কৃষি পরিচয়পত্র।',
        en: 'Your digital agricultural identity card.',
      },
    },
  ],
}

const ACCOUNT: HubSection = {
  title: { bn: 'আমার অ্যাকাউন্ট', en: 'My account' },
  links: [
    {
      href: '/onboarding',
      title: { bn: 'সেটআপের তালিকা', en: 'Setup checklist' },
      body: {
        bn: 'অ্যাকাউন্ট সম্পূর্ণ করতে যা যা বাকি।',
        en: 'Everything left to complete your account.',
      },
    },
    {
      href: '/account',
      title: { bn: 'আপনার তথ্য', en: 'Your details' },
      body: {
        bn: 'নাম, ভাষা, ইমেইল আর ভূমিকার প্রোফাইল।',
        en: 'Name, language, email and role profiles.',
      },
    },
    {
      href: '/account/addresses',
      title: { bn: 'ঠিকানা', en: 'Addresses' },
      body: {
        bn: 'ডেলিভারির ঠিকানা, মানচিত্রের অবস্থান সহ।',
        en: 'Delivery addresses, with map location.',
      },
    },
    {
      href: '/account/verification',
      title: { bn: 'যাচাই ও পরিচয় (KYC)', en: 'Verification and KYC' },
      body: {
        bn: 'ফোন, ইমেইল, জাতীয় পরিচয়পত্র, ব্যবসা, জমি আর বিশেষজ্ঞ যাচাই।',
        en: 'Phone, email, national ID, business, farm and expert verification.',
      },
    },
    {
      href: '/account/privacy',
      title: { bn: 'অনুমতি ও গোপনীয়তা', en: 'Permissions and privacy' },
      body: { bn: 'আপনার তথ্য কে কীভাবে ব্যবহার করবে।', en: 'Consent over how your data is used.' },
    },
  ],
}

/** Admin links, each gated by the policy action its page checks. */
const ADMIN: readonly (HubLink & { readonly action: Action })[] = [
  {
    action: 'admin:access',
    href: '/admin',
    title: { bn: 'প্রশাসন', en: 'Administration' },
    body: { bn: 'সারাংশ আর অপেক্ষমাণ কাজ।', en: 'Overview and pending work.' },
  },
  {
    action: 'admin:user-read',
    href: '/admin/users',
    title: { bn: 'ব্যবহারকারী', en: 'Users' },
    body: {
      bn: 'অ্যাকাউন্ট খোঁজা, ভূমিকা আর অনুমতি, স্থগিত করা।',
      en: 'Find accounts, manage roles and permissions, suspend.',
    },
  },
  {
    action: 'kyc:review',
    href: '/admin/kyc',
    title: { bn: 'KYC কাগজপত্র', en: 'KYC documents' },
    body: { bn: 'জাতীয় পরিচয়পত্রের কাগজ যাচাই।', en: 'Review national ID submissions.' },
  },
  {
    action: 'verification:review-business',
    href: '/admin/verification/BUSINESS',
    title: { bn: 'ব্যবসা যাচাই', en: 'Business verification' },
    body: { bn: 'দোকান, পাইকার আর সরবরাহকারীর কাগজ।', en: 'Retailers, wholesalers and suppliers.' },
  },
  {
    action: 'verification:review-farm',
    href: '/admin/verification/FARM',
    title: { bn: 'জমি যাচাই', en: 'Farm verification' },
    body: { bn: 'কৃষকের জমির প্রমাণ।', en: 'Evidence for farmers’ land.' },
  },
  {
    action: 'verification:review-expert',
    href: '/admin/verification/EXPERT',
    title: { bn: 'বিশেষজ্ঞ যাচাই', en: 'Expert verification' },
    body: { bn: 'কৃষি বিশেষজ্ঞের যোগ্যতা।', en: 'Agricultural experts’ qualifications.' },
  },
  {
    action: 'admin:audit-read',
    href: '/admin/audit',
    title: { bn: 'অডিট লগ', en: 'Audit log' },
    body: { bn: 'কে, কখন, কী করেছে।', en: 'Who did what, and when.' },
  },
]

export async function FeatureHub({
  roles,
  locale,
}: {
  roles: readonly Role[]
  locale: 'bn' | 'en'
}) {
  const say = (text: Text) => text[locale]

  const adminLinks: HubLink[] = []
  for (const link of ADMIN) {
    if ((await authorize(link.action)).ok) adminLinks.push(link)
  }

  const sections: HubSection[] = [
    MARKET,
    ...(roles.includes('FARMER') ? [FARMER] : []),
    ACCOUNT,
    ...(adminLinks.length > 0
      ? [{ title: { bn: 'প্রশাসন', en: 'Administration' }, links: adminLinks }]
      : []),
  ]

  return (
    <div className="lg-stack">
      {sections.map((section) => (
        <section key={section.title.en} className="lg-hub" aria-label={say(section.title)}>
          <h2 className="lg-hub__title">{say(section.title)}</h2>
          <div className="lg-hub__grid">
            {section.links.map((link) => (
              <a key={link.href} className="lg-hub__link" href={link.href}>
                <span className="lg-hub__link-title">{say(link.title)}</span>
                <span className="lg-hub__link-body">{say(link.body)}</span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
