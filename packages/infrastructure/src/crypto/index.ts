import type { RandomSource, SecretHasher } from '@langgol/application'
import {
  generateNumericCode,
  generateSessionToken,
  generateToken,
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
  token: generateToken,
}

export {
  hashSecret,
  verifySecret,
  hashToken,
  generateSessionToken,
  generateNumericCode,
  generateToken,
}
