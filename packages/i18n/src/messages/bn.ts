/**
 * Bangla message catalogue — the DEFAULT.
 *
 * Bangla is written first and English follows, not the other way round. Building an English UI
 * and translating later produces layouts that break on Bangla's taller glyphs and longer words,
 * and copy that reads like a translation. The farmer is the primary user; this is their language.
 *
 * Register: plain spoken Bangla (চলিত), not formal সাধু ভাষা. No English loanwords where a
 * common Bangla word exists. Short sentences — the reader may be reading slowly.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §1
 */

export const bn = {
  common: {
    appName: 'লাঙ্গল',
    continue: 'এগিয়ে যান',
    back: 'পেছনে',
    cancel: 'বাতিল',
    save: 'সংরক্ষণ',
    retry: 'আবার চেষ্টা করুন',
    loading: 'অপেক্ষা করুন…',
    languageName: 'বাংলা',
    switchToEnglish: 'English',
  },

  auth: {
    signInTitle: 'লাঙ্গলে প্রবেশ করুন',
    signInSubtitle: 'আপনার মোবাইল নম্বর দিন। আমরা একটি কোড পাঠাব।',
    phoneLabel: 'মোবাইল নম্বর',
    phonePlaceholder: '01XXXXXXXXX',
    phoneHelp: 'যে নম্বরে এসএমএস আসে সেটি দিন',
    sendCode: 'কোড পাঠান',
    codeTitle: 'কোড দিন',
    codeSentTo: '{phone} নম্বরে কোড পাঠানো হয়েছে',
    codeLabel: 'ছয় সংখ্যার কোড',
    verify: 'প্রবেশ করুন',
    resend: 'আবার কোড পাঠান',
    resendIn: '{seconds} সেকেন্ড পর আবার পাঠাতে পারবেন',
    chooseRole: 'আপনি কী করতে চান?',
    roleFarmer: 'ফসল বিক্রি করব',
    roleConsumer: 'ফসল কিনব',
    roleRetailer: 'দোকানের জন্য কিনব',
    nameLabel: 'আপনার নাম',
    signOut: 'বের হয়ে যান',
  },

  errors: {
    // Every error says what went wrong AND what to do next. "Invalid input" helps nobody.
    phoneEmpty: 'মোবাইল নম্বর দিন',
    phoneInvalid: 'নম্বরটি ঠিক নেই। ১১ সংখ্যার নম্বর দিন, ০১ দিয়ে শুরু।',
    codeInvalid: 'কোডটি মেলেনি। আবার দেখুন বা নতুন কোড নিন।',
    codeExpired: 'কোডের মেয়াদ শেষ। নতুন কোড নিন।',
    tooManyAttempts: 'অনেকবার ভুল হয়েছে। একটু পরে আবার চেষ্টা করুন।',
    rateLimited: '{seconds} সেকেন্ড পর আবার চেষ্টা করুন',
    accountSuspended: 'আপনার অ্যাকাউন্ট বন্ধ আছে। লাঙ্গলের সাথে যোগাযোগ করুন।',
    smsUnavailable: 'এখন এসএমএস পাঠানো যাচ্ছে না। একটু পরে চেষ্টা করুন।',
    network: 'ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।',
    unexpected: 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।',
    notFound: 'পাওয়া যায়নি',
    notAllowed: 'আপনার অনুমতি নেই',
  },

  address: {
    title: 'ঠিকানা',
    division: 'বিভাগ',
    district: 'জেলা',
    upazila: 'উপজেলা',
    union: 'ইউনিয়ন',
    village: 'গ্রাম / এলাকা',
    landmark: 'পাশে যা আছে (স্কুল, বাজার)',
    recipientName: 'যিনি নেবেন',
    recipientPhone: 'তার মোবাইল নম্বর',
    useMap: 'মানচিত্রে দেখান',
    selectArea: 'এলাকা বেছে নিন',
  },

  units: {
    kg: 'কেজি',
    gram: 'গ্রাম',
    mon: 'মণ',
    seer: 'সের',
    piece: 'টি',
    hali: 'হালি',
    dozen: 'ডজন',
    litre: 'লিটার',
  },

  marketplace: {
    title: 'আপনার কাছাকাছি যা আছে',
    subtitle: 'নিচের দাম আপনার দরজায় পৌঁছে দেওয়ার দাম — পরিবহন খরচসহ।',
    perKg: 'কেজি প্রতি',
    deliveredPerKg: 'পৌঁছে দিয়ে, কেজি প্রতি',
    from: '{farm} থেকে',
    available: '{quantity} আছে',
    quantityLabel: 'কতটুকু লাগবে?',
    getPrice: 'পৌঁছে দেওয়ার দাম দেখুন',
    pickup: 'নিজে নিয়ে যাব',
    delivery: 'আমার কাছে পৌঁছে দিন',
    harvestedToday: 'আজ তোলা',

    breakdownTitle: 'আপনি যা দেবেন',
    breakdownProduct: 'ফসল',
    breakdownDelivery: 'পরিবহন',
    breakdownHandling: 'বাঁধাই ও ওঠানো-নামানো',
    breakdownPlatformFee: 'সেবা খরচ',
    breakdownTotal: 'আপনি দেবেন',
    breakdownPerKgDelivered: 'পৌঁছে দেওয়ার পর কেজি প্রতি',
    breakdownExpiresAt: 'এই দাম {time} পর্যন্ত থাকবে',
    breakdownWhyThisPrice: 'এই দাম কেন',
    breakdownNoHiddenCharges: 'আর কিছু দিতে হবে না। কৃষক এখান থেকেই টাকা পান।',

    reasonCheapestDelivered: 'পৌঁছে দিয়ে সবচেয়ে কম দাম',
    reasonGoodValueDelivered: 'পৌঁছে দিয়ে ভালো দাম',
    reasonHarvestedToday: 'আজ তোলা',
    reasonFreshest: 'সবচেয়ে টাটকা',
    reasonNearby: 'কাছেই — {distanceKm} কিমি',
    reasonFastestDelivery: 'সবচেয়ে তাড়াতাড়ি পৌঁছাবে',
    reasonHighlyReliable: 'নির্ভরযোগ্য কৃষক',
    reasonWellRated: 'ক্রেতারা ভালো বলেছেন',
    reasonCoversFullQuantity: 'পুরো পরিমাণ আছে',
    reasonPartialFillOnly: 'আপনি যতটা চেয়েছেন তার কিছুটা আছে',
    reasonNewFarmer: 'লাঙ্গলে নতুন কৃষক',

    checkoutTitle: 'অর্ডার নিশ্চিত করুন',
    checkoutPayWith: 'কীভাবে টাকা দেবেন?',
    checkoutCashOnDelivery: 'পৌঁছে দেওয়ার সময় নগদ',
    checkoutPlaceOrder: 'অর্ডার করুন',
    checkoutPlacing: 'অর্ডার করা হচ্ছে…',
    checkoutDeliverTo: 'পৌঁছে দিতে হবে',
    checkoutAccepted: 'অর্ডার হয়ে গেছে',
    checkoutOrderNumber: 'অর্ডার নম্বর {number}',
    checkoutAwaitingFarmer: 'কৃষক {time} পর্যন্ত সময় পাবেন রাজি হতে।',
    checkoutViewOrder: 'অর্ডার দেখুন',

    errorQuoteExpired: 'এই দামের সময় শেষ। এখনকার দাম নিচে দেওয়া হলো।',
    errorQuoteAlreadyUsed: 'এই দাম দিয়ে আগেই অর্ডার করা হয়েছে।',
    errorQuoteNotFound: 'এই দাম খুঁজে পাওয়া যায়নি।',
    errorListingChanged: 'কৃষক দাম বদলেছেন। নতুন দাম দেখে নিন।',
    errorListingUnavailable: 'এই ফসল আর নেই।',
    errorInsufficientInventory: 'কৃষকের কাছে এত পরিমাণ আর নেই।',
    errorQuantity: 'পরিমাণটি ঠিকভাবে লিখুন।',
  },

  empty: {
    nothingYet: 'এখনো কিছু নেই',
    noResults: 'কিছু পাওয়া যায়নি',
  },
} as const
