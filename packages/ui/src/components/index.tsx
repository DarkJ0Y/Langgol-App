/**
 * P1 component set.
 *
 * Deliberately small: only what the authentication and role-selection screens need. Components
 * designed before their first real screen are guesses, and a large speculative library is
 * harder to change than no library at all.
 *
 * Every component is a plain server-renderable React element — no client hooks, no state — so
 * the authentication screens ship almost no JavaScript. That is a requirement on a 2G
 * connection, not an optimisation.
 *
 * Refs: docs/00_PRODUCT_VISION.md §9; docs/08_BANGLADESH_CONTEXT.md §3
 */

import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ChangeEventHandler,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

function classNames(...values: (string | false | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}

/* ------------------------------------------------------------------- button */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'secondary' | 'ghost' | undefined
  readonly loading?: boolean | undefined
  readonly children: ReactNode
}

export function Button({
  variant = 'primary',
  loading = false,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={classNames('lg-button', `lg-button--${variant}`, className)}
      disabled={disabled === true || loading}
      // Announced to assistive technology; the spinner alone is invisible to a screen reader.
      aria-busy={loading || undefined}
    >
      {loading ? <span className="lg-spinner" aria-hidden="true" /> : null}
      {loading ? ' ' : null}
      {children}
    </button>
  )
}

/**
 * A link styled as a button.
 *
 * Exists because `<a><button/></a>` is invalid HTML — React warns about it, screen readers
 * announce two nested interactive controls, and keyboard users get two tab stops for one action.
 * Navigation is a link; submission is a button. They are not interchangeable.
 */
export function LinkButton({
  href,
  variant = 'primary',
  children,
  ...rest
}: {
  readonly href: string
  readonly variant?: 'primary' | 'secondary' | 'ghost' | undefined
  readonly children: ReactNode
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a {...rest} href={href} className={classNames('lg-button', `lg-button--${variant}`)}>
      {children}
    </a>
  )
}

/* --------------------------------------------------------------------- card */

export function Card({ children }: { readonly children: ReactNode }) {
  return <div className="lg-card">{children}</div>
}

/* -------------------------------------------------------------------- alert */

export interface AlertProps {
  readonly tone: 'error' | 'warning' | 'success' | 'info'
  readonly title?: string | undefined
  readonly children: ReactNode
}

export function Alert({ tone, title, children }: AlertProps) {
  return (
    <div
      className={classNames('lg-alert', `lg-alert--${tone}`)}
      // Errors interrupt; everything else waits for a pause in speech.
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {title === undefined ? null : <strong>{title} </strong>}
      {children}
    </div>
  )
}

/* --------------------------------------------------------------- form field */

