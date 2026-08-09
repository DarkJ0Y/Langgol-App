import type { RandomSource, SecretHasher } from '@langgol/application'
import {
  generateNumericCode,
  generateSessionToken,
  hashSecret,
  hashToken,
  verifySecret,
} from './hash.js'

export const scryptHasher: SecretHasher = {
  hash: hashSecret,
  verify: verifySecret,
  hashToken,
}

export const cryptoRandom: RandomSource = {
  numericCode: generateNumericCode,
  sessionToken: generateSessionToken,
}

export { hashSecret, verifySecret, hashToken, generateSessionToken, generateNumericCode }
