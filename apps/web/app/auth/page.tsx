import { redirect } from 'next/navigation'
import type { AuthMode } from '@langgol/domain/identity'
import { authMode } from '@/lib/deps'

/**
 * Authentication entry point.
 *
 * Dispatches on the SERVER-side mode. The browser is never told which mode is active by a
 * public environment variable, and never gets to choose.
 */
/** One screen per mode. Exhaustive, so adding a mode without a screen fails to compile. */
const ENTRY_SCREEN = {
  development: '/auth/development',
  firebase: '/auth/firebase',
  otp: '/auth/phone',
} as const satisfies Record<AuthMode, string>

export default function AuthPage() {
  redirect(ENTRY_SCREEN[authMode()])
}
