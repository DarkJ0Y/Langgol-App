/**
 * WCAG contrast maths.
 *
 * Present so the palette can be *asserted* rather than eyeballed. Accessibility checked by a
 * designer squinting at a screen is accessibility that regresses on the next colour tweak — and
 * the target user is reading Bangla on a cheap screen in direct sunlight.
 *
 * Refs: docs/01_MVP_REQUIREMENTS.md §8; docs/00_PRODUCT_VISION.md §9
 */

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

export function hexToRgb(hex: string): Rgb {
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Not a six-digit hex colour: ${hex}`)
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function channelLuminance(value: number): number {
  const scaled = value / 255
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  )
}

/** Contrast ratio between two hex colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(hexToRgb(foreground))
  const b = relativeLuminance(hexToRgb(background))
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

export const WCAG_AA_BODY = 4.5
export const WCAG_AA_LARGE = 3
export const WCAG_AA_NON_TEXT = 3

export function meetsAA(foreground: string, background: string, large = false): boolean {
  return contrastRatio(foreground, background) >= (large ? WCAG_AA_LARGE : WCAG_AA_BODY)
}
