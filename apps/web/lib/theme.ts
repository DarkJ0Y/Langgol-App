/**
 * Colour theme resolution.
 *
 * Dark is the default and the fallback. Langgol is used outdoors and after dark, and the screens
 * are dense with figures — a dark ground lets the numbers carry the emphasis. Bright is opt-in,
 * chosen with the switch in the header, and remembered in a cookie.
 *
 * Deliberately not inferred from `prefers-color-scheme`: the product's default is a decision, and
 * a handset set to light for its own reasons should not override it. A visitor who wants bright
 * asks for it once.
 */

import 'server-only'
import { cookies } from 'next/headers'

export const THEME_COOKIE = 'langgol_theme'

export const THEMES = ['dark', 'light'] as const
export type Theme = (typeof THEMES)[number]

export const DEFAULT_THEME: Theme = 'dark'

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

export async function getTheme(): Promise<Theme> {
  const chosen = (await cookies()).get(THEME_COOKIE)?.value
  return isTheme(chosen) ? chosen : DEFAULT_THEME
}
