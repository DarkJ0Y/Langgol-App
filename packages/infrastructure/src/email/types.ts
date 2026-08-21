export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly body: string
}

export interface EmailSendResult {
  readonly accepted: boolean
  readonly providerRef?: string
  readonly error?: string
}

/**
 * The email boundary.
 *
 * Mirrors `SmsProvider` deliberately: same shape, same adapters, same registry pattern, so
 * there is one thing to learn rather than two. What differs is the standing of the channel —
 * SMS is the reliable channel in rural Bangladesh and carries the credential that logs a farmer
 * in, whereas email is an optional convenience for the traders and staff who have an inbox.
 *
 * That asymmetry is why nothing in the platform blocks on email, and why this provider is
 * allowed to be absent entirely: `emailProvider()` returns null when none is configured, and
 * every caller is required to cope. docs/01_MVP_REQUIREMENTS.md §79
 */
export interface EmailProvider {
  readonly id: string
  send(message: EmailMessage): Promise<EmailSendResult>
}
