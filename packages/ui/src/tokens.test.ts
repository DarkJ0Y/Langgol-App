import { describe, expect, it } from 'vitest'
import {
  colors,
  contrastRatio,
  meetsAA,
  semantic,
  semanticDark,
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
  })

  it('names a Bengali-capable face, after the Latin one', () => {
    /*
     * This replaces an assertion that the stack contained 'Bengali', which pinned an earlier
     * decision to carry both scripts in one family. The decision changed: Poppins sets Latin and
     * Hind Siliguri sets Bangla.
     *
     * The property worth pinning is not the family name but the ORDER, because the order is the
     * whole mechanism. Poppins has no Bengali glyphs, so Bengali codepoints fall through to the
     * next family in the list. Put the Bangla face first and it would win for Latin as well, and
     * the entire English side of the product would silently change face.
     */
    const stack = typography.fontFamily.sans
    const latin = stack.indexOf('--lg-font-latin')
    const bangla = stack.indexOf('--lg-font-bangla')

    expect(latin).toBeGreaterThanOrEqual(0)
    expect(bangla).toBeGreaterThan(latin)

    /*
     * Each var() carries a literal fallback. The stylesheet is loaded by a layout that defines
     * both variables, but an unresolved custom property invalidates the whole declaration at
     * computed-value time — the page would drop to the browser's serif default rather than to
     * the next family in the list.
     */
    expect(stack).toContain("var(--lg-font-latin, 'Poppins')")
    expect(stack).toContain("var(--lg-font-bangla, 'Hind Siliguri')")

    // And a generic still terminates the stack, for a client that has neither.
    expect(stack.endsWith('sans-serif')).toBe(true)
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

describe('the dark palette is held to the same bar, not eyeballed', () => {
  /*
   * A dark theme is where contrast bugs hide: light-on-dark "looks fine" at a desk and fails on a
   * phone at midday. These are the same assertions the light palette faces, run against the dark
   * aliases, so the second surface cannot quietly ship worse than the first.
   */
  it('meets AA for body text on every dark surface', () => {
    for (const surface of [
      semanticDark.background,
      semanticDark.surface,
      semanticDark.surfaceRaised,
    ]) {
      expect(contrastRatio(semanticDark.textPrimary, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(semanticDark.textSecondary, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('meets AA for text on dark action surfaces', () => {
    // The action fill is LIGHT on a dark ground, so its label must be dark. Getting this pair the
    // wrong way round is the single most common dark-theme mistake.
    expect(
      contrastRatio(semanticDark.textOnAction, semanticDark.actionPrimary),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrastRatio(semanticDark.textOnAction, semanticDark.actionPrimaryHover),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('meets the non-text threshold for dark borders and focus', () => {
    expect(
      contrastRatio(semanticDark.borderStrong, semanticDark.background),
    ).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(semanticDark.focusRing, semanticDark.background)).toBeGreaterThanOrEqual(3)
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
    // The dark surface must be emitted in both forms: an explicit choice and the system default.
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toContain(":root[data-theme='dark']")
    expect(css).toContain(`--lg-action-primary: ${semanticDark.actionPrimary};`)
  })

  it('exposes the whole token set as one object', () => {
    expect(Object.keys(tokens).sort()).toEqual(
      [
        'breakpoints',
        'colors',
        'motion',
        'radius',
        'semantic',
        'semanticDark',
        'shadow',
        'spacing',
        'touch',
        'typography',
      ].sort(),
    )
  })
})
