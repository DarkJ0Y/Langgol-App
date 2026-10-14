/**
 * Langgol design tokens.
 *
 * The brand must read as **trustworthy · agricultural · human · premium · accessible ·
 * practical**, and must not read as a generic green e-commerce template. Concretely that means:
 * a restrained palette anchored on cultivated earth and leaf rather than supermarket green, one
 * accent used sparingly, strong type, generous space, and no decorative gradient or animation.
 *
 * Every value here is judged against one user: someone holding a ৳9,000 Android phone in
 * sunlight, reading Bangla slowly, on a connection that may drop.
 *
 * Refs: docs/00_PRODUCT_VISION.md §9; docs/08_BANGLADESH_CONTEXT.md §1, §3
 */

/* ------------------------------------------------------------------------ colour */

/**
 * Palette.
 *
 * Every foreground/background pair used for text is checked in the token tests against WCAG 2.2
 * AA (4.5:1 for body, 3:1 for large text and UI boundaries). Outdoor sunlight readability is why
 * the neutral scale is cool and high-contrast rather than soft grey.
 */
export const colors = {
  // Cultivated earth — the primary brand anchor. Deeper and browner than "agri green".
  soil: {
    50: '#f6f4f0',
    100: '#e8e3da',
    200: '#d2c8b6',
    300: '#b5a68c',
    400: '#96846a',
    500: '#7a6a52',
    600: '#5f5240',
    700: '#483e31',
    800: '#332c23',
    900: '#211d17',
  },
  // Leaf — used for action and growth, never as a full-bleed background.
  leaf: {
    50: '#f0f7f0',
    100: '#dbecdb',
    200: '#b5d8b6',
    300: '#84bd87',
    400: '#559d5a',
    500: '#357f3c',
    600: '#26652d',
    700: '#1e5024',
    800: '#193f1e',
    900: '#132f17',
  },
  // Harvest — a single warm accent, used sparingly for emphasis and value.
  harvest: {
    50: '#fdf6ec',
    100: '#f8e6c8',
    200: '#f0cb90',
    300: '#e5ac55',
    400: '#d18f2a',
    500: '#ad731d',
    600: '#8a5a17',
    700: '#6b4513',
    800: '#4c3110',
    900: '#31200b',
  },
  neutral: {
    0: '#ffffff',
    50: '#f8f9fa',
    100: '#eef0f2',
    200: '#dde1e5',
    300: '#c2c8cf',
    400: '#98a1ab',
    500: '#6f7982',
    600: '#525b63',
    700: '#3c444b',
    800: '#262c31',
    900: '#14181b',
  },
  // Status colours are deliberately unsaturated — an alarming red on a farmer's earnings screen
  // reads as "you have lost money" rather than "check this field".
  danger: { 100: '#fbe6e4', 500: '#b3261e', 700: '#8c1d17' },
  warning: { 100: '#fdf1d8', 500: '#8a5a17', 700: '#6b4513' },
  success: { 100: '#dbecdb', 500: '#26652d', 700: '#1e5024' },
  info: { 100: '#dfe9f5', 500: '#215a91', 700: '#194671' },
} as const

/** Semantic aliases. Components reference these, never a raw palette step. */
export const semantic = {
  /*
   * A neutral black-and-white base with ONE accent, the way the strongest product sites are
   * built: the interface recedes and the produce, the prices and the one green action carry the
   * page. Bright mode is white paper and black ink.
   */
  background: '#ffffff',
  surface: '#f6f6f6',
  surfaceRaised: '#ffffff',
  border: '#e2e2e2',
  // 4.5:1 on white — comfortably over the 3:1 non-text threshold the token test asserts.
  borderStrong: '#767676',

  textPrimary: '#000000',
  textSecondary: '#545454',
  textInverse: '#ffffff',
  // On a light surface only. Contrast is asserted in the token tests.
  textOnAction: '#ffffff',

  // Green as TEXT on white must be deep to read (5:1); the light-green FILL lives in ui.css.
  actionPrimary: '#15803d',
  actionPrimaryHover: '#166534',
  actionSecondary: '#333333',
  accent: colors.harvest[600],

  focusRing: colors.info[500],
} as const

/**
 * Dark semantic aliases.
 *
 * A deliberate second surface, not an inversion. Two things drove it:
 *
 *  - Langgol is used outdoors, and a farmer checking an order at dusk or before dawn is reading a
 *    phone at full brightness. A near-black ground is easier on the eye and cheaper on an OLED
 *    battery than a white one.
 *  - The buyer-facing screens are dense with figures — a delivered-cost breakdown is a table of
 *    money. Dark surfaces with a single accent let the numbers carry the emphasis instead of
 *    competing with decoration.
 *
 * The ground is `soil-900` rather than pure black: the palette is warm, and #000 against warm
 * greys reads as a hole rather than a surface. The accent stays in the leaf family, because green
 * is what this product is about and borrowing a fashionable colour would say nothing.
 *
 * Every pair here is asserted against WCAG 2.2 AA in the token tests, exactly as the light set is.
 * A dark theme that is merely "eyeballed to look nice" is how contrast bugs ship.
 */
