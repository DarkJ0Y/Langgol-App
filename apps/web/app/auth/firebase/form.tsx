'use client'

/**
 * Firebase phone sign-in, in the browser.
 *
 * The only client component in the authentication flow, and it exists because Firebase phone auth
 * cannot be driven from a server: the reCAPTCHA challenge and the SMS exchange both happen in the
 * page. Everything it produces is a token, and a token is worth nothing until the server has
 * verified it against this project.
 *
 * ## What this component is NOT trusted for
 *
 * It does not decide who you are. It does not decide your roles. It cannot create a session. It
 * posts an ID token to a server action, and the server does all three — the same use case, the
 * same allowlist and the same audit line as every other sign-in.
 *
 * ## Why the SDK is imported lazily
 *
 * The Firebase auth bundle is large and the product's rule is that farmers on 2G do not pay for
 * code they are not using. A dynamic import keeps it out of the shared chunk, so it is fetched
 * when somebody actually opens this screen and never on the homepage.
 */

import { useActionState, useEffect, useRef, useState } from 'react'
import { Alert, Button, Choice, Input } from '@langgol/ui/components'
import { firebaseSignInAction } from '@/app/actions/auth'
import { idleActionState } from '@/app/actions/state'

export interface FirebaseClientConfig {
  readonly apiKey: string
  readonly authDomain: string
  readonly projectId: string
}

export interface FirebaseFormLabels {
  readonly phone: string
  readonly phoneHelp: string
  readonly phonePlaceholder: string
  readonly code: string
  readonly fullName: string
  readonly role: string
  readonly sendCode: string
  readonly verify: string
  readonly loading: string
}

type Stage = 'phone' | 'code'

/**
 * The confirmation handle Firebase returns after sending a code.
 *
 * Typed structurally rather than imported, so this module has no build-time dependency on the
 * Firebase types — the SDK arrives through a dynamic import at runtime.
 */
interface ConfirmationLike {
  confirm(code: string): Promise<{ user: { getIdToken(): Promise<string> } }>
}