export interface FormFieldProps {
  readonly id: string
  readonly label: string
  readonly hint?: string | undefined
  readonly error?: string | undefined
  readonly children: (ids: { describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/**
 * Wires the label, hint and error to the control by id.
 *
 * A render prop rather than cloning children, so the association is explicit and a control can
 * never end up with a visible label that assistive technology cannot see.
 */
export function FormField({ id, label, hint, error, children }: FormFieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`
  const errorId = error === undefined ? undefined : `${id}-error`
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="lg-field">
      <label className="lg-label" htmlFor={id}>
        {label}
      </label>
      {hint === undefined ? null : (
        <span className="lg-hint" id={hintId}>
          {hint}
        </span>
      )}
      {children({ describedBy, invalid: error !== undefined })}
      {error === undefined ? null : (
        // Announced when it appears, without stealing focus from the control.
        <span className="lg-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------- input */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean | undefined
  readonly describedBy?: string | undefined
}

export function Input({ invalid, describedBy, className, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={classNames('lg-input', className)}
      aria-invalid={invalid === true || undefined}
      aria-describedby={describedBy}
    />
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean | undefined
  readonly describedBy?: string | undefined
}

/**
 * Several sentences rather than one line.
 *
 * Shares `.lg-input` so it sits in the same control family, with a minimum height instead of the
 * single-line one — an expert writing about their practice should not be typing into a slot.
 * `maxLength` is the caller's to set from the domain descriptor, so the browser stops them at the
 * same limit the server would.
 */
export function Textarea({ invalid, describedBy, className, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      className={classNames('lg-input', 'lg-textarea', className)}
      aria-invalid={invalid === true || undefined}
      aria-describedby={describedBy}
    />
  )
}

/**
 * Phone entry.
 *
 * `inputMode="numeric"` raises the numeric keypad on Android — fewer taps for a farmer typing
 * eleven digits. Normalisation happens on the SERVER; this input accepts whatever shape the
 * user types, including Bangla digits, because correcting people's typing is not its job.
 */
export function PhoneInput({ describedBy, invalid, ...rest }: InputProps) {
  return (
    <Input
      {...rest}
      type="tel"
      inputMode="numeric"
      autoComplete="tel"
      maxLength={20}
      describedBy={describedBy}
      invalid={invalid}
    />
  )
}

/**
 * One-time code entry.
 *
 * `autoComplete="one-time-code"` lets Android offer the code straight from the SMS, which for a
 * user reading slowly is the difference between a working login and an abandoned one.
 */
export function OtpInput({ describedBy, invalid, ...rest }: InputProps) {
  return (
    <Input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      pattern="[0-9]*"
      className="lg-input--code"
      describedBy={describedBy}
      invalid={invalid}
    />
  )
}

/* ------------------------------------------------------------------- select */

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly invalid?: boolean | undefined
  readonly describedBy?: string | undefined
  readonly children: ReactNode
}

export function Select({ invalid, describedBy, className, children, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      className={classNames('lg-input', className)}
      aria-invalid={invalid === true || undefined}
      aria-describedby={describedBy}
    >
      {children}
    </select>
  )
}

/* ------------------------------------------------------------------ choices */

export interface CheckboxProps {
  readonly name: string
  readonly value?: string | undefined
  readonly label: string
  readonly description?: string | undefined
  readonly defaultChecked?: boolean | undefined
}

/**
 * An independent yes/no the user can turn on AND off.
 *
 * Exists because `Choice` is a radio, and a radio alone in its group is a one-way switch: HTML
 * gives no way to clear it by clicking. Used for a consent toggle that would otherwise be
 * impossible to withdraw, which is exactly the bug that prompted this component.
 *
 * Shares `Choice`'s markup and classes on purpose — the two read as one control family, and the
 * difference the user feels is that this one lets go.
 */
export function Checkbox({ name, value, label, description, defaultChecked }: CheckboxProps) {
  return (
    <label className="lg-choice">
      <input type="checkbox" name={name} value={value ?? 'on'} defaultChecked={defaultChecked} />
      <span>
        <span className="lg-choice__label">{label}</span>
        {description === undefined ? null : (
          <span className="lg-choice__description">{description}</span>
        )}
      </span>
    </label>
  )
}

export interface ChoiceProps {
  readonly name: string
  readonly value: string
  readonly label: string
  readonly description?: string | undefined
  readonly defaultChecked?: boolean | undefined
  /**
   * Optional, and for revealing follow-up questions only.
   *
   * The input stays UNCONTROLLED — there is no `checked` prop — so the browser owns the answer
   * and the server reads what was submitted. A caller that mirrored this into state and drove
   * `checked` from it would be one stale render away from posting a different answer than the
   * one on screen.
   */
  readonly onChange?: ChangeEventHandler<HTMLInputElement> | undefined
}

/**
 * A large, tappable radio choice.
 *
 * A real `<input type="radio">` under a label rather than a styled `<div>`: keyboard navigation,
 * grouping and screen-reader semantics come free, and nothing here can get them wrong.
 */
/**
 * A radio: ONE answer from several, in a group sharing a `name`.
 *
 * Not the right control for an independent yes/no — a radio alone in its group can be checked
 * but never unchecked, because the only way to clear a radio is to select a sibling. Use
 * `Checkbox` for anything a user has to be able to turn back off.
 */
export function Choice({ name, value, label, description, defaultChecked, onChange }: ChoiceProps) {
  return (
    <label className="lg-choice">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        onChange={onChange}
      />
      <span>
        <span className="lg-choice__label">{label}</span>
        {description === undefined ? null : (
          <span className="lg-choice__description">{description}</span>
        )}
      </span>
    </label>
  )
}

/* ------------------------------------------------------------------ loading */

export function Loading({ label }: { readonly label: string }) {
  return (
    <p className="lg-row" role="status">
      <span className="lg-spinner" aria-hidden="true" />
      <span>{label}</span>
    </p>
  )
}

/* ----------------------------------------------------------- app furniture */

export interface LanguageSwitcherProps {
  readonly currentLocale: 'bn' | 'en'
  readonly otherLabel: string
  readonly action: string
  readonly returnTo: string
}

/**
 * Language switch as a form POST, not a client-side toggle.
 *
 * It works with JavaScript disabled or still downloading, which on a congested 2G connection is
 * a meaningful share of the time the page is on screen.
 */
export function LanguageSwitcher({
  currentLocale,
  otherLabel,
  action,
  returnTo,
}: LanguageSwitcherProps) {
  return (
    <form method="post" action={action}>
      <input type="hidden" name="locale" value={currentLocale === 'bn' ? 'en' : 'bn'} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" variant="ghost" lang={currentLocale === 'bn' ? 'en' : 'bn'}>
        {otherLabel}
      </Button>
    </form>
  )
}

/**
 * Development-mode indicator.
 *
 * Deliberately unmissable. A development session mistaken for a real one is how test data
 * reaches a report, and the cost of a loud stripe is far lower than that confusion.
 */
export function DevelopmentBanner({ message }: { readonly message: string }) {
  return (
    <div className="lg-dev-banner" role="status">
      {message}
    </div>
  )
}

export function SkipLink({ label }: { readonly label: string }) {
  return (
    <a className="lg-skip-link" href="#main">
      {label}
    </a>
  )
}
