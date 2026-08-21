/**
 * Verification email delivery.
 *
 * The counterpart of `otp-delivery.ts`, and deliberately shaped the same way: render a template,
 * hand it to a provider behind a boundary, record a notification row that carries the template
 * and its non-secret variables but never the rendered body.
 *
 * The body is withheld for the same reason as the OTP's. `auth.email-verify` is marked sensitive
 * because the link it contains IS a bearer credential until it expires — persisting the message
 * would put a redeemable credential in a table that exists for operational history and outlives
 * the token that made it dangerous.
 *
 * Refs: docs/03_ARCHITECTURE.md §8.1; docs/07_SECURITY.md §9.2
 */

import { prisma } from '@langgol/db'
import type { EmailDeliveryPort } from '@langgol/application'
import { isSensitive, renderTemplate } from '@langgol/domain/notifications'
import { maskEmail } from '@langgol/domain/identity'
import { emailProvider } from './email/index.js'

const SUBJECT: Record<'bn' | 'en', string> = {
  bn: 'আপনার লাঙ্গল ইমেইল নিশ্চিত করুন',
  en: 'Confirm your Langgol email address',
}

export function createEmailDelivery(): EmailDeliveryPort {
  const provider = emailProvider()

  return {
    // Read once at construction. A deployment does not gain a mail vendor mid-request, and the
    // account screen needs a straight answer before it offers the user a button.
    available: provider !== null,

    async deliver({ to, link, locale, expiresInSeconds, userId }) {
      if (provider === null) return { accepted: false }

      const hours = Math.max(1, Math.round(expiresInSeconds / 3600))
      const message = renderTemplate('auth.email-verify', locale, { link, hours }, 'EMAIL')

      const result = await provider.send({
        to,
        subject: SUBJECT[locale],
        body: message.body,
      })

      await prisma.notification.create({
        data: {
          userId,
          // Masked even here. The notification table is operational history, and a full address
          // in it is personal data with a retention policy nobody chose. docs/07 §11
          destination: maskEmail(to),
          channel: 'EMAIL',
          template: 'auth.email-verify',
          locale: locale === 'bn' ? 'BN' : 'EN',
          // Sensitive, so the rendered body — which carries the link — is never stored. Note
          // that `hours` is safe and `link` is not, so only the former is recorded.
          payload: isSensitive('auth.email-verify') ? { hours } : { hours, body: message.body },
          status: result.accepted ? 'SENT' : 'FAILED',
          providerRef: result.providerRef ?? null,
          error: result.error ?? null,
          attempts: 1,
          sentAt: result.accepted ? new Date() : null,
        },
      })

      return result.providerRef === undefined
        ? { accepted: result.accepted }
        : { accepted: result.accepted, providerRef: result.providerRef }
    },
  }
}
