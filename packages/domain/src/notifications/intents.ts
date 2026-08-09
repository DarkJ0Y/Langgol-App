/**
 * Farmer interaction intents.
 *
 * An intent is *what the user wants to do*, decoupled from *how they said it*. The web UI is one
 * way to raise an intent; a keypress in an IVR call or a USSD menu selection would be another.
 * No business rule lives in a React component, so adding a channel later is an adapter rather
 * than a redesign.
 *
 * The constraint that makes this real, rather than a naming exercise: **every intent must be
 * expressible in a handful of tokens** — one subject, one choice, an optional reason code. If a
 * farmer action cannot survive a phone keypad, it cannot survive a 2G connection and a cracked
 * screen either, so this is a useful discipline on the farmer UI *today*, not only later.
 *
 * IVR and USSD are NOT implemented (decision D8). This is the shape they would plug into, and
 * the codec below is the executable proof that the shape works.
 *
 * Refs: docs/03_ARCHITECTURE.md §8.1; docs/01_MVP_REQUIREMENTS.md §9.1 D8
 */

export type IntentKind =
  'AcceptOrder' | 'RejectOrder' | 'MarkReady' | 'ConfirmDelivery' | 'ReportProblem' | 'ViewOrder'

/** Reason codes, so a reason can be given by pressing a digit rather than typing a sentence. */
export type ReasonCode =
  | 'PRICE'
  | 'QUANTITY'
  | 'CROP_FAILURE'
  | 'WEATHER'
  | 'TRANSPORT'
  | 'QUALITY'
  | 'NOT_RECEIVED'
  | 'OTHER'

export interface Intent {
  readonly kind: IntentKind
  /** The order, listing or delivery the action applies to. */
  readonly subjectId: string
  readonly actorUserId: string
  readonly reasonCode?: ReasonCode
  readonly note?: string
}

interface IntentDefinition {
  readonly kind: IntentKind
  /** Does this intent change state? Read-only intents need no confirmation step. */
  readonly mutating: boolean
  readonly requiresReason: boolean
  /** Keypad digit in an IVR/USSD menu. Stable: a farmer learns "1 is accept". */
  readonly keypadDigit: string
  readonly roles: readonly string[]
}

export const INTENTS: Record<IntentKind, IntentDefinition> = {
  AcceptOrder: {
    kind: 'AcceptOrder',
    mutating: true,
    requiresReason: false,
    keypadDigit: '1',
    roles: ['FARMER'],
  },
  RejectOrder: {
    kind: 'RejectOrder',
    mutating: true,
    requiresReason: true,
    keypadDigit: '2',
    roles: ['FARMER'],
  },
  MarkReady: {
    kind: 'MarkReady',
    mutating: true,
    requiresReason: false,
    keypadDigit: '3',
    roles: ['FARMER'],
  },
  ConfirmDelivery: {
    kind: 'ConfirmDelivery',
    mutating: true,
    requiresReason: false,
    keypadDigit: '4',
    roles: ['FARMER', 'CONSUMER', 'RETAILER', 'OPS_AGENT'],
  },
  ReportProblem: {
    kind: 'ReportProblem',
    mutating: true,
    requiresReason: true,
    keypadDigit: '9',
    roles: ['FARMER', 'CONSUMER', 'RETAILER'],
  },
  ViewOrder: {
    kind: 'ViewOrder',
    mutating: false,
    requiresReason: false,
    keypadDigit: '0',
    roles: ['FARMER', 'CONSUMER', 'RETAILER', 'OPS_AGENT', 'ADMIN'],
  },
}

export class IntentError extends Error {
  readonly code: 'UNKNOWN_INTENT' | 'REASON_REQUIRED' | 'MALFORMED' | 'ROLE_NOT_PERMITTED'

  constructor(
    code: 'UNKNOWN_INTENT' | 'REASON_REQUIRED' | 'MALFORMED' | 'ROLE_NOT_PERMITTED',
    message: string,
  ) {
    super(message)
    this.name = 'IntentError'
    this.code = code
  }
}

const REASON_DIGITS: Record<string, ReasonCode> = {
  '1': 'PRICE',
  '2': 'QUANTITY',
  '3': 'CROP_FAILURE',
  '4': 'WEATHER',
  '5': 'TRANSPORT',
  '6': 'QUALITY',
  '7': 'NOT_RECEIVED',
  '9': 'OTHER',
}

export function intentDefinition(kind: IntentKind): IntentDefinition {
  const definition = INTENTS[kind]
  if (definition === undefined) {
    throw new IntentError('UNKNOWN_INTENT', `No such intent: ${String(kind)}`)
  }
  return definition
}

/** Validate an intent before any handler runs. Structure first, authorization second. */
export function validateIntent(intent: Intent, actorRoles: readonly string[]): void {
  const definition = intentDefinition(intent.kind)

  if (definition.requiresReason && intent.reasonCode === undefined) {
    throw new IntentError('REASON_REQUIRED', `${intent.kind} requires a reason`)
  }

  if (intent.subjectId.trim().length === 0) {
    throw new IntentError('MALFORMED', `${intent.kind} requires a subject`)
  }

  if (!definition.roles.some((role) => actorRoles.includes(role))) {
    throw new IntentError('ROLE_NOT_PERMITTED', `${intent.kind} is not available to this role`)
  }
}

/**
 * Encode an intent as a compact token sequence: `<digit>*<subject>[*<reasonDigit>]`.
 *
 * This is the executable proof that the intent model survives a keypad. If an intent cannot be
 * encoded here, it cannot be offered over IVR or USSD, and that is a signal about the design of
 * the action rather than a limitation of the channel.
 */
export function encodeIntent(intent: Intent): string {
  const definition = intentDefinition(intent.kind)
  const parts = [definition.keypadDigit, intent.subjectId]

  if (intent.reasonCode !== undefined) {
    const digit = Object.entries(REASON_DIGITS).find(([, code]) => code === intent.reasonCode)?.[0]
    if (digit === undefined) {
      throw new IntentError('MALFORMED', `Reason ${intent.reasonCode} has no keypad digit`)
    }
    parts.push(digit)
  }

  return parts.join('*')
}

/** Inverse of {@link encodeIntent}. */
export function decodeIntent(token: string, actorUserId: string): Intent {
  const parts = token.split('*')
  const digit = parts[0]
  const subjectId = parts[1]

  if (digit === undefined || subjectId === undefined || subjectId.length === 0) {
    throw new IntentError('MALFORMED', `Not an intent token: "${token}"`)
  }

  const entry = Object.values(INTENTS).find((definition) => definition.keypadDigit === digit)
  if (entry === undefined) {
    throw new IntentError('UNKNOWN_INTENT', `No intent for keypad digit "${digit}"`)
  }

  const reasonDigit = parts[2]
  const reasonCode = reasonDigit === undefined ? undefined : REASON_DIGITS[reasonDigit]

  if (reasonDigit !== undefined && reasonCode === undefined) {
    throw new IntentError('MALFORMED', `No reason for digit "${reasonDigit}"`)
  }

  return {
    kind: entry.kind,
    subjectId,
    actorUserId,
    ...(reasonCode === undefined ? {} : { reasonCode }),
  }
}
