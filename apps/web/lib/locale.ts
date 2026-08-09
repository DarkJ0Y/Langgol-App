/**
 * Locale resolution.
 *
 * Bangla is the default and the fallback. English is opt-in, chosen explicitly by the user or
 * requested by their browser — never inferred from anything else.
 */

import 'server-only'
import { cookies, headers } from 'next/headers'
import {
  createTranslator,
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  type Translator,
} from '@langgol/i18n'

export const LOCALE_COOKIE = 'langgol_locale'

/**
 * Explicit choice first, then the browser's preference, then Bangla.
 *
 * The browser check is deliberately narrow: only an explicit `en` preference switches away from
 * Bangla, because the farmer this product is judged against will more often have an
 * English-defaulted handset than an English reading preference.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies()
  const chosen = store.get(LOCALE_COOKIE)?.value
  if (chosen !== undefined && isLocale(chosen)) return chosen

  const accept = (await headers()).get('accept-language') ?? ''
  if (/^en\b/i.test(accept.trim())) return 'en'

  return DEFAULT_LOCALE
}

export async function getTranslator(): Promise<Translator> {
  return createTranslator(await getLocale())
}
