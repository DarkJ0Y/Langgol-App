'use client'

import { useEffect, useState } from 'react'
import { FormField, Select } from '@langgol/ui/components'
import { listAreasAction } from './actions'

export interface AreaOption {
  readonly id: string
  readonly name: string
}

export interface AreaPickerLabels {
  readonly division: string
  readonly district: string
  readonly upazila: string
  readonly union: string
  readonly choose: string
  readonly optional: string
}

interface Level {
  readonly key: 'DIVISION' | 'DISTRICT' | 'UPAZILA' | 'UNION'
  readonly options: readonly AreaOption[]
  readonly selected: string
}

const ORDER = ['DIVISION', 'DISTRICT', 'UPAZILA', 'UNION'] as const

/**
 * The hierarchical area picker.
 *
 * This is the PRIMARY way to give a location, not a fallback for when a map fails to load. Map
 * literacy varies and many rural addresses have no street address at all, so choosing
 * division → district → upazila has to be a complete path on its own — which is why the union
 * step is explicitly optional and the form can be submitted without it.
 *
 * One level is fetched at a time. There are roughly 4,500 unions; shipping them so somebody can
 * pick one is a payload nobody on a metered connection should be asked to pay for.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §2
 */
export function AreaPicker({
  labels,
  locale,
  initialPath,
  onChange,
}: {
  labels: AreaPickerLabels
  /** Area names come back in both languages; the reader's choice decides which is shown. */
  locale: 'bn' | 'en'
  /** Root-to-leaf ids of a saved address, so editing starts where the user left off. */
  initialPath?: readonly AreaOption[]
  onChange: (areaId: string) => void
}) {
  const [levels, setLevels] = useState<readonly Level[]>([])
  const [loading, setLoading] = useState(false)

  // Load the divisions once, then whatever the saved address already selected.
  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      setLoading(true)
      const chain: Level[] = []
      let parentId: string | null = null

      for (let depth = 0; depth < ORDER.length; depth += 1) {
        const response = await listAreasAction(parentId)
        if (cancelled) return
        if (!response.ok || response.areas.length === 0) break

        const key = ORDER[depth]
        if (key === undefined) break

        const selected = initialPath?.[depth]?.id ?? ''
        chain.push({
          key,
          options: response.areas.map((area) => ({
            id: area.id,
            name: locale === 'bn' ? area.nameBn : area.nameEn,
          })),
          selected,
        })

        if (selected === '') break
        parentId = selected
      }

      if (!cancelled) {
        setLevels(chain)
        setLoading(false)
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
    /*
     * Deliberately empty. This runs once, on mount: `initialPath` is a fresh array on every
     * render of the parent, so depending on it would refetch the whole chain on every keystroke
     * elsewhere in the form — on a metered connection, once per letter typed.
     */
  }, [])

  async function choose(depth: number, areaId: string) {
    // Everything below the changed level is now wrong — a district under the old division.
    const kept = levels
      .slice(0, depth + 1)
      .map((level, index) => (index === depth ? { ...level, selected: areaId } : level))
    setLevels(kept)

    // The deepest selected area is the address, so it changes on every selection — including a
    // clear, which walks the address back up to the parent level.
    onChange(areaId === '' ? (kept[depth - 1]?.selected ?? '') : areaId)

    if (areaId === '') return

    setLoading(true)
    const response = await listAreasAction(areaId)
    setLoading(false)
    if (!response.ok || response.areas.length === 0) return

    const nextKey = ORDER[depth + 1]
    if (nextKey === undefined) return

    setLevels([
      ...kept,
      {
        key: nextKey,
        options: response.areas.map((area) => ({
          id: area.id,
          name: locale === 'bn' ? area.nameBn : area.nameEn,
        })),
        selected: '',
      },
    ])
  }

  const labelFor: Record<Level['key'], string> = {
    DIVISION: labels.division,
    DISTRICT: labels.district,
    UPAZILA: labels.upazila,
    UNION: labels.union,
  }

  return (
    <>
      {levels.map((level, depth) => (
        <FormField
          key={level.key}
          id={`area-${level.key}`}
          label={labelFor[level.key]}
          // Union is genuinely optional: coverage is incomplete and a buyer who does not know
          // theirs must still be able to finish.
          {...(level.key === 'UNION' ? { hint: labels.optional } : {})}
        >
          {({ describedBy }) => (
            <Select
              id={`area-${level.key}`}
              value={level.selected}
              disabled={loading}
              describedBy={describedBy}
              onChange={(event) => void choose(depth, event.target.value)}
            >
              <option value="">{labels.choose}</option>
              {level.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      ))}
    </>
  )
}
