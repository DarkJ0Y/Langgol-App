/**
 * Bangladesh administrative geography — reference seed data.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ DATA HONESTY NOTE                                                                        │
 * │                                                                                          │
 * │ Division, district and upazila NAMES are public administrative facts and are seeded here.│
 * │                                                                                          │
 * │ CENTROID COORDINATES ARE DELIBERATELY NOT SEEDED. Inventing plausible-looking latitudes  │
 * │ and longitudes would make every distance calculation, delivery quote and radius search   │
 * │ silently wrong while appearing to work — the worst possible failure mode for a platform  │
 * │ whose thesis is measured in kilometres and taka. Centroids must be loaded from an        │
 * │ authoritative source (BBS geocode data / official gazette) as a P0 data task, and the    │
 * │ Bangla spellings below must be verified against the same source at that time.            │
 * │                                                                                          │
 * │ Until centroids are loaded, `LocationPrecision.AREA_CENTROID` cannot be resolved to a    │
 * │ point, and the application surfaces that as "location unknown" rather than guessing.     │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §2; docs/02_DATABASE.md §15
 */

export interface AreaSeed {
  readonly nameEn: string
  readonly nameBn: string
  readonly children?: readonly AreaSeed[]
}

/**
 * The eight divisions and their sixty-four districts.
 *
 * Upazilas are seeded only for the pilot candidate district (Rajshahi) — loading all ~495
 * nationally is a data task, not a code task, and seeding a partial national set would create
 * the illusion of coverage we do not have.
 */
