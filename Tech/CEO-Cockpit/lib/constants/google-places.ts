/**
 * Google Places listings for all 10 Carisma locations.
 *
 * Single source of truth for the google-reviews ETL
 * (lib/etl/google-reviews.ts → google_reviews table).
 *
 * Place IDs discovered 2026-06-10 by scraping Google Maps + the Google
 * Search knowledge panel for each location, then verified by decoding each
 * ChIJ place ID back to the Maps listing's ftid (0x…:0x… pair in the place
 * URL) — all 10 matched. Snapshot at discovery time (reviews / rating):
 *
 *   inter             778 @ 4.6   hugos     1,146 @ 4.8
 *   hyatt             549 @ 4.8   ramla       988 @ 4.9
 *   labranda          475 @ 4.9   odycy       749 @ 4.9
 *   excelsior         176 @ 4.8   novotel     165 @ 4.8
 *   aesthetics-clinic 303 @ 4.7   slimming-clinic 17 @ 5.0
 *
 * locationId / brandId map 1:1 to the Supabase `locations` / `brands` tables.
 * NOTE: Riviera (formerly Labranda) to "Riviera Spa Resort" and the Odycy
 * (Sunny Coast) listing is named "AX Sunny Coast" — both confirmed correct.
 */

export interface GooglePlaceLocation {
  /** Matches locations.slug in Supabase */
  slug: string;
  /** Google Places API place ID (ChIJ… format) */
  placeId: string;
  /** Exact listing name on Google Maps (for verification/logging) */
  googleName: string;
  /** locations.id in Supabase */
  locationId: number;
  /** brands.id in Supabase (1 = Spa, 2 = Aesthetics, 3 = Slimming) */
  brandId: number;
}

export const GOOGLE_PLACES_LOCATIONS: GooglePlaceLocation[] = [
  {
    slug: "inter",
    placeId: "ChIJLebQPWlFDhMR6pIySWevhos",
    googleName: "Carisma Spa & Wellness at InterContinental - Massage & Day Spa",
    locationId: 1,
    brandId: 1,
  },
  {
    slug: "hugos",
    placeId: "ChIJB7nR9MJFDhMRZhFosipmHuQ",
    googleName: "Carisma Spa & Wellness at Hugo's Hotels - Massage & Day Spa",
    locationId: 2,
    brandId: 1,
  },
  {
    slug: "hyatt",
    placeId: "ChIJC4SrBOJFDhMRAfVYR5Ypv7E",
    googleName: "Carisma Spa & Wellness at Hyatt Regency - Massage & Day Spa",
    locationId: 3,
    brandId: 1,
  },
  {
    slug: "ramla",
    placeId: "ChIJb8mnDlFNDhMReGUGioZvbCY",
    googleName: "Carisma Spa & Wellness at Ramla Bay Resort - Massage & Day Spa",
    locationId: 4,
    brandId: 1,
  },
  {
    slug: "labranda",
    placeId: "ChIJVf7adxBNDhMR2WxYVgmOIco",
    googleName: "Carisma Spa & Wellness at Riviera Spa Resort - Massage & Day Spa",
    locationId: 5,
    brandId: 1,
  },
  {
    slug: "odycy",
    placeId: "ChIJ21v09zNPDhMRSThvJt48gPM",
    googleName: "Carisma Spa & Wellness at AX Sunny Coast - Massage & Day Spa",
    locationId: 6,
    brandId: 1,
  },
  {
    slug: "excelsior",
    placeId: "ChIJVQ3NvthFDhMR_wNK6ItB4V8",
    googleName: "Carisma Spa & Wellness at Grand Hotel Excelsior",
    locationId: 7,
    brandId: 1,
  },
  {
    slug: "novotel",
    placeId: "ChIJ_f5tdHFFDhMR_-Zd2whQOVQ",
    googleName: "Carisma Spa & Wellness at Novotel Malta Sliema - Massage & Day Spa",
    locationId: 8,
    brandId: 1,
  },
  {
    slug: "aesthetics-clinic",
    placeId: "ChIJ89gk77pFDhMR24BuuGD-rBQ",
    googleName: "Carisma Aesthetics - Med Aesthetic Clinic Malta",
    locationId: 9,
    brandId: 2,
  },
  {
    slug: "slimming-clinic",
    placeId: "ChIJgVdYYmhFDhMR8oSHh_7gYX4",
    googleName: "Carisma Slimming | Medical Weight Loss & Slimming Malta",
    locationId: 10,
    brandId: 3,
  },
];
