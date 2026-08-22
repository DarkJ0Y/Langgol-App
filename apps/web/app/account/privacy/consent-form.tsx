'use client'

import { useActionState } from 'react'
import { Alert, Button, Checkbox } from '@langgol/ui/components'
import { acceptTermsAction, saveConsentPreferencesAction } from './actions'
import { CONSENT_FIELD_PREFIX } from './form'
import { idleConsentState } from './state'

export interface ConsentItem {
  readonly type: string
  readonly title: string
  readonly purpose: string
  readonly granted: boolean
  readonly stale: boolean
  /** Already formatted server-side; the client never formats a date. */
  readonly decidedOn: string | null
}

export interface ConsentFormLabels {
  readonly requiredTitle: string
  readonly requiredSubtitle: string
  readonly optionalTitle: string
  readonly optionalSubtitle: string
  readonly accepted: string
  readonly notAccepted: string
  readonly accept: string
  readonly updated: string
  readonly save: string
  readonly saved: string
  readonly loading: string
  readonly errorInvalid: string
  readonly errorNotAllowed: string
  readonly errorUnexpected: string
}

/**
 * The consent screen.
 *
 * Three things about its shape are requirements rather than styling:
 *
 *  - **Required and optional are two separate forms**, with their own headings and their own
 *    submit buttons. One form containing both would make accepting the terms and allowing
 *    marketing look like the same kind of act, and a single "agree" button over both would be
 *    the bundling the requirement forbids.
 *  - **Every optional permission is its own switch, and none is ticked by default.** The
 *    checkbox reflects what is actually stored; a pre-ticked box would be consent nobody gave.
 *    There is no "allow all" control, deliberately.
 *  - **The declared list travels with the submission**, because an unticked checkbox posts
 *    nothing. Without it, withdrawing a permission would be indistinguishable from not having
 *    submitted it, and unticking would silently do nothing.
 *
 * Refs: docs/07_SECURITY.md §9.2
 */
export function ConsentForm({
  required,
  optional,
  labels,
}: {
  required: readonly ConsentItem[]
  optional: readonly ConsentItem[]
  labels: ConsentFormLabels
}) {
  const [saveState, saveAction, saving] = useActionState(
    saveConsentPreferencesAction,
    idleConsentState,
  )
  const [acceptState, acceptAction, accepting] = useActionState(acceptTermsAction, idleConsentState)

  const messageFor = (state: typeof saveState) => {
    if (state.status === 'ok') return { tone: 'success' as const, text: labels.saved }
    if (state.status !== 'error') return null
    return {
      tone: 'error' as const,
      text:
        state.errorKey === 'errors.consentInvalid'
          ? labels.errorInvalid
          : state.errorKey === 'errors.notAllowed'
            ? labels.errorNotAllowed
            : labels.errorUnexpected,
    }
  }

  const saveMessage = messageFor(saveState)
  const acceptMessage = messageFor(acceptState)
  const outstanding = required.filter((item) => !item.granted || item.stale)

  return (
    <div className="lg-stack">
      {/* Required — presented as what they are, never as switches. */}
      <section className="lg-stack-tight">
        <h2 className="lg-title">{labels.requiredTitle}</h2>
        <p className="lg-subtitle">{labels.requiredSubtitle}</p>

        {required.map((item) => (
          <div key={item.type} className="lg-stack-tight">
            <strong>{item.title}</strong>
            <p className="lg-subtitle">{item.purpose}</p>
            {item.stale ? (
              <Alert tone="warning">{labels.updated}</Alert>
            ) : item.granted ? (
              <span className="lg-subtitle">
                {item.decidedOn === null ? labels.accepted : item.decidedOn}
              </span>
            ) : (
              <span className="lg-subtitle">{labels.notAccepted}</span>
            )}
          </div>
        ))}

        {outstanding.length === 0 ? null : (
          <form action={acceptAction} className="lg-stack-tight">
            {acceptMessage === null ? null : (
              <Alert tone={acceptMessage.tone}>{acceptMessage.text}</Alert>
            )}
            <Button type="submit" loading={accepting}>
              {accepting ? labels.loading : labels.accept}
            </Button>
          </form>
        )}
      </section>

      {/* Optional — one switch each, no bundling, nothing pre-ticked. */}
      <form action={saveAction} className="lg-stack">
        <h2 className="lg-title">{labels.optionalTitle}</h2>
        <p className="lg-subtitle">{labels.optionalSubtitle}</p>

        {saveMessage === null ? null : <Alert tone={saveMessage.tone}>{saveMessage.text}</Alert>}

        {/*
          Which permissions this submission answers. An unticked checkbox posts nothing, so
          without this the server could not tell a withdrawal from a field that was never sent.
        */}
        <input type="hidden" name="types" value={optional.map((item) => item.type).join(',')} />

        {optional.map((item) => (
          <div key={item.type} className="lg-stack-tight">
            <Checkbox
              name={`${CONSENT_FIELD_PREFIX}${item.type}`}
              label={item.title}
              description={item.purpose}
              // Reflects what is stored. Never defaulted to true.
              defaultChecked={item.granted}
            />
            {item.decidedOn === null ? null : <span className="lg-subtitle">{item.decidedOn}</span>}
          </div>
        ))}

        <Button type="submit" loading={saving}>
          {saving ? labels.loading : labels.save}
        </Button>
      </form>
    </div>
  )
}
