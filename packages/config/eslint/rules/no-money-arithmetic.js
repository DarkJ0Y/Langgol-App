/**
 * @fileoverview Forbid raw arithmetic on money-typed values.
 *
 * Money in Langgol is integer poisha carried as a branded `bigint`. All arithmetic must go
 * through `packages/domain/money`, which owns the rounding rule (half-up, once per line) and
 * the allocation rule (remainder to the platform). Scattering `a + b` across the codebase is
 * how rounding drift and lost poisha enter a ledger.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §2
 */

const MONEY_SUFFIX = /Poisha$/

/** @param {import('estree').Node | null | undefined} node */
function moneyName(node) {
  if (!node) return null
  if (node.type === 'Identifier' && MONEY_SUFFIX.test(node.name)) return node.name
  if (node.type === 'MemberExpression' && !node.computed) {
    const prop = node.property
    if (prop && prop.type === 'Identifier' && MONEY_SUFFIX.test(prop.name)) return prop.name
  }
  return null
}

const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '**'])

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow arithmetic on money-typed (*Poisha) values outside the money domain module',
    },
    schema: [],
    messages: {
      arithmetic:
        'Do not perform arithmetic on money value "{{name}}". Use the Money module ' +
        '(Money.add/subtract/multiply/percent/allocate) so rounding and allocation stay in one place. ' +
        'See docs/06_FINANCIAL_ARCHITECTURE.md §2.',
      compound:
        'Do not use "{{operator}}" on money value "{{name}}". Use the Money module instead.',
    },
  },

  create(context) {
    return {
      BinaryExpression(node) {
        if (!ARITHMETIC.has(node.operator)) return
        const name = moneyName(node.left) ?? moneyName(node.right)
        if (name) context.report({ node, messageId: 'arithmetic', data: { name } })
      },

      AssignmentExpression(node) {
        if (node.operator === '=') return
        const name = moneyName(node.left)
        if (name) {
          context.report({
            node,
            messageId: 'compound',
            data: { name, operator: node.operator },
          })
        }
      },

      UpdateExpression(node) {
        const name = moneyName(node.argument)
        if (name) {
          context.report({
            node,
            messageId: 'compound',
            data: { name, operator: node.operator },
          })
        }
      },
    }
  },
}
