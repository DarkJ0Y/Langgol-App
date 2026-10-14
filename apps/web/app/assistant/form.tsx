'use client'

import { useActionState } from 'react'
import { Alert, Button, FormField, Input, Textarea } from '@langgol/ui/components'
import { askAssistantAction } from '@/app/actions/advisory'
import { idleAssistantState, type AssistantError } from './state'

export interface AssistantLabels {
  readonly photo: string
  readonly photoHint: string
  readonly crop: string
  readonly anyCrop: string
  readonly question: string
  readonly questionHint: string
  readonly submit: string
  readonly loading: string
  readonly answerTitle: string
  readonly confidence: string
  readonly confidenceLevels: Readonly<Record<'LOW' | 'MEDIUM' | 'HIGH', string>>
  readonly unusable: string
  readonly errors: Readonly<Record<AssistantError, string>>
}

/** How far along the three-step confidence scale; drawn as a short meter beside the word. */
const CONFIDENCE_STEPS = { LOW: 1, MEDIUM: 2, HIGH: 3 } as const

export function AssistantForm({
  labels,
  crops,
}: {
  labels: AssistantLabels
  crops: readonly { readonly value: string; readonly label: string }[]
}) {
  const [state, formAction, pending] = useActionState(askAssistantAction, idleAssistantState)

  return (
    <div className="lg-assistant">
      <form action={formAction} className="lg-stack" encType="multipart/form-data">
        {state.status === 'error' ? <Alert tone="error">{labels.errors[state.error]}</Alert> : null}

        <FormField id="photo" label={labels.photo} hint={labels.photoHint}>
          {({ describedBy, invalid }) => (
            <Input
              id="photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              // On a phone this offers the camera directly. It opens the camera app; the page
              // never asks for camera access itself.
              capture="environment"
              required
              describedBy={describedBy}
              invalid={invalid}
            />
          )}
        </FormField>

        <FormField id="crop" label={labels.crop}>
          {({ describedBy }) => (
            <select id="crop" name="crop" className="lg-input" aria-describedby={describedBy}>
              <option value="">{labels.anyCrop}</option>
              {crops.map((crop) => (
                <option key={crop.value} value={crop.value}>
                  {crop.label}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField id="question" label={labels.question} hint={labels.questionHint}>
          {({ describedBy, invalid }) => (
            <Textarea
              id="question"
              name="question"
              rows={3}
              maxLength={500}
              describedBy={describedBy}
              invalid={invalid}
            />
          )}
        </FormField>

        <Button type="submit" loading={pending}>
          {pending ? labels.loading : labels.submit}
        </Button>
      </form>

      {state.status === 'done' ? (
        <section className="lg-answer" aria-live="polite">
          <header className="lg-answer__head">
            <h2 className="lg-answer__title">{labels.answerTitle}</h2>
            <span className="lg-answer__confidence">
              <span className="lg-answer__steps" aria-hidden="true">
                {[1, 2, 3].map((step) => (
                  <i
                    key={step}
                    className={step <= CONFIDENCE_STEPS[state.confidence] ? 'is-on' : undefined}
                  />
                ))}
              </span>
              {labels.confidence}: {labels.confidenceLevels[state.confidence]}
            </span>
          </header>
          {state.unusableImage ? <Alert tone="warning">{labels.unusable}</Alert> : null}
          {/* Text, never HTML: the provider's words are rendered as they came, line breaks kept. */}
          <p className="lg-answer__body">{state.answer}</p>
          <p className="lg-answer__disclaimer">{state.disclaimer}</p>
        </section>
      ) : null}
    </div>
  )
}