export const DIVISIONS: readonly AreaSeed[] = [
  {
    nameEn: 'Barishal',
    nameBn: 'বরিশাল',
    children: [
      { nameEn: 'Barguna', nameBn: 'বরগুনা' },
      { nameEn: 'Barishal', nameBn: 'বরিশাল' },
      { nameEn: 'Bhola', nameBn: 'ভোলা' },
      { nameEn: 'Jhalokati', nameBn: 'ঝালকাঠি' },
      { nameEn: 'Patuakhali', nameBn: 'পটুয়াখালী' },
      { nameEn: 'Pirojpur', nameBn: 'পিরোজপুর' },
    ],
  },
  {
    nameEn: 'Chattogram',
    nameBn: 'চট্টগ্রাম',
    children: [
      { nameEn: 'Bandarban', nameBn: 'বান্দরবান' },
      { nameEn: 'Brahmanbaria', nameBn: 'ব্রাহ্মণবাড়িয়া' },
      { nameEn: 'Chandpur', nameBn: 'চাঁদপুর' },
      { nameEn: 'Chattogram', nameBn: 'চট্টগ্রাম' },
      { nameEn: 'Cumilla', nameBn: 'কুমিল্লা' },
      { nameEn: "Cox's Bazar", nameBn: 'কক্সবাজার' },
      { nameEn: 'Feni', nameBn: 'ফেনী' },
      { nameEn: 'Khagrachhari', nameBn: 'খাগড়াছড়ি' },
      { nameEn: 'Lakshmipur', nameBn: 'লক্ষ্মীপুর' },
      { nameEn: 'Noakhali', nameBn: 'নোয়াখালী' },
      { nameEn: 'Rangamati', nameBn: 'রাঙামাটি' },
    ],
  },
  {
    nameEn: 'Dhaka',
    nameBn: 'ঢাকা',
    children: [
      { nameEn: 'Dhaka', nameBn: 'ঢাকা' },
      { nameEn: 'Faridpur', nameBn: 'ফরিদপুর' },
      { nameEn: 'Gazipur', nameBn: 'গাজীপুর' },
      { nameEn: 'Gopalganj', nameBn: 'গোপালগঞ্জ' },
      { nameEn: 'Kishoreganj', nameBn: 'কিশোরগঞ্জ' },
      { nameEn: 'Madaripur', nameBn: 'মাদারীপুর' },
      { nameEn: 'Manikganj', nameBn: 'মানিকগঞ্জ' },
      { nameEn: 'Munshiganj', nameBn: 'মুন্সিগঞ্জ' },
      { nameEn: 'Narayanganj', nameBn: 'নারায়ণগঞ্জ' },
      { nameEn: 'Narsingdi', nameBn: 'নরসিংদী' },
      { nameEn: 'Rajbari', nameBn: 'রাজবাড়ী' },
      { nameEn: 'Shariatpur', nameBn: 'শরীয়তপুর' },
      { nameEn: 'Tangail', nameBn: 'টাঙ্গাইল' },
    ],
  },
  {
    nameEn: 'Khulna',
    nameBn: 'খুলনা',
    children: [
      { nameEn: 'Bagerhat', nameBn: 'বাগেরহাট' },
      { nameEn: 'Chuadanga', nameBn: 'চুয়াডাঙ্গা' },
      { nameEn: 'Jashore', nameBn: 'যশোর' },
      { nameEn: 'Jhenaidah', nameBn: 'ঝিনাইদহ' },
      { nameEn: 'Khulna', nameBn: 'খুলনা' },
      { nameEn: 'Kushtia', nameBn: 'কুষ্টিয়া' },
      { nameEn: 'Magura', nameBn: 'মাগুরা' },
      { nameEn: 'Meherpur', nameBn: 'মেহেরপুর' },
      { nameEn: 'Narail', nameBn: 'নড়াইল' },
      { nameEn: 'Satkhira', nameBn: 'সাতক্ষীরা' },
    ],
  },
  {
    nameEn: 'Mymensingh',
    nameBn: 'ময়মনসিংহ',
    children: [
      { nameEn: 'Jamalpur', nameBn: 'জামালপুর' },
      { nameEn: 'Mymensingh', nameBn: 'ময়মনসিংহ' },
      { nameEn: 'Netrokona', nameBn: 'নেত্রকোণা' },
      { nameEn: 'Sherpur', nameBn: 'শেরপুর' },
    ],
  },
  {
    nameEn: 'Rajshahi',
    nameBn: 'রাজশাহী',
    children: [
      { nameEn: 'Bogura', nameBn: 'বগুড়া' },
      { nameEn: 'Chapainawabganj', nameBn: 'চাঁপাইনবাবগঞ্জ' },
      { nameEn: 'Joypurhat', nameBn: 'জয়পুরহাট' },
      { nameEn: 'Naogaon', nameBn: 'নওগাঁ' },
      { nameEn: 'Natore', nameBn: 'নাটোর' },
      { nameEn: 'Pabna', nameBn: 'পাবনা' },
      {
        // Pilot candidate district — upazilas seeded. docs/01_MVP_REQUIREMENTS.md §2.1
        nameEn: 'Rajshahi',
        nameBn: 'রাজশাহী',
        children: [
          { nameEn: 'Bagha', nameBn: 'বাঘা' },
          { nameEn: 'Bagmara', nameBn: 'বাগমারা' },
          { nameEn: 'Charghat', nameBn: 'চারঘাট' },
          { nameEn: 'Durgapur', nameBn: 'দুর্গাপুর' },
          { nameEn: 'Godagari', nameBn: 'গোদাগাড়ী' },
          { nameEn: 'Mohanpur', nameBn: 'মোহনপুর' },
          { nameEn: 'Paba', nameBn: 'পবা' },
          { nameEn: 'Puthia', nameBn: 'পুঠিয়া' },
          { nameEn: 'Tanore', nameBn: 'তানোর' },
        ],
      },
      { nameEn: 'Sirajganj', nameBn: 'সিরাজগঞ্জ' },
    ],
  },
  {
    nameEn: 'Rangpur',
    nameBn: 'রংপুর',
    children: [
      { nameEn: 'Dinajpur', nameBn: 'দিনাজপুর' },
      { nameEn: 'Gaibandha', nameBn: 'গাইবান্ধা' },
      { nameEn: 'Kurigram', nameBn: 'কুড়িগ্রাম' },
      { nameEn: 'Lalmonirhat', nameBn: 'লালমনিরহাট' },
      { nameEn: 'Nilphamari', nameBn: 'নীলফামারী' },
      { nameEn: 'Panchagarh', nameBn: 'পঞ্চগড়' },
      { nameEn: 'Rangpur', nameBn: 'রংপুর' },
      { nameEn: 'Thakurgaon', nameBn: 'ঠাকুরগাঁও' },
    ],
  },
  {
    nameEn: 'Sylhet',
    nameBn: 'সিলেট',
    children: [
      { nameEn: 'Habiganj', nameBn: 'হবিগঞ্জ' },
      { nameEn: 'Moulvibazar', nameBn: 'মৌলভীবাজার' },
      { nameEn: 'Sunamganj', nameBn: 'সুনামগঞ্জ' },
      { nameEn: 'Sylhet', nameBn: 'সিলেট' },
    ],
  },
] as const
