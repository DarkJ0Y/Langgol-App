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
import type { OtpDeliveryPort } from '@langgol/application'
import { Money } from '@langgol/domain/money'
import { isSensitive, renderTemplate } from '@langgol/domain/notifications'
import { env } from '@langgol/shared'
import { smsProvider } from './sms/index.js'

export function createOtpDelivery(): OtpDeliveryPort {
  const config = env()

  return {
    unitCost: Money.fromPoisha(config.SMS_UNIT_COST_POISHA),
    dailyBudget: Money.fromPoisha(config.SMS_DAILY_BUDGET_POISHA),

    async deliver({ phone, code, locale, expiresInSeconds }) {
      const minutes = Math.max(1, Math.round(expiresInSeconds / 60))
      const message = renderTemplate('auth.otp', locale, { code, minutes }, 'SMS')
      const result = await smsProvider().send({
        to: phone,
        body: message.body,
        unicode: message.unicode,
      })

      // The notification row records the template and its variables — never the rendered body,
      // which contains the code itself. docs/07_SECURITY.md §9.2
      await prisma.notification.create({
        data: {
          destination: phone,
          channel: 'SMS',
          template: 'auth.otp',
          locale: locale === 'bn' ? 'BN' : 'EN',
          // The template is marked sensitive, so its rendered body — which contains the code —
          // is never persisted. Only the non-secret variables are.
          payload: isSensitive('auth.otp')
            ? { minutes, segments: message.segments }
            : { minutes, segments: message.segments, body: message.body },
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
