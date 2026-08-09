/**
 * @fileoverview Forbid coercing money values to JavaScript numbers.
 *
 * Money is `bigint` poisha. `Number(x)` loses precision above 2^53, `parseFloat` reintroduces
 * floating point, and `Math.round` on money silently changes a ledger amount. Money crosses a
 * boundary as a **string**, never as a number.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §2
 */

const MONEY_SUFFIX = /Poisha$/
const BANNED_CALLS = new Set(['Number', 'parseFloat', 'parseInt'])
const BANNED_MATH = new Set(['round', 'floor', 'ceil', 'abs', 'trunc'])

/** @param {import('estree').Node | null | undefined} node */
function isMoney(node) {
  if (!node) return false
  if (node.type === 'Identifier') return MONEY_SUFFIX.test(node.name)
  if (node.type === 'MemberExpression' && !node.computed) {
    const prop = node.property
    return prop.type === 'Identifier' && MONEY_SUFFIX.test(prop.name)
  }
  return false
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow coercing money-typed (*Poisha) values to JavaScript numbers' },
    schema: [],
    messages: {
      cast:
        'Do not convert money value to a number with {{callee}}(). bigint precision is lost above 2^53 ' +
        'and floating point must never touch money. Serialise money as a string. ' +
        'See docs/06_FINANCIAL_ARCHITECTURE.md §2.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        const [first] = node.arguments
        if (!first || !isMoney(first)) return

        if (callee.type === 'Identifier' && BANNED_CALLS.has(callee.name)) {
          context.report({ node, messageId: 'cast', data: { callee: callee.name } })
          return
        }

        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Math' &&
          callee.property.type === 'Identifier' &&
          BANNED_MATH.has(callee.property.name)
        ) {
          context.report({
            node,
            messageId: 'cast',
            data: { callee: `Math.${callee.property.name}` },
          })
        }
      },
    }
  },
}
