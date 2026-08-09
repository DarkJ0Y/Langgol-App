import { RuleTester } from 'eslint'
import { describe, it, afterAll } from 'vitest'
import noMoneyArithmetic from './no-money-arithmetic.js'
import noBusinessRateLiteral from './no-business-rate-literal.js'
import noUnsafeMoneyCast from './no-unsafe-money-cast.js'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.afterAll = afterAll

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

ruleTester.run('no-money-arithmetic', noMoneyArithmetic, {
  valid: [
    'const total = Money.add(subtotalPoisha, deliveryPoisha)',
    'const n = a + b',
    'const label = `${count} items`',
    'const share = weight / totalWeight',
    'order.status = "CONFIRMED"',
  ],
  invalid: [
    { code: 'const t = subtotalPoisha + feePoisha', errors: [{ messageId: 'arithmetic' }] },
    { code: 'const t = order.totalPoisha - discount', errors: [{ messageId: 'arithmetic' }] },
    { code: 'const t = 3 * commissionPoisha', errors: [{ messageId: 'arithmetic' }] },
    { code: 'totalPoisha += feePoisha', errors: [{ messageId: 'compound' }] },
    { code: 'totalPoisha++', errors: [{ messageId: 'compound' }] },
  ],
})

ruleTester.run('no-business-rate-literal', noBusinessRateLiteral, {
  valid: [
    // Structural constants are fine.
    'const POISHA_PER_TAKA = 100',
    'const BPS_DENOMINATOR = 10000',
    'const rate = config.commission.bps',
    'const deliveryTariff = await config.get("delivery.tariff")',
    'const index = 2',
    'const retries = 3',
    // Integer multipliers are not rates.
    'const grams = kg * 1000',
  ],
  invalid: [
    { code: 'const commissionBps = 300', errors: [{ messageId: 'literal' }] },
    { code: 'const options = { platformFee: 250 }', errors: [{ messageId: 'literal' }] },
    { code: 'config.deliveryTariff = 4500', errors: [{ messageId: 'literal' }] },
    { code: 'const radiusKm = 40', errors: [{ messageId: 'literal' }] },
    { code: 'const commission = subtotal * 0.03', errors: [{ messageId: 'fractional' }] },
    { code: 'class C { static feeRate = 0.05 }', errors: [{ messageId: 'literal' }] },
  ],
})

ruleTester.run('no-unsafe-money-cast', noUnsafeMoneyCast, {
  valid: [
    'const s = totalPoisha.toString()',
    'const n = Number(quantityBase)',
    'const f = Number.parseInt(pageParam, 10)',
    'Money.format(totalPoisha, "bn")',
  ],
  invalid: [
    { code: 'const n = Number(totalPoisha)', errors: [{ messageId: 'cast' }] },
    { code: 'const n = parseFloat(order.buyerTotalPoisha)', errors: [{ messageId: 'cast' }] },
    { code: 'const n = Math.round(commissionPoisha)', errors: [{ messageId: 'cast' }] },
  ],
})
