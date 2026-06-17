/**
 * Google Reviews ETL
 *
 * Pulls rating + review count for all 10 Carisma locations from the
 * Places API (New) and upserts one snapshot row per location per day
 * into google_reviews (UNIQUE on date,location_id).
 *
 * Also fetches the 5 most recent individual reviews per location and
 * upserts them into google_review_texts (UNIQUE on review_name) for
 * longitudinal negative-review tracking.
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

interface PlaceReview {
  name?: string;                             // places/{placeId}/reviews/{reviewId}
  rating?: number;
  text?: { text?: string; languageCode?: string };
  authorAttribution?: { displayName?: string };
  publishTime?: string;                      // ISO 8601
}

interface PlaceDetails {
  rating?: number;
  userRatingCount?: number;
  displayName?: { text?: string; languageCode?: string };
  reviews?: PlaceReview[];
}

interface GoogleReviewRow {
  date:          string;
  location_id:   number;
  brand_id:      number;
  total_reviews: number;
  avg_rating:    number;
  source:        string;
}

interface GoogleReviewTextRow {
  review_name:  string;   // places/{placeId}/reviews/{reviewId} — unique key
  location_id:  number;
  brand_id:     number;
  rating:       number;
  text:         string | null;
  author_name:  string | null;
  published_at: string | null;  // ISO 8601 timestamp
  language_code: string | null;
}

export interface GoogleReviewsEtlResult {
  date:              string;
  rows_upserted:     number;
  reviews_upserted:  number;
  log:               string[];
  errors:            string[];
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
      // Include reviews field to capture individual review texts
      "X-Goog-FieldMask": "rating,userRatingCount,displayName,reviews",
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
  const snapshotRows: GoogleReviewRow[]     = [];
  const reviewTextRows: GoogleReviewTextRow[] = [];
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

      // Daily snapshot row
      snapshotRows.push({
        date,
        location_id:   loc.locationId,
        brand_id:      loc.brandId,
        total_reviews: place.userRatingCount,
        avg_rating:    place.rating,
        source:        "places_api",
      });

      // Individual review texts (up to 5 most recent from Places API)
      for (const r of place.reviews ?? []) {
        if (!r.name) continue; // skip if no unique identifier
        reviewTextRows.push({
          review_name:  r.name,
          location_id:  loc.locationId,
          brand_id:     loc.brandId,
          rating:       r.rating ?? 0,
          text:         r.text?.text ?? null,
          author_name:  r.authorAttribution?.displayName ?? null,
          published_at: r.publishTime ?? null,
          language_code: r.text?.languageCode ?? null,
        });
      }

      log.push(
        `${loc.slug}: ${place.userRatingCount} reviews @ ${place.rating}` +
        (place.reviews?.length ? ` (${place.reviews.length} texts captured)` : ""),
      );
    } catch (e) {
      const msg = `${loc.slug}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      log.push(`ERROR — ${msg}`);
    }
  }

  const rowsUpserted = await upsert(
    "google_reviews",
    snapshotRows as unknown as Record<string, unknown>[],
    "date,location_id",
  );

  // Upsert individual reviews — on conflict keep existing captured_at
  // (review_name is the Places API unique ID; reviews don't change once posted)
  let reviewsUpserted = 0;
  if (reviewTextRows.length > 0) {
    reviewsUpserted = await upsert(
      "google_review_texts",
      reviewTextRows as unknown as Record<string, unknown>[],
      "review_name",
    );
  }

  return { date, rows_upserted: rowsUpserted, reviews_upserted: reviewsUpserted, log, errors };
}
