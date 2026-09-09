import { LinkButton } from '@langgol/ui/components'
import type { OnboardingView } from '@langgol/application'
import type { MessageKey, Translator } from '@langgol/i18n'

/**
 * The onboarding checklist, as a dashboard puts it.
 *
 * A server component with no client JavaScript: it renders three lists and a native `<progress>`.
 * That matters more here than anywhere else in the app, because this is the first thing a new user
 * on a metered 2G connection sees, and a progress widget that costs them data to download is a
 * poor first impression.
 *
 * ## What it deliberately does not do
 *
 * It does not block anything, hide anything behind a completion threshold, or nag. Outstanding
 * steps are offered with the reason they are worth doing; the "optional" list is labelled as
 * skippable in so many words. A checklist that a person cannot dismiss and cannot ignore is a
 * wizard wearing a different hat.
 *
 * ## Save-and-continue
 *
 * Each step is a link to the ordinary form that owns it, and every one of those forms saves on its
 * own. There is no draft held anywhere and no wizard to lose it, so somebody who fills in two
 * fields and loses their connection has saved two fields — and comes back to a checklist that
 * already reflects them.
 *
 * The links carry no return parameter. One was written and removed: nothing on the receiving end
 * read it, so it would have been a promise the code did not keep. Returning here is the back
 * button, or the setup link on the account page, both of which work today.
 */

const stepLabelKey = (step: string): MessageKey => {
  const pascal = step
    .split('_')
    .map((part) => `${part.charAt(0)}${part.slice(1).toLowerCase()}`)
    .join('')
  return `onboarding.step${pascal}` as MessageKey
}

export function OnboardingChecklist({
  view,
  t,
  showCompleted = true,
}: {
  readonly view: OnboardingView
  readonly t: Translator
  /** A compact dashboard card wants the outstanding work only. */
  readonly showCompleted?: boolean
}) {
  const { completion, prompts } = view

  return (
    <div className="lg-stack">
      <div className="lg-stack-tight">
        <strong>{t.t('onboarding.completionLabel')}</strong>
        {/*
         * A native <progress>, so the value is announced to a screen reader rather than being a
         * coloured div that means nothing without sight.
         */}
        <progress value={completion.percent} max={100} className="lg-progress" />
        <span className="lg-subtitle">
          {t.t('onboarding.completionValue', { percent: completion.percent })}
        </span>
      </div>

      {/*
       * Said as early as it is true. Somebody with the three required steps done is genuinely able
       * to use everything, and a dashboard that only showed them a part-filled bar would imply
       * otherwise.
       */}
      {completion.complete ? (
        <p className="lg-subtitle">{t.t('onboarding.allDone')}</p>
      ) : completion.readyToUse ? (
        <p className="lg-subtitle">{t.t('onboarding.readyToUse')}</p>
      ) : null}

      {/*
       * The contextual prompts: at most three, each naming what it unlocks rather than what is
       * missing. "Add your farm to receive crop advice for your own area" and "your profile is 40%
       * complete" are the same fact and completely different messages.
       */}
      {prompts.length === 0 ? null : (
        <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {prompts.map((prompt) => (
            <li key={prompt.step} className="lg-stack-tight">
              <p>{t.t(prompt.messageKey as MessageKey)}</p>
              <LinkButton href={prompt.href} variant="secondary">
                {t.t(stepLabelKey(prompt.step))}
              </LinkButton>
            </li>
          ))}
        </ul>
      )}

      {completion.recommended.length === 0 ? null : (
        <div className="lg-stack-tight">
          <strong>{t.t('onboarding.recommendedTitle')}</strong>
          <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {completion.recommended.map((step) => (
              <li key={step.step}>
                <a href={step.href}>{t.t(stepLabelKey(step.step))}</a>
                <span className="lg-subtitle">
                  {' · '}
                  {t.t(`onboarding.tier${step.tier}` as MessageKey)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {completion.optional.length === 0 ? null : (
        <div className="lg-stack-tight">
          <strong>{t.t('onboarding.optionalTitle')}</strong>
          {/* Said in words, not implied by ordering. These can be skipped and nothing breaks. */}
          <p className="lg-hint">{t.t('onboarding.optionalNote')}</p>
          <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {completion.optional.map((step) => (
              <li key={step.step}>
                <a href={step.href}>{t.t(stepLabelKey(step.step))}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showCompleted && completion.completed.length > 0 ? (
        <div className="lg-stack-tight">
          <strong>{t.t('onboarding.completedTitle')}</strong>
          <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {completion.completed.map((step) => (
              <li key={step.step} className="lg-subtitle">
                {t.t(stepLabelKey(step.step))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
