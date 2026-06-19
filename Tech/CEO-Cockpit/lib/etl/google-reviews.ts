/**
 * Google Reviews ETL
 *
 * Pulls rating + review count for all 10 Carisma locations from the
 * Places API (New) and upserts one snapshot row per location per day
 * into google_reviews (UNIQUE on date,location_id).
 *
 * Place IDs live in lib/constants/google-places.ts (verified 2026-06-10).
 *
 * Env vars required:
 *   GOOGLE_PLACES_API_KEY
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { upsert } from "@/lib/etl/supabase-etl";
import {
  GOOGLE_PLACES_LOCATIONS,
  type GooglePlaceLocation,
} from "@/lib/constants/google-places";

const PLACES_BASE = "https://places.googleapis.com/v1/places";

interface PlaceDetails {
  rating?: number;
  userRatingCount?: number;
  displayName?: { text?: string; languageCode?: string };
}

interface GoogleReviewRow {
  date:          string;
  location_id:   number;
  brand_id:      number;
  total_reviews: number;
  avg_rating:    number;
  source:        string;
}

export interface GoogleReviewsEtlResult {
  date:          string;
  rows_upserted: number;
  log:           string[];
  errors:        string[];
}

/** Today's date (YYYY-MM-DD) in Europe/Malta. */
export function maltaToday(): string {
  // en-CA locale formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta" })
    .format(new Date());
}

async function fetchPlace(
  loc: GooglePlaceLocation,
  apiKey: string,
): Promise<PlaceDetails> {
  const resp = await fetch(`${PLACES_BASE}/${loc.placeId}`, {
    headers: {
      "X-Goog-Api-Key":   apiKey,
      "X-Goog-FieldMask": "rating,userRatingCount,displayName",
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Places API ${resp.status} for ${loc.slug} (${loc.placeId}): ${text.slice(0, 300)}`,
    );
  }
  return resp.json() as Promise<PlaceDetails>;
}

export async function runGoogleReviewsEtl(): Promise<GoogleReviewsEtlResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY not set — see docs/plans/2026-06-10-operations-live-data-design.md",
    );
  }

  const date = maltaToday();
  const rows: GoogleReviewRow[] = [];
  const log: string[]    = [];
  const errors: string[] = [];

  for (const loc of GOOGLE_PLACES_LOCATIONS) {
    try {
      const place = await fetchPlace(loc, apiKey);
      if (place.userRatingCount == null || place.rating == null) {
        throw new Error(
          `Places API returned no rating data (displayName="${place.displayName?.text ?? "?"}")`,
        );
      }
      rows.push({
        date,
        location_id:   loc.locationId,
        brand_id:      loc.brandId,
        total_reviews: place.userRatingCount,
        avg_rating:    place.rating,
        source:        "places_api",
      });
      log.push(`${loc.slug}: ${place.userRatingCount} reviews @ ${place.rating}`);
    } catch (e) {
      const msg = `${loc.slug}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      log.push(`ERROR — ${msg}`);
    }
  }

  const rowsUpserted = await upsert("google_reviews", rows as unknown as Record<string, unknown>[], "date,location_id");

  return { date, rows_upserted: rowsUpserted, log, errors };
}
