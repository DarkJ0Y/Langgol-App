/**
 * OTP delivery adapter.
 *
 * Implements the auth port over the SMS boundary, and owns the spend accounting the circuit
 * breaker relies on. The use case never learns which channel carried the code — when IVR or
 * WhatsApp is added, this adapter changes and `requestOtp` does not.
 *
 * Refs: docs/03_ARCHITECTURE.md §8.1; docs/07_SECURITY.md §3.2
 */

import { prisma } from '@langgol/db'
import type { Locale, OtpDeliveryPort } from '@langgol/application'
import { Money } from '@langgol/domain/money'
import { env } from '@langgol/shared'
import { smsProvider } from './sms/index.js'

/**
 * OTP message copy.
 *
 * Bangla is the default. Kept deliberately short: a Bangla SMS is Unicode, which fits far fewer
 * characters per segment and therefore costs more per message — every extra word is money and a
 * longer delivery queue. This moves into the message catalogue when the notification template
 * registry lands.
 */
function renderOtpMessage(code: string, locale: Locale, expiresInSeconds: number): string {
  const minutes = Math.max(1, Math.round(expiresInSeconds / 60))
  if (locale === 'bn') {
    return `আপনার লংগল কোড ${code}। ${String(minutes)} মিনিটে মেয়াদ শেষ। কাউকে জানাবেন না।`
  }
  return `Your Langgol code is ${code}. It expires in ${String(minutes)} minutes. Do not share it.`
}

export function createOtpDelivery(): OtpDeliveryPort {
  const config = env()

  return {
    unitCost: Money.fromPoisha(config.SMS_UNIT_COST_POISHA),
    dailyBudget: Money.fromPoisha(config.SMS_DAILY_BUDGET_POISHA),

    async deliver({ phone, code, locale, expiresInSeconds }) {
      const body = renderOtpMessage(code, locale, expiresInSeconds)
      const result = await smsProvider().send({ to: phone, body, unicode: locale === 'bn' })

      // The notification row records the template and its variables — never the rendered body,
      // which contains the code itself. docs/07_SECURITY.md §9.2
      await prisma.notification.create({
        data: {
          destination: phone,
          channel: 'SMS',
          template: 'auth.otp',
          locale: locale === 'bn' ? 'BN' : 'EN',
          payload: { expiresInSeconds },
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

    async sentToday(now) {
      const startOfDay = new Date(now)
      startOfDay.setUTCHours(0, 0, 0, 0)
      return prisma.notification.count({
        where: {
          channel: 'SMS',
          createdAt: { gte: startOfDay },
          status: { in: ['QUEUED', 'SENT', 'DELIVERED'] },
        },
      })
    },
  }
}
