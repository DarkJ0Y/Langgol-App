import noMoneyArithmetic from './no-money-arithmetic.js'
import noBusinessRateLiteral from './no-business-rate-literal.js'
import noUnsafeMoneyCast from './no-unsafe-money-cast.js'

/**
 * Local ESLint plugin carrying Langgol's non-negotiable engineering rules.
 * These exist because "we agreed not to do that" is not a control.
 *
 * @type {import('eslint').ESLint.Plugin}
 */
export const langgolPlugin = {
  meta: { name: 'langgol', version: '0.1.0' },
  rules: {
    'no-money-arithmetic': noMoneyArithmetic,
    'no-business-rate-literal': noBusinessRateLiteral,
    'no-unsafe-money-cast': noUnsafeMoneyCast,
  },
}

export { noMoneyArithmetic, noBusinessRateLiteral, noUnsafeMoneyCast }
export default langgolPlugin
