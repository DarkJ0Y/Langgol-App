/**
 * The demonstration advisory provider.
 *
 * Answers from a short script instead of a model, so the whole assistant — consent, the photo
 * checks, the spend guard, the audit trail, the answer card — can be shown and tested before a
 * real model is contracted. It implements the same `AdvisoryPort` a model adapter will, so going
 * live is an adapter and a setting (ADVISORY_PROVIDER), not a change to the use case or the page.
 *
 * ## What it will and will not say
 *
 * General, cautious first steps a field officer would agree with — check drainage, look under
 * the leaves, remove what is clearly infected — and "ask your agriculture officer before using
 * any chemical". It never names a pesticide or a dose: a scripted answer cannot see the crop, and
 * a wrong chemical costs a farmer a season. Confidence is never above MEDIUM, and LOW when the
 * question matched nothing.
 *
 * The answer is chosen from the farmer's words, in Bangla or English; the photograph is accepted
 * (the use case requires one) and ignored. `providerName` is "demo", which is what the diagnoses
 * table records, so a demonstration answer is never mistaken for a model's in the log. Refused in
 * production by the environment check.
 */

import * as Money from '@langgol/domain/money'
import type { AdvisoryPort, AdvisoryResult, DiagnoseInput } from '@langgol/application'

interface Script {
  /** Lower-case fragments, Bangla and English, any of which selects this answer. */
  readonly match: readonly string[]
  readonly confidence: 'MEDIUM' | 'LOW'
  readonly bn: string
  readonly en: string
}

const SCRIPTS: readonly Script[] = [
  {
    match: ['yellow', 'pale', 'হলুদ', 'ফ্যাকাশে'],
    confidence: 'MEDIUM',
    bn: [
      'সম্ভাব্য কারণ: নাইট্রোজেনের ঘাটতি, অথবা জমিতে পানি জমে থাকা।',
      '',
      'যা করবেন:',
      '১. দেখুন হলুদ ভাব নিচের পুরনো পাতায় শুরু হয়েছে কি না — তাহলে নাইট্রোজেনের ঘাটতি বেশি সম্ভব।',
      '২. জমিতে পানি জমে থাকলে নালা কেটে বের করে দিন।',
      '৩. সার দেওয়ার আগে মাটি পরীক্ষা করান, বা উপজেলা কৃষি অফিসের পরামর্শ নিন।',
      '৪. এক সপ্তাহে না কমলে বা দ্রুত ছড়ালে কাছের কৃষি বিশেষজ্ঞকে দেখান।',
    ].join('\n'),
    en: [
      'Likely cause: nitrogen deficiency, or waterlogged soil.',
      '',
      'What to do:',
      '1. Check whether the yellowing started on the older, lower leaves — that points to nitrogen.',
      '2. If water is standing in the field, cut a drain to let it out.',
      '3. Before adding fertiliser, get the soil tested or ask your upazila agriculture office.',
      '4. If it has not improved in a week, or is spreading fast, show it to an agricultural expert.',
    ].join('\n'),
  },
  {
    match: ['spot', 'blast', 'brown', 'দাগ', 'বাদামি', 'ব্লাস্ট'],
    confidence: 'MEDIUM',
    bn: [
      'সম্ভাব্য কারণ: ছত্রাকজনিত পাতার দাগ রোগ (ধানে ব্লাস্ট হতে পারে)।',
      '',
      'যা করবেন:',
      '১. বেশি আক্রান্ত পাতা তুলে জমির বাইরে নষ্ট করুন।',
      '২. আপাতত বাড়তি ইউরিয়া দেবেন না — এতে রোগ বাড়ে।',
      '৩. গাছের ওপর দিয়ে পানি দেওয়া এড়িয়ে চলুন, সকালে সেচ দিন।',
      '৪. কোনো ছত্রাকনাশক ব্যবহারের আগে কৃষি অফিসারের কাছে অনুমোদিত ওষুধ ও মাত্রা জেনে নিন।',
    ].join('\n'),
    en: [
      'Likely cause: a fungal leaf-spot disease (in rice, possibly blast).',
      '',
      'What to do:',
      '1. Remove the worst-affected leaves and destroy them away from the field.',
      '2. Hold back extra urea for now — it makes this worse.',
      '3. Avoid watering over the plants; irrigate in the morning.',
      '4. Before using any fungicide, ask your agriculture officer which is approved, and how much.',
    ].join('\n'),
  },
  {
    match: ['insect', 'pest', 'hole', 'worm', 'bug', 'পোকা', 'ছিদ্র', 'ফুটো', 'মাজরা'],
    confidence: 'MEDIUM',
    bn: [
      'সম্ভাব্য কারণ: পোকার আক্রমণ (যেমন মাজরা পোকা বা জাব পোকা)।',
      '',
      'যা করবেন:',
      '১. পাতার নিচে ও কাণ্ডের ভেতর পোকা বা ডিম আছে কি না দেখুন।',
      '২. অল্প হলে হাত দিয়ে তুলে নষ্ট করুন; রাতে আলোর ফাঁদ ব্যবহার করতে পারেন।',
      '৩. নিম-ভিত্তিক জৈব পদ্ধতি প্রথমে চেষ্টা করুন।',
      '৪. রাসায়নিক কীটনাশকের আগে কৃষি অফিসারের পরামর্শ নিন — ভুল ওষুধ উপকারী পোকাও মারে।',
    ].join('\n'),
    en: [
      'Likely cause: an insect pest (for example stem borer or aphids).',
      '',
      'What to do:',
      '1. Look under the leaves and inside the stems for insects or eggs.',
      '2. If there are few, pick them off by hand; a light trap at night also helps.',
      '3. Try neem-based organic methods first.',
      '4. Ask your agriculture officer before any chemical — the wrong one kills helpful insects too.',
    ].join('\n'),
  },
  {
    match: ['wilt', 'droop', 'dry', 'নেতিয়ে', 'ঝিমিয়ে', 'শুকিয়ে', 'ঢলে'],
    confidence: 'MEDIUM',
    bn: [
      'সম্ভাব্য কারণ: পানির অভাব, অথবা ব্যাকটেরিয়াজনিত ঢলে পড়া রোগ।',
      '',
      'যা করবেন:',
      '১. গোড়ার মাটি শুকনো কি না দেখুন; শুকনো হলে সেচ দিন।',
      '২. একটি আক্রান্ত কাণ্ড কেটে স্বচ্ছ পানিতে রাখুন — দুধের মতো রস বের হলে ব্যাকটেরিয়ার রোগ।',
      '৩. রোগাক্রান্ত গাছ তুলে জমির বাইরে নষ্ট করুন, যাতে না ছড়ায়।',
      '৪. দ্রুত ছড়ালে আজই কৃষি বিশেষজ্ঞকে দেখান।',
    ].join('\n'),
    en: [
      'Likely cause: water stress, or a bacterial wilt.',
      '',
      'What to do:',
      '1. Check whether the soil at the base is dry; if so, irrigate.',
      '2. Cut an affected stem and stand it in clear water — a milky ooze means a bacterial disease.',
      '3. Pull out diseased plants and destroy them away from the field so it does not spread.',
      '4. If it is spreading fast, show it to an agricultural expert today.',
    ].join('\n'),
  },
]

