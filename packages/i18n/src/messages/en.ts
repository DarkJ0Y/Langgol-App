/**
 * English message catalogue.
 *
 * Structurally identical to Bangla — the type system enforces it, so a key can never exist in
 * one language and be silently missing in the other.
 */

import type { bn } from './bn.js'

/**
 * The Bangla catalogue is `as const`, so its values are literal types. Widening them to `string`
 * is what lets English mirror its SHAPE without having to mirror its text — while still failing
 * to compile if a key is missing, added, or nested differently.
 */
export type Catalogue = { [K in keyof typeof bn]: { [M in keyof (typeof bn)[K]]: string } }

export const en: Catalogue = {
  common: {
    appName: 'Langgol',
    continue: 'Continue',
    back: 'Back',
    cancel: 'Cancel',
    save: 'Save',
    retry: 'Try again',
    loading: 'Loading…',
    languageName: 'English',
    switchToEnglish: 'বাংলা',
  },

  auth: {
    signInTitle: 'Sign in to Langgol',
    signInSubtitle: 'Enter your mobile number. We will send you a code.',
    phoneLabel: 'Mobile number',
    phonePlaceholder: '01XXXXXXXXX',
    phoneHelp: 'Use the number that receives SMS',
    sendCode: 'Send code',
    codeTitle: 'Enter the code',
    codeSentTo: 'We sent a code to {phone}',
    codeLabel: 'Six-digit code',
    verify: 'Sign in',
    resend: 'Send a new code',
    resendIn: 'You can request another code in {seconds} seconds',
    chooseRole: 'What would you like to do?',
    roleFarmer: 'Sell my produce',
    roleConsumer: 'Buy produce',
    roleRetailer: 'Buy for my shop',
    nameLabel: 'Your name',
    signOut: 'Sign out',
  },

  errors: {
    phoneEmpty: 'Enter your mobile number',
    phoneInvalid: 'That number does not look right. Enter 11 digits starting with 01.',
    codeInvalid: 'That code did not match. Check it, or request a new one.',
    codeExpired: 'That code has expired. Request a new one.',
    tooManyAttempts: 'Too many incorrect attempts. Please try again shortly.',
    rateLimited: 'Try again in {seconds} seconds',
    accountSuspended: 'This account is suspended. Please contact Langgol.',
    smsUnavailable: 'We cannot send an SMS right now. Please try again shortly.',
    network: 'No internet connection. Please try again.',
    unexpected: 'Something went wrong. Please try again.',
    notFound: 'Not found',
    notAllowed: 'You do not have permission',
  },

  address: {
    title: 'Address',
    division: 'Division',
    district: 'District',
    upazila: 'Upazila',
    union: 'Union',
    village: 'Village / area',
    landmark: 'Nearby landmark (school, market)',
    recipientName: 'Who will receive it',
    recipientPhone: 'Their mobile number',
    useMap: 'Show on map',
    selectArea: 'Choose your area',
  },

  units: {
    kg: 'kg',
    gram: 'g',
    mon: 'mon',
    seer: 'seer',
    piece: 'pc',
    hali: 'hali',
    dozen: 'dozen',
    litre: 'L',
  },

  empty: {
    nothingYet: 'Nothing here yet',
    noResults: 'No results found',
  },
}
