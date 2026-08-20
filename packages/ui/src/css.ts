import {
  colors,
  motion,
  radius,
  semantic,
  semanticDark,
  spacing,
  touch,
  typography,
} from './tokens.js'

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * Emit the tokens as CSS custom properties.
 *
 * Generated from the same TypeScript objects the components read, so the stylesheet and the code
 * cannot drift apart. A duplicated hex value in a hand-written CSS file is how a design system
 * quietly stops being a system.
 */
export function tokensToCssVariables(): string {
  const lines: string[] = [':root {']

  for (const [family, scale] of Object.entries(colors)) {
    for (const [step, value] of Object.entries(scale)) {
      lines.push(`  --lg-color-${family}-${step}: ${value};`)
    }
  }

  for (const [name, value] of Object.entries(semantic)) {
    lines.push(`  --lg-${kebab(name)}: ${value};`)
  }

  for (const [step, value] of Object.entries(spacing)) {
    lines.push(`  --lg-space-${step}: ${value};`)
  }

  for (const [name, value] of Object.entries(radius)) {
    lines.push(`  --lg-radius-${name}: ${value};`)
  }

  for (const [name, value] of Object.entries(typography.size)) {
    lines.push(`  --lg-text-${name}: ${value};`)
  }

  for (const [name, value] of Object.entries(typography.lineHeight.bangla)) {
    lines.push(`  --lg-leading-bn-${name}: ${String(value)};`)
  }

  for (const [name, value] of Object.entries(typography.lineHeight.latin)) {
    lines.push(`  --lg-leading-en-${name}: ${String(value)};`)
  }

  lines.push(`  --lg-font-sans: ${typography.fontFamily.sans};`)
  lines.push(`  --lg-touch-min: ${touch.minTarget};`)
  lines.push(`  --lg-motion-base: ${motion.base};`)
  lines.push(`  --lg-motion-easing: ${motion.easing};`)
  lines.push('}')

  /*
   * The dark surface.
   *
   * Only the SEMANTIC aliases are redefined — the palette, spacing, type and motion are one
   * system in both themes. Emitted twice on purpose: `[data-theme]` so an explicit choice wins in
   * either direction, and `prefers-color-scheme` for the default "system" setting, guarded with
   * `:not([data-theme='light'])` so a reader who has chosen light is not overridden by their OS.
   */
  const darkVariables = Object.entries(semanticDark).map(
    ([name, value]) => `--lg-${kebab(name)}: ${value};`,
  )

  lines.push('')
  lines.push('@media (prefers-color-scheme: dark) {')
  lines.push("  :root:not([data-theme='light']) {")
  lines.push(...darkVariables.map((line) => `    ${line}`))
  lines.push('  }')
  lines.push('}')
  lines.push('')
  lines.push(":root[data-theme='dark'] {")
  lines.push(...darkVariables.map((line) => `  ${line}`))
  lines.push('}')

  return lines.join('\n')
}
