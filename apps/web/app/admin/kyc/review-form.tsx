'use client'

/**
 * One file's decision controls.
 *
 * Approve and reject are separate submit buttons on one form rather than a select plus a submit.
 * A reviewer working through a queue presses one thing, and a two-step control is where a
 * mis-click becomes an approval.
 *
 * The reason box is always visible rather than appearing when reject is chosen. A field that
 * appears on demand is a field somebody fills in after they have already decided; one that is
 * always there is a prompt to think before pressing.
 */

import { useActionState } from 'react'
import { Alert, Button, FormField, Textarea } from '@langgol/ui/components'
import { MAX_REASON_LENGTH } from '@langgol/domain/kyc'
import { reviewAction } from './actions'
import { DECISION_FIELD, REASON_FIELD, VERIFICATION_ID_FIELD } from './fields'
import { idleKycState } from '../../account/verification/state'

export interface ReviewFormLabels {
  readonly reason: string
  readonly reasonHint: string
  readonly approve: string
  readonly reject: string
  readonly loading: string
  readonly done: string
  readonly messages: Readonly<Record<string, string>>
  readonly errorUnexpected: string
}

export function ReviewForm({
  verificationId,
  labels,
}: {
  verificationId: string
  labels: ReviewFormLabels
}) {
  const [state, formAction, pending] = useActionState(reviewAction, idleKycState)

  const errorText =
    state.status === 'error'
      ? (labels.messages[state.errorKey ?? ''] ?? labels.errorUnexpected)
      : null

  return (
    <form action={formAction} className="lg-stack-tight">
      {state.status === 'ok' ? <Alert tone="success">{labels.done}</Alert> : null}
      {errorText === null ? null : <Alert tone="error">{errorText}</Alert>}

      <input type="hidden" name={VERIFICATION_ID_FIELD} value={verificationId} />

      <FormField
        id={`${REASON_FIELD}-${verificationId}`}
        label={labels.reason}
        hint={labels.reasonHint}
        {...(state.status === 'error' && state.field === REASON_FIELD && errorText !== null
          ? { error: errorText }
          : {})}
      >
        {({ describedBy, invalid }) => (
          <Textarea
            id={`${REASON_FIELD}-${verificationId}`}
            name={REASON_FIELD}
            rows={2}
            maxLength={MAX_REASON_LENGTH}
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      <div className="lg-row">
        {/*
         * `name` and `value` on the buttons themselves, so the pressed one names the decision.
         * The alternative — a select the buttons both submit — lets a reviewer press approve
         * while reject is selected.
         */}
        <Button type="submit" name={DECISION_FIELD} value="APPROVE" disabled={pending}>
          {pending ? labels.loading : labels.approve}
        </Button>
        <Button
          type="submit"
          name={DECISION_FIELD}
          value="REJECT"
          variant="secondary"
          disabled={pending}
        >
          {labels.reject}
        </Button>
      </div>
    </form>
  )
}
