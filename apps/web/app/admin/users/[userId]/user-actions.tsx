'use client'

/**
 * Suspension and permission controls for one user.
 *
 * Both forms demand a reason, and both are refused server-side without one. The reason box is
 * always visible rather than appearing after a choice is made — a field that appears on demand is
 * a field somebody fills in after they have already decided.
 *
 * Nothing here is a security control. The whole component is hidden from an operator who lacks the
 * permission, and every submission is checked again in the action and again in the use case.
 */

import { useActionState } from 'react'
import { Alert, Button, FormField, Textarea } from '@langgol/ui/components'
import { permissionAction, suspendAction } from '../actions'
import { idleAdminState } from '../state'

export interface PermissionOption {
  readonly value: string
  readonly label: string
}

export interface UserActionLabels {
  readonly suspendTitle: string
  readonly restoreTitle: string
  readonly reasonLabel: string
  readonly reasonHint: string
  readonly suspend: string
  readonly restore: string
  readonly permissionsTitle: string
  readonly permissionsHint: string
  readonly grant: string
  readonly revoke: string
  readonly granted: string
  readonly notGranted: string
  readonly loading: string
  readonly saved: string
  readonly messages: Readonly<Record<string, string>>
  readonly errorUnexpected: string
}

function useMessage(
  state: { status: string; errorKey?: string | undefined },
  labels: UserActionLabels,
): string | null {
  if (state.status !== 'error') return null
  return labels.messages[state.errorKey ?? ''] ?? labels.errorUnexpected
}

export function UserActions({
  userId,
  suspended,
  maySuspend,
  mayManagePermissions,
  held,
  allPermissions,
  labels,
}: {
  readonly userId: string
  readonly suspended: boolean
  readonly maySuspend: boolean
  readonly mayManagePermissions: boolean
  readonly held: readonly string[]
  readonly allPermissions: readonly PermissionOption[]
  readonly labels: UserActionLabels
}) {
  const [suspendState, suspendForm, suspendPending] = useActionState(suspendAction, idleAdminState)
  const [permissionState, permissionForm, permissionPending] = useActionState(
    permissionAction,
    idleAdminState,
  )

  const suspendError = useMessage(suspendState, labels)
  const permissionError = useMessage(permissionState, labels)

  return (
    <>
      {maySuspend ? (
        <div className="lg-card lg-stack">
          <h2 className="lg-title">{suspended ? labels.restoreTitle : labels.suspendTitle}</h2>

          {suspendState.status === 'ok' ? <Alert tone="success">{labels.saved}</Alert> : null}
          {suspendError === null ? null : <Alert tone="error">{suspendError}</Alert>}

          <form action={suspendForm} className="lg-stack-tight">
            <input type="hidden" name="userId" value={userId} />
            {/* The direction travels with the form, so a stale page cannot suspend when it meant
                to restore. */}
            <input type="hidden" name="restore" value={suspended ? 'true' : 'false'} />

            <FormField id="suspend-reason" label={labels.reasonLabel} hint={labels.reasonHint}>
              {({ describedBy, invalid }) => (
                <Textarea
                  id="suspend-reason"
                  name="reason"
                  rows={2}
                  maxLength={500}
                  describedBy={describedBy}
                  invalid={invalid}
                />
              )}
            </FormField>

            <Button type="submit" disabled={suspendPending} variant="secondary">
              {suspendPending ? labels.loading : suspended ? labels.restore : labels.suspend}
            </Button>
          </form>
        </div>
      ) : null}

      {mayManagePermissions ? (
        <div className="lg-card lg-stack">
          <h2 className="lg-title">{labels.permissionsTitle}</h2>
          <p className="lg-hint">{labels.permissionsHint}</p>

          {permissionState.status === 'ok' ? <Alert tone="success">{labels.saved}</Alert> : null}
          {permissionError === null ? null : <Alert tone="error">{permissionError}</Alert>}

          <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {allPermissions.map((permission) => {
              const isHeld = held.includes(permission.value)
              return (
                <li key={permission.value}>
                  <form action={permissionForm} className="lg-row">
                    <input type="hidden" name="userId" value={userId} />
                    <input type="hidden" name="permission" value={permission.value} />
                    <input type="hidden" name="revoke" value={isHeld ? 'true' : 'false'} />
                    {/*
                     * A revocation needs a reason and a grant does not, so one is supplied. The
                     * server checks it regardless — this is a default, not a bypass.
                     */}
                    <input
                      type="hidden"
                      name="reason"
                      value="Permission no longer required for this role"
                    />

                    <span>
                      {permission.label}
                      {' · '}
                      {isHeld ? labels.granted : labels.notGranted}
                    </span>

                    <Button type="submit" disabled={permissionPending} variant="ghost">
                      {isHeld ? labels.revoke : labels.grant}
                    </Button>
                  </form>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </>
  )
}
