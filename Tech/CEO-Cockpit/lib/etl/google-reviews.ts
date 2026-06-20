/**
 * Google Reviews ETL
 *
 * Two jobs per run:
 *   1. Aggregate snapshot  → google_reviews (one row per location per day)
 *   2. Individual texts    → google_review_texts (one row per review, longitudinal)
 *
 * Place IDs live in lib/constants/google-places.ts (verified 2026-06-10).
 * The Places API (New) returns at most 5 most-recent reviews per place.
 * Running nightly accumulates new reviews over time via UNIQUE(review_name).
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
  name?: string;          // "places/{placeId}/reviews/{reviewId}" — unique key
  rating?: number;
  text?: { text?: string; languageCode?: string };
  authorAttribution?: { displayName?: string };
  publishTime?: string;   // ISO timestamp e.g. "2026-04-15T10:23:00Z"
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
  review_name:  string;
  location_id:  number;
  brand_id:     number;
  rating:       number;
  text:         string | null;
  author_name:  string | null;
  published_at: string | null;
}

export interface GoogleReviewsEtlResult {
  date:           string;
  rows_upserted:  number;
  texts_upserted: number;
  log:            string[];
  errors:         string[];
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
  const rows: GoogleReviewRow[]         = [];
  const textRows: GoogleReviewTextRow[] = [];
  const log: string[]                   = [];
  const errors: string[]                = [];

  for (const loc of GOOGLE_PLACES_LOCATIONS) {
    try {
      const place = await fetchPlace(loc, apiKey);
      if (place.userRatingCount == null || place.rating == null) {
        throw new Error(
          `Places API returned no rating data (displayName="${place.displayName?.text ?? "?"}")`,
        );
      }

      // Aggregate snapshot row
      rows.push({
        date,
        location_id:   loc.locationId,
        brand_id:      loc.brandId,
        total_reviews: place.userRatingCount,
        avg_rating:    place.rating,
        source:        "places_api",
      });

      // Individual review text rows (up to 5 per place from Places API)
      const reviews = place.reviews ?? [];
      for (const review of reviews) {
        if (!review.name || review.rating == null) continue;
        textRows.push({
          review_name:  review.name,
          location_id:  loc.locationId,
          brand_id:     loc.brandId,
          rating:       review.rating,
          text:         review.text?.text ?? null,
          author_name:  review.authorAttribution?.displayName ?? null,
          published_at: review.publishTime ?? null,
        });
      }

      log.push(
        `${loc.slug}: ${place.userRatingCount} reviews @ ${place.rating}` +
        (reviews.length > 0 ? ` (${reviews.length} texts fetched)` : ""),
      );
    } catch (e) {
      const msg = `${loc.slug}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      log.push(`ERROR — ${msg}`);
    }
  }

  const rowsUpserted = await upsert(
    "google_reviews",
    rows as unknown as Record<string, unknown>[],
    "date,location_id",
  );

  let textsUpserted = 0;
  if (textRows.length > 0) {
    textsUpserted = await upsert(
      "google_review_texts",
      textRows as unknown as Record<string, unknown>[],
      "review_name",
    );
    log.push(`Upserted ${textsUpserted} review text rows`);
  }

  return { date, rows_upserted: rowsUpserted, texts_upserted: textsUpserted, log, errors };
}
