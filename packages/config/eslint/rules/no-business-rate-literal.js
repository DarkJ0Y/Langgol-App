/**
 * @fileoverview Forbid business rates as literals in application code.
 *
 * Commission rates, delivery tariffs, fee schedules, radius caps, windows and thresholds are
 * **product decisions with an audit trail**, not constants. They live in versioned
 * `PlatformConfig`; every quote and order records the config version it was priced under, so
 * historical pricing stays reproducible. A hard-coded rate cannot be changed without a deploy
 * and silently invalidates every historical figure the moment somebody edits it.
 *
 * This rule is mandatory per the P1 approval instruction (§5).
 *
 * Refs: docs/03_ARCHITECTURE.md §7, docs/06_FINANCIAL_ARCHITECTURE.md §4
 */

/**
 * Word-segments that denote a business rate/parameter rather than a mechanical constant.
 *
 * Matching is done on **segments**, not substrings: `deliveryTariff` splits to
 * ['delivery','tariff'] and matches, while `chargeableWeight` splits to
 * ['chargeable','weight'] and does not. Substring matching would flag half the codebase.
 */
const BUSINESS_SEGMENTS = new Set([
  'bps',
  'commission',
  'tariff',
  'tariffs',
  'fee',
  'fees',
  'rate',
  'rates',
  'percent',
  'percentage',
  'margin',
  'subsidy',
  'discount',
  'threshold',
  'thresholds',
  'radius',
  'cap',
  'caps',
  'window',
  'ttl',
  'circuity',
  'weights',
])

/**
 * Split an identifier or dotted path into lowercase word segments.
 * `config.deliveryTariff` → ['config', 'delivery', 'tariff']
 * `commission_bps`        → ['commission', 'bps']
 *
 * @param {string} name
 */
function segments(name) {
  return name
    .split(/[._\-\s]+/)
    .flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/))
    .map((part) => part.toLowerCase())
    .filter(Boolean)
}

/** @param {string} name */
function isBusinessName(name) {
  return segments(name).some((segment) => BUSINESS_SEGMENTS.has(segment))
}

/**
 * Numbers that are structural rather than economic. `0` and `1` are identity values;
 * `100` and `10000` are the poisha and basis-point denominators; `-1` is a comparator result.
 */
const STRUCTURAL = new Set([0, 1, -1, 100, 10000])

/** @param {import('estree').Node} node */
function literalNumber(node) {
  if (node.type === 'Literal' && typeof node.value === 'number') return node.value
  if (
    node.type === 'UnaryExpression' &&
    node.operator === '-' &&
    node.argument.type === 'Literal' &&
    typeof node.argument.value === 'number'
  ) {
    return -node.argument.value
  }
  return null
}

/** @param {import('estree').Node | null | undefined} node */
function nameOf(node) {
  if (!node) return null
  if (node.type === 'Identifier') return node.name
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'MemberExpression' && !node.computed) {
    const objectName = nameOf(node.object)
    const propertyName = nameOf(node.property)
    return objectName && propertyName ? `${objectName}.${propertyName}` : propertyName
  }
  return null
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hard-coded business rates (commission, tariffs, fees, thresholds) in application code',
    },
    schema: [],
    messages: {
      literal:
        'Business rate "{{name}}" must not be a literal ({{value}}). Read it from PlatformConfig ' +
        'so the value is versioned, audited and attributable. See docs/03_ARCHITECTURE.md §7.',
      fractional:
        'Fractional multiplier {{value}} looks like a rate. Express rates in basis points and read ' +
        'them from PlatformConfig; never multiply money by a float. See docs/06_FINANCIAL_ARCHITECTURE.md §4.',
    },
  },

  create(context) {
    /**
     * @param {import('estree').Node} target
     * @param {import('estree').Node} valueNode
     * @param {import('eslint').Rule.Node} reportNode
     */
    function check(target, valueNode, reportNode) {
      const name = nameOf(target)
      if (!name || !isBusinessName(name)) return
      const value = literalNumber(valueNode)
      if (value === null || STRUCTURAL.has(value)) return
      context.report({
        node: reportNode,
        messageId: 'literal',
        data: { name, value: String(value) },
      })
    }

    return {
      VariableDeclarator(node) {
        if (node.init) check(node.id, node.init, node)
      },

      Property(node) {
        if (node.value) check(node.key, node.value, node)
      },

      PropertyDefinition(node) {
        if (node.value) check(node.key, node.value, node)
      },

      AssignmentExpression(node) {
        if (node.operator === '=') check(node.left, node.right, node)
      },

      /** Catches `subtotal * 0.03` and similar float-rate arithmetic anywhere. */
      BinaryExpression(node) {
        if (node.operator !== '*' && node.operator !== '/') return
        for (const side of [node.left, node.right]) {
          const value = literalNumber(side)
          if (value === null) continue
          if (Number.isInteger(value)) continue
          if (value <= 0 || value >= 1) continue
          context.report({ node, messageId: 'fractional', data: { value: String(value) } })
          return
        }
      },
    }
  },
}