export const semanticDark = {
  // Dark, the default: true black ground, near-black cards, white ink.
  background: '#000000',
  surface: '#0d0d0d',
  surfaceRaised: '#161616',
  border: '#2a2a2a',
  borderStrong: '#8a8a8a',

  textPrimary: '#ffffff',
  textSecondary: '#a6a6a6',
  textInverse: '#000000',
  // Dark ground needs a LIGHT action fill, so the label on it must be dark — the inverse of the
  // light theme, and the reason this is a separate token rather than a reused one.
  textOnAction: '#052e16',

  actionPrimary: '#86efac',
  actionPrimaryHover: '#4ade80',
  actionSecondary: '#e5e5e5',
  accent: colors.harvest[300],

  focusRing: '#86efac',
} as const

/* -------------------------------------------------------------------- typography */

/**
 * Type.
 *
 * Bangla glyphs are taller and carry more vertical detail than Latin, so the Bangla line-height
 * is deliberately looser at every step: at Latin's line-height, conjuncts and matras collide.
 *
 * ## Two families, and why the order is the mechanism
 *
 * Inter sets Latin, Hind Siliguri sets Bangla. (Inter replaced Poppins: a neutral grotesk reads
 * as a working tool where Poppins read as a poster, and its figures sit evenly in prices and
 * tables.) This note previously asked for ONE family
 * covering both scripts, on the grounds that per-script fallback produces mismatched heights
 * mid-sentence. That concern is real and the pairing answers it directly rather than by avoiding
 * it: the two were chosen to agree on x-height and stroke weight, and the Bangla line-height
 * tokens below already carry the rest of the difference. No Latin sans covers Bengali at Inter's
 * quality, so a single family would have meant giving up one script or the other.
 *
 * The ORDER does the work. Inter contains no Bengali glyphs at all, so the browser falls
 * through per glyph to Hind Siliguri for Bengali codepoints and keeps Inter for Latin. A
 * sentence mixing both sets each script in its own face with no `:lang()` rule anywhere, which
 * matters because language is not the same thing as script — an English product name inside a
 * Bangla sentence should still be Inter.
 *
 * Both are self-hosted by `next/font` in `apps/web/app/layout.tsx`, which is what defines the two
 * variables. That indirection is why each `var()` carries a literal fallback: if the stylesheet
 * is ever loaded without that layout, an unresolved custom property would invalidate the whole
 * declaration and drop the page to a serif default.
 *
 * Self-hosting is not a preference here. The Content-Security-Policy sets `font-src 'self'`, so
 * a Google Fonts URL is blocked outright — silently, with no error and no text.
 */
export const typography = {
  fontFamily: {
    sans: "var(--lg-font-latin, 'Inter'), var(--lg-font-bangla, 'Hind Siliguri'), system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'Noto Sans Mono', ui-monospace, 'Cascadia Mono', monospace",
  },

  /** Minimum 16px body: smaller text plus Bangla conjuncts is unreadable in sunlight. */
  size: {
    xs: '0.8125rem',
    sm: '0.9375rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.375rem',
    '2xl': '1.75rem',
    '3xl': '2.25rem',
  },

  lineHeight: {
    latin: { tight: 1.2, snug: 1.35, normal: 1.5, relaxed: 1.65 },
    /** Looser at every step. This is not a preference — it is legibility. */
    bangla: { tight: 1.4, snug: 1.55, normal: 1.75, relaxed: 1.9 },
  },

  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const

/* ------------------------------------------------------------- space and shape */

/** 4px base. Generous by default — cramped UI reads as cheap, and the brand must read premium. */
export const spacing = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
} as const

export const radius = {
  none: '0',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  full: '9999px',
} as const

/**
 * Elevation is used sparingly. Depth is carried by space and border first; a page of floating
 * cards reads as a template.
 */
export const shadow = {
  none: 'none',
  sm: '0 1px 2px rgba(20, 24, 27, 0.06)',
  md: '0 2px 8px rgba(20, 24, 27, 0.08)',
} as const

/**
 * Touch targets.
 *
 * 48px minimum, not the 44px floor. The target user has a cracked screen protector, possibly wet
 * or soil-covered hands, and is often standing in a field. Four extra pixels cost nothing.
 */
export const touch = {
  minTarget: '48px',
  comfortableTarget: '56px',
} as const

/** Motion is functional only. No decorative animation — it costs battery and attention. */
export const motion = {
  fast: '120ms',
  base: '200ms',
  easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
} as const

/** Mobile-first breakpoints. The phone is the design target, not the fallback. */
export const breakpoints = {
  sm: '480px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const

export const tokens = {
  colors,
  semantic,
  semanticDark,
  typography,
  spacing,
  radius,
  shadow,
  touch,
  motion,
  breakpoints,
} as const
