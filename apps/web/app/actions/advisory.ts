'use server'

/**
 * Ask the crop assistant.
 *
 * Everything that matters is in `diagnoseCropDisease`: the FARMER check, AI consent, the photo
 * checks, the spend guard, the audit trail and the disclaimer. This action only turns the form
 * into a command and the result into something the form can show. The photograph's bytes go to
 * the provider and are not kept — not here, not in the diagnoses table.
 */

import { revalidatePath } from 'next/cache'
import { diagnoseCropDisease } from '@langgol/application'
import { isErr } from '@langgol/shared'
import { advisoryDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import type { AssistantState } from '../assistant/state'

export async function askAssistantAction(
  _previous: AssistantState,
  formData: FormData,
): Promise<AssistantState> {
  const photo = formData.get('photo')
  if (!(photo instanceof File) || photo.size === 0) {
    return { status: 'error', error: 'photo' }
  }

  const question = formData.get('question')
  const crop = formData.get('crop')
  // The crop, when chosen, goes in front of the farmer's words: models (and the demo script)
  // answer better knowing whether it is rice or tomatoes.
  const words = [
    typeof crop === 'string' && crop !== '' ? `${crop}:` : '',
    typeof question === 'string' ? question : '',
  ]
    .join(' ')
    .trim()

  const result = await diagnoseCropDisease(
    await currentActor(),
    {
      image: new Uint8Array(await photo.arrayBuffer()),
      contentType: photo.type,
      locale: await getLocale(),
      question: words === '' ? undefined : words,
    },
    await advisoryDeps(),
  )

  if (isErr(result)) {
    const code = result.error.code
    const field = result.error.meta['code']
    if (code === 'VALIDATION_FAILED') {
      if (field === 'IMAGE_TOO_LARGE') return { status: 'error', error: 'photoTooLarge' }
      if (field === 'IMAGE_UNSUPPORTED_TYPE') return { status: 'error', error: 'photoType' }
      return { status: 'error', error: 'photo' }
    }
    if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED')
      return { status: 'error', error: 'consent' }
    if (code === 'RATE_LIMITED') return { status: 'error', error: 'limit' }
    if (code === 'PROVIDER_UNAVAILABLE') return { status: 'error', error: 'unavailable' }
    return { status: 'error', error: 'unexpected' }
  }

  // The history beside the form is read on the server; refresh it so this answer appears there.
  revalidatePath('/assistant')

  return {
    status: 'done',
    answer: result.value.diagnosis.answer,
    confidence: result.value.diagnosis.confidence,
    unusableImage: result.value.diagnosis.unusableImage,
    disclaimer: result.value.disclaimer,
  }
}
