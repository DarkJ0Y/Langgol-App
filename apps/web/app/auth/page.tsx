import { redirect } from 'next/navigation'
import { authMode } from '@/lib/deps'

/**
 * Authentication entry point.
 *
 * Dispatches on the SERVER-side mode. The browser is never told which mode is active by a
 * public environment variable, and never gets to choose.
 */
export default function AuthPage() {
  redirect(authMode() === 'development' ? '/auth/development' : '/auth/phone')
}