const FALLBACK = {
  confidence: 'LOW' as const,
  bn: [
    'ছবি আর বর্ণনা থেকে নিশ্চিত হওয়া যাচ্ছে না।',
    '',
    'আরও ভালো উত্তরের জন্য:',
    '১. দিনের আলোয় আক্রান্ত পাতার কাছ থেকে একটি পরিষ্কার ছবি তুলুন।',
    '২. লিখুন কী দেখছেন — রং বদল, দাগ, পোকা, নেতিয়ে পড়া — আর কবে থেকে।',
    '৩. জরুরি হলে উপজেলা কৃষি অফিস বা কাছের কৃষি বিশেষজ্ঞের সাথে কথা বলুন।',
  ].join('\n'),
  en: [
    'This is not clear enough to say from the photo and description.',
    '',
    'For a better answer:',
    '1. Take a close, clear photo of an affected leaf in daylight.',
    '2. Say what you see — colour change, spots, insects, wilting — and since when.',
    '3. If it is urgent, talk to your upazila agriculture office or a nearby expert.',
  ].join('\n'),
}

export function createDemoAdvisory(): AdvisoryPort {
  return {
    isAvailable: true,
    providerName: 'demo',
    // A scripted answer costs nothing; the per-farmer daily limit still applies.
    unitCost: Money.fromPoisha(0n),

    async diagnose(input: DiagnoseInput): Promise<AdvisoryResult> {
      const words = (input.question ?? '').toLowerCase()
      const script = SCRIPTS.find((candidate) =>
        candidate.match.some((fragment) => words.includes(fragment)),
      )
      const chosen = script ?? FALLBACK
      return {
        ok: true,
        diagnosis: {
          answer: input.locale === 'bn' ? chosen.bn : chosen.en,
          confidence: chosen.confidence,
          unusableImage: false,
        },
      }
    },
  }
}

/** No provider configured: the use case reports the assistant as unavailable, not as broken. */
export const noAdvisory: AdvisoryPort = {
  isAvailable: false,
  providerName: 'none',
  unitCost: Money.fromPoisha(0n),
  async diagnose() {
    return { ok: false, reason: 'NOT_CONFIGURED' }
  },
}
