import { describe, expect, it } from 'vitest'
import {
  colors,
  contrastRatio,
  meetsAA,
  semantic,
  spacing,
  tokens,
  tokensToCssVariables,
  touch,
  typography,
  WCAG_AA_NON_TEXT,
} from './index.js'

describe('contrast maths', () => {
  it('matches the known reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('rejects a malformed colour rather than returning a plausible number', () => {
    expect(() => contrastRatio('not-a-colour', '#ffffff')).toThrow()
    expect(() => contrastRatio('#fff', '#ffffff')).toThrow()
  })
})

describe('the palette is accessible, and it is asserted rather than eyeballed', () => {
  it('meets AA for body text on every surface', () => {
    expect(meetsAA(semantic.textPrimary, semantic.background)).toBe(true)
    expect(meetsAA(semantic.textPrimary, semantic.surface)).toBe(true)
    expect(meetsAA(semantic.textSecondary, semantic.background)).toBe(true)
    expect(meetsAA(semantic.textSecondary, semantic.surface)).toBe(true)
  })

  it('meets AA for text on action surfaces', () => {
    expect(meetsAA(semantic.textOnAction, semantic.actionPrimary)).toBe(true)
    expect(meetsAA(semantic.textOnAction, semantic.actionPrimaryHover)).toBe(true)
    expect(meetsAA(semantic.textOnAction, semantic.actionSecondary)).toBe(true)
  })

  it('meets AA for status text on its own tint', () => {
    expect(meetsAA(colors.danger[700], colors.danger[100])).toBe(true)
    expect(meetsAA(colors.warning[700], colors.warning[100])).toBe(true)
    expect(meetsAA(colors.success[700], colors.success[100])).toBe(true)
    expect(meetsAA(colors.info[700], colors.info[100])).toBe(true)
  })

  it('meets the non-text threshold for borders and focus', () => {
    expect(contrastRatio(semantic.borderStrong, semantic.background)).toBeGreaterThanOrEqual(
      WCAG_AA_NON_TEXT,
    )
    expect(contrastRatio(semantic.focusRing, semantic.background)).toBeGreaterThanOrEqual(
      WCAG_AA_NON_TEXT,
    )
  })
})

describe('typography for Bangla', () => {
  it('loosens every line-height step relative to Latin', () => {
    // At Latin line-heights, Bangla matras and conjuncts collide. This is legibility, not taste.
    const { bangla, latin } = typography.lineHeight
    for (const step of ['tight', 'snug', 'normal', 'relaxed'] as const) {
      expect(bangla[step]).toBeGreaterThan(latin[step])
    }
  })

  it('never drops body text below 16px', () => {
    expect(typography.size.base).toBe('1rem')
    // One family carrying both scripts: per-script fallback mismatches heights mid-sentence.
    expect(typography.fontFamily.sans).toContain('Bengali')
  })
})

describe('touch targets', () => {
  it('exceeds the 44px floor, because the user may be standing in a field', () => {
    expect(Number.parseInt(touch.minTarget, 10)).toBeGreaterThanOrEqual(48)
    expect(Number.parseInt(touch.comfortableTarget, 10)).toBeGreaterThanOrEqual(
      Number.parseInt(touch.minTarget, 10),
    )
  })
})

describe('css generation', () => {
  it('emits custom properties from the same objects the code reads', () => {
    const css = tokensToCssVariables()
    expect(css).toContain(':root {')
    expect(css).toContain(`--lg-action-primary: ${semantic.actionPrimary};`)
    expect(css).toContain(`--lg-space-4: ${spacing[4]};`)
    expect(css).toContain('--lg-leading-bn-normal:')
    expect(css).toContain(`--lg-touch-min: ${touch.minTarget};`)
    expect(css.trimEnd().endsWith('}')).toBe(true)
  })

  it('exposes the whole token set as one object', () => {
    expect(Object.keys(tokens).sort()).toEqual(
      [
        'breakpoints',
        'colors',
        'motion',
        'radius',
        'semantic',
        'shadow',
        'spacing',
        'touch',
        'typography',
      ].sort(),
    )
  })
})
