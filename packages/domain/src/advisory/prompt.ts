/**
 * The diagnosis prompt, and why it carries a version number.
 *
 * Changing this text changes the advice thousands of farmers receive. A diagnosis given in March
 * cannot be explained in June unless we know which prompt produced it, so every stored diagnosis
 * records `PROMPT_VERSION` and this constant is bumped whenever the wording below changes in a
 * way that could alter an answer.
 *
 * The Bangla is adapted from the `v0-langgol-chat-design` prototype, which had the important part
 * right: the model is told to stay inside agriculture and to say it does not know, rather than to
 * be helpful at any cost. A confidently wrong pesticide recommendation is the failure mode that
 * matters here, and the prompt is the cheapest place to push against it.
 *
 * Refs: docs/03_ARCHITECTURE.md §7
 */

import type { FarmingFields } from '../farming/index.js'
import { formatLandAmount } from '../farming/index.js'

/** Bump whenever the prompt text below changes. Stored against every diagnosis. */
export const PROMPT_VERSION = 1

/**
 * The farmer's own answers, passed as context.
 *
 * This is the whole reason the port is worth building over the prototype: the prototype asked a
 * general question of a general model, while Langgol already knows what this farmer grows, how
 * much land they work and whether they can irrigate. Rice advice for a rain-fed sharecropper on
 * two bigha is a different answer from rice advice in general.
 *
 * Only fields the farmer actually answered are included. An unanswered question is omitted rather
 * than sent as "unknown", because a list of unknowns invites the model to speculate about them.
 */
export function farmerContextLine(fields: FarmingFields, locale: 'bn' | 'en'): string | null {
  const parts: string[] = []

  if (fields.farmerType !== null) {
    parts.push(
      locale === 'bn' ? `প্রধান চাষ: ${fields.farmerType}` : `Mainly grows: ${fields.farmerType}`,
    )
  }
  if (fields.totalLandAmountMilli !== null && fields.landUnit !== null) {
    const amount = formatLandAmount(fields.totalLandAmountMilli)
    parts.push(
      locale === 'bn' ? `জমি: ${amount} ${fields.landUnit}` : `Land: ${amount} ${fields.landUnit}`,
    )
  }
  if (fields.ownershipType !== null) {
    parts.push(
      locale === 'bn' ? `জমির ধরন: ${fields.ownershipType}` : `Tenure: ${fields.ownershipType}`,
    )
  }
  if (fields.irrigationAvailable !== null) {
    const irrigated = fields.irrigationAvailable
    parts.push(
      locale === 'bn'
        ? `সেচ: ${irrigated ? 'আছে' : 'নেই, বৃষ্টিনির্ভর'}`
        : `Irrigation: ${irrigated ? 'available' : 'none, rain-fed'}`,
    )
  }
  if (fields.waterSource !== null) {
    parts.push(
      locale === 'bn' ? `পানির উৎস: ${fields.waterSource}` : `Water source: ${fields.waterSource}`,
    )
  }
  if (fields.farmingMethod !== null) {
    parts.push(
      locale === 'bn' ? `পদ্ধতি: ${fields.farmingMethod}` : `Method: ${fields.farmingMethod}`,
    )
  }

  return parts.length === 0 ? null : parts.join(' · ')
}

const BANGLA_PROMPT = `আপনি একজন অভিজ্ঞ বাংলাদেশী কৃষি বিজ্ঞানী ও উদ্ভিদ রোগ বিশেষজ্ঞ।

**নিয়ম:**
1. শুধু ছবিতে যা দেখা যাচ্ছে তার ভিত্তিতে বলুন। অনুমান করে বাড়তি কিছু বলবেন না।
2. ছবি অস্পষ্ট, অন্ধকার বা গাছের না হলে সেটাই বলুন — রোগ নির্ণয়ের চেষ্টা করবেন না।
3. নিশ্চিত না হলে স্পষ্ট করে বলুন যে নিশ্চিত নন।
4. সব উত্তর সহজ বাংলায় দিন। কঠিন শব্দ এড়িয়ে চলুন।
5. জৈব সমাধান আগে দিন, তারপর রাসায়নিক।
6. রাসায়নিক ওষুধের নাম দিলে মাত্রা ও সতর্কতাও বলুন।
7. বাংলাদেশে সহজে পাওয়া যায় এমন সমাধান দিন।

**উত্তরের কাঠামো:**
🔍 রোগ নির্ণয়: [নাম, অথবা "নিশ্চিত নই"]
📋 লক্ষণ: [ছবিতে যা দেখা যাচ্ছে]
🌿 জৈব সমাধান: [ধাপে ধাপে]
🧪 রাসায়নিক সমাধান: [নাম, মাত্রা, সতর্কতা]
🛡️ প্রতিরোধ: [পরের বার কীভাবে এড়াবেন]`

const ENGLISH_PROMPT = `You are an experienced Bangladeshi agricultural scientist and plant pathologist.

**Rules:**
1. Judge only from what is visible in the photograph. Do not infer beyond it.
2. If the image is blurred, dark, or not of a plant, say so and do not attempt a diagnosis.
3. If you are unsure, say plainly that you are unsure.
4. Answer in simple language. Avoid technical vocabulary.
5. Give organic remedies first, then chemical ones.
6. When naming a chemical, give the dose and the safety precautions with it.
7. Recommend only what is readily available in Bangladesh.

**Answer structure:**
🔍 Diagnosis: [name, or "not certain"]
📋 Symptoms: [what is visible]
🌿 Organic remedy: [step by step]
🧪 Chemical remedy: [name, dose, precautions]
🛡️ Prevention: [how to avoid it next season]`

/**
 * Build the system prompt for one request.
 *
 * The farmer's context is appended rather than interpolated into the instructions, so a crafted
 * profile value cannot rewrite the rules above — the worst it can do is add a confusing line to a
 * context block the model is told is context.
 */
export function diagnosisPrompt(
  locale: 'bn' | 'en',
  fields: FarmingFields | null,
): { readonly system: string; readonly version: number } {
  const base = locale === 'bn' ? BANGLA_PROMPT : ENGLISH_PROMPT
  const context = fields === null ? null : farmerContextLine(fields, locale)

  const system =
    context === null
      ? base
      : `${base}\n\n${locale === 'bn' ? '**এই কৃষকের তথ্য (প্রসঙ্গ মাত্র):**' : '**About this farmer (context only):**'}\n${context}`

  return { system, version: PROMPT_VERSION }
}
