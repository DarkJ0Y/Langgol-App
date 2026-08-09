import { colors, motion, radius, semantic, spacing, touch, typography } from './tokens.js'

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

  return lines.join('\n')
}