export function FirebasePhoneForm({
  config,
  locale,
  roles,
  labels,
}: {
  config: FirebaseClientConfig
  locale: 'bn' | 'en'
  roles: readonly { value: string; label: string }[]
  labels: FirebaseFormLabels
}) {
  const [state, formAction, pending] = useActionState(firebaseSignInAction, idleActionState)

  const [stage, setStage] = useState<Stage>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [idToken, setIdToken] = useState('')

  // Only meaningful for an account that does not exist yet. The server ignores both when it finds
  // one, so a returning farmer's stored roles are never touched by what is typed here.
  const [newFullName, setNewFullName] = useState('')
  const [newRole, setNewRole] = useState(roles[0]?.value ?? '')

  const confirmation = useRef<ConfirmationLike | null>(null)
  const recaptchaHost = useRef<HTMLDivElement | null>(null)
  const submitRef = useRef<HTMLFormElement | null>(null)

  /*
   * Once the token is in state, submit the real form.
   *
   * Done in an effect rather than inline so that React has committed the hidden input's value
   * before the action reads the FormData. Submitting in the same tick posts the previous value,
   * which is an empty string on the first attempt.
   */
  useEffect(() => {
    if (idToken !== '') submitRef.current?.requestSubmit()
  }, [idToken])

  const failed = (bn: string, en: string): void => {
    setProblem(locale === 'bn' ? bn : en)
    setBusy(false)
  }

  async function sendCode(): Promise<void> {
    setProblem(null)
    setBusy(true)

    try {
      const [{ initializeApp, getApps }, auth] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
      ])

      // Reuse the app if this component has already initialised one. A second `initializeApp`
      // with the same name throws, which would break a retry after a mistyped number.
      const app = getApps()[0] ?? initializeApp(config)

      const instance = auth.getAuth(app)
      // The code arrives in the reader's language rather than English by default.
      instance.languageCode = locale

      /*
       * An invisible reCAPTCHA. Firebase requires one for phone sign-in; it is its abuse control,
       * not ours, and it is the reason this flow cannot run on the server.
       */
      const verifier = new auth.RecaptchaVerifier(instance, recaptchaHost.current ?? 'recaptcha', {
        size: 'invisible',
      })

      confirmation.current = (await auth.signInWithPhoneNumber(
        instance,
        phone,
        verifier,
      )) as unknown as ConfirmationLike

      setStage('code')
      setBusy(false)
    } catch {
      // Deliberately not the SDK's message: those name internal error codes and occasionally the
      // number itself, neither of which helps the person holding the phone.
      failed(
        'কোড পাঠানো গেল না। নম্বরটি দেখে আবার চেষ্টা করুন।',
        'We could not send a code. Check the number and try again.',
      )
    }
  }

  async function confirmCode(): Promise<void> {
    setProblem(null)
    setBusy(true)

    const pendingConfirmation = confirmation.current
    if (pendingConfirmation === null) {
      failed('আবার শুরু করুন।', 'Start again.')
      setStage('phone')
      return
    }

    try {
      const credential = await pendingConfirmation.confirm(code)
      // Handed straight to the server. Never stored, never put in a URL.
      setIdToken(await credential.user.getIdToken())
    } catch {
      failed('কোডটি মিলল না।', 'That code did not match.')
    }
  }

  return (
    <div className="lg-stack">
      {problem !== null ? <Alert tone="error">{problem}</Alert> : null}
      {state.status === 'error' ? (
        <Alert tone="error">
          {locale === 'bn' ? 'প্রবেশ করা গেল না।' : 'That sign-in could not be completed.'}
        </Alert>
      ) : null}

      {stage === 'phone' ? (
        <div className="lg-stack">
          <div className="lg-field">
            <label className="lg-label" htmlFor="fb-phone">
              {labels.phone}
            </label>
            <span className="lg-hint">{labels.phoneHelp}</span>
            <Input
              id="fb-phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder={labels.phonePlaceholder}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>

          <Button
            type="button"
            loading={busy || pending}
            onClick={() => {
              void sendCode()
            }}
          >
            {busy || pending ? labels.loading : labels.sendCode}
          </Button>
        </div>
      ) : (
        <div className="lg-stack">
          <div className="lg-field">
            <label className="lg-label" htmlFor="fb-code">
              {labels.code}
            </label>
            <Input
              id="fb-code"
              name="code"
              className="lg-input lg-input--code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>

          <Button
            type="button"
            loading={busy || pending}
            onClick={() => {
              void confirmCode()
            }}
          >
            {busy || pending ? labels.loading : labels.verify}
          </Button>
        </div>
      )}

      {stage === 'code' ? (
        <details className="lg-stack-tight">
          <summary>{locale === 'bn' ? 'নতুন অ্যাকাউন্ট?' : 'New account?'}</summary>
          <div className="lg-field">
            <label className="lg-label" htmlFor="fb-name">
              {labels.fullName}
            </label>
            <Input
              id="fb-name"
              maxLength={120}
              value={newFullName}
              onChange={(event) => setNewFullName(event.target.value)}
            />
          </div>
          <fieldset className="lg-stack-tight" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="lg-label">{labels.role}</legend>
            {/*
             * Uncontrolled, with the choice mirrored into state on change.
             *
             * `Choice` has no `checked` prop on purpose — the browser owns the answer, so a stale
             * render cannot post something other than what is on screen. The mirror exists only
             * because the value has to reach the hidden form below.
             */}
            {roles.map((role, index) => (
              <Choice
                key={role.value}
                name="fb-role"
                value={role.value}
                label={role.label}
                defaultChecked={index === 0}
                onChange={() => setNewRole(role.value)}
              />
            ))}
          </fieldset>
        </details>
      ) : null}

      {/*
       * The form actually posted to the server.
       *
       * Its three inputs are driven from state rather than read out of the DOM, so the values are
       * whatever React last rendered and the component still renders on the server, where there is
       * no document to query.
       */}
      <form ref={submitRef} action={formAction} hidden>
        <input type="hidden" name="idToken" value={idToken} readOnly />
        <input type="hidden" name="fullName" value={newFullName.trim()} readOnly />
        <input type="hidden" name="role" value={newRole} readOnly />
      </form>

      {/* reCAPTCHA mounts here. Empty and invisible until Firebase uses it. */}
      <div ref={recaptchaHost} id="recaptcha" />
    </div>
  )
}
