/**
 * The assistant form's result shape. Outside the `'use server'` module, which may export only
 * async functions.
 */

export type AssistantError =
  'photo' | 'photoTooLarge' | 'photoType' | 'consent' | 'limit' | 'unavailable' | 'unexpected'

export type AssistantState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly error: AssistantError }
  | {
      readonly status: 'done'
      readonly answer: string
      readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH'
      readonly unusableImage: boolean
      readonly disclaimer: string
    }

export const idleAssistantState: AssistantState = { status: 'idle' }
