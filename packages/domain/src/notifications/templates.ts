/**
 * Notification templates — channel-agnostic message definitions.
 *
 * A template declares its *meaning* and its variables. Each channel renders it. An SMS body, an
 * IVR script and a USSD menu string are three renderings of one message, not three messages, so
 * adding a channel is a renderer, never a rewrite of the domain.
 *
 * Two constraints shape everything here:
 *
 *  - **Bangla is the default.** Farmer surfaces are Bangla-first; English is the toggle.
 *  - **Bangla SMS is Unicode**, which fits ~70 characters per segment against 160 for GSM-7.
 *    Every extra word is money and a longer delivery queue, so templates are terse by design
 *    and their length is asserted in tests.
 *
 * Refs: docs/03_ARCHITECTURE.md §8.1; docs/08_BANGLADESH_CONTEXT.md §1, §4
 */

export type NotificationChannel = 'SMS' | 'IN_APP' | 'EMAIL' | 'PUSH' | 'IVR' | 'USSD'
export type MessageLocale = 'bn' | 'en'

/** Characters per SMS segment. Unicode (Bangla) fits far fewer than GSM-7 (Latin). */
export const SMS_SEGMENT_GSM7 = 160
export const SMS_SEGMENT_UNICODE = 70

export type TemplateId = 'auth.otp' | 'auth.new-device' | 'account.role-granted'

export interface TemplateVariables {
  readonly [key: string]: string | number
}

export interface RenderedMessage {
  readonly body: string
  /** Bangla text is Unicode, which changes both cost and segment count. */
  readonly unicode: boolean
  readonly segments: number
}

interface TemplateDefinition {
  readonly id: TemplateId
  readonly channels: readonly NotificationChannel[]
  readonly required: readonly string[]
  /**
   * `true` when the rendered body contains a secret (an OTP). Such a body is delivered but
   * NEVER persisted — the notification row stores the template id and its non-secret variables.
   * docs/07_SECURITY.md §9.2
   */
  readonly sensitive: boolean
  readonly render: Record<MessageLocale, (vars: TemplateVariables) => string>
}

const TEMPLATES: Record<TemplateId, TemplateDefinition> = {
  'auth.otp': {
    id: 'auth.otp',
    channels: ['SMS', 'IVR'],
    required: ['code', 'minutes'],
    sensitive: true,
    render: {
      bn: (v) =>
        `আপনার লাঙ্গল কোড ${String(v['code'])}। ${String(v['minutes'])} মিনিটে মেয়াদ শেষ। কাউকে জানাবেন না।`,
      en: (v) =>
        `Your Langgol code is ${String(v['code'])}. It expires in ${String(v['minutes'])} minutes. Do not share it.`,
    },
  },

  'auth.new-device': {
    id: 'auth.new-device',
    channels: ['SMS', 'IN_APP'],
    required: ['when'],
    sensitive: false,
    render: {
      bn: (v) => `নতুন ডিভাইস থেকে আপনার লাঙ্গল অ্যাকাউন্টে প্রবেশ হয়েছে (${String(v['when'])})।`,
      en: (v) => `Your Langgol account was signed in from a new device (${String(v['when'])}).`,
    },
  },

  'account.role-granted': {
    id: 'account.role-granted',
    channels: ['SMS', 'IN_APP'],
    required: ['role'],
    sensitive: false,
    render: {
      bn: (v) => `আপনার লাঙ্গল অ্যাকাউন্টে নতুন ভূমিকা যোগ হয়েছে: ${String(v['role'])}।`,
      en: (v) => `A new role was added to your Langgol account: ${String(v['role'])}.`,
    },
  },
}

export class TemplateError extends Error {
  readonly code: 'UNKNOWN_TEMPLATE' | 'MISSING_VARIABLE' | 'UNSUPPORTED_CHANNEL'

  constructor(
    code: 'UNKNOWN_TEMPLATE' | 'MISSING_VARIABLE' | 'UNSUPPORTED_CHANNEL',
    message: string,
  ) {
    super(message)
    this.name = 'TemplateError'
    this.code = code
  }
}

export function templateDefinition(id: TemplateId): TemplateDefinition {
  const definition = TEMPLATES[id]
  if (definition === undefined) {
    throw new TemplateError('UNKNOWN_TEMPLATE', `No such notification template: ${id}`)
  }
  return definition
}

export function isSensitive(id: TemplateId): boolean {
  return templateDefinition(id).sensitive
}

export function supportsChannel(id: TemplateId, channel: NotificationChannel): boolean {
  return templateDefinition(id).channels.includes(channel)
}

/**
 * Does the message need Unicode encoding?
 *
 * Checked by code point rather than by regex: the GSM-7 alphabet is a specific set, and a
 * character-class regex here is both easy to get subtly wrong and hard to read. Anything outside
 * printable ASCII forces UCS-2, which is what Bangla does.
 */
function requiresUnicode(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 0x20 || codePoint > 0x7e) return true
  }
  return false
}

export function segmentCount(text: string): number {
  const size = requiresUnicode(text) ? SMS_SEGMENT_UNICODE : SMS_SEGMENT_GSM7
  return Math.max(1, Math.ceil(text.length / size))
}

/**
 * Render a template.
 *
 * Missing variables are an error, never an empty string: a message reading "Your Langgol code
 * is ." is worse than a failed send, because the user acts on it.
 */
export function renderTemplate(
  id: TemplateId,
  locale: MessageLocale,
  variables: TemplateVariables,
  channel: NotificationChannel = 'SMS',
): RenderedMessage {
  const definition = templateDefinition(id)

  if (!definition.channels.includes(channel)) {
    throw new TemplateError(
      'UNSUPPORTED_CHANNEL',
      `Template ${id} does not support the ${channel} channel`,
    )
  }

  for (const key of definition.required) {
    if (variables[key] === undefined || variables[key] === '') {
      throw new TemplateError('MISSING_VARIABLE', `Template ${id} requires "${key}"`)
    }
  }

  const body = definition.render[locale](variables)
  return { body, unicode: requiresUnicode(body), segments: segmentCount(body) }
}
