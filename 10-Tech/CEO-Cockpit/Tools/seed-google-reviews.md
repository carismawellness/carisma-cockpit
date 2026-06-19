# Google Reviews ETL — Seed Notes (2026-06-10)

## What was seeded

`google_reviews` was seeded with one snapshot row per location for
**2026-06-10** (`source = 'maps_scrape'`), scraped live from each location's
Google Maps listing the same day:

| location_id | slug              | reviews | rating |
|-------------|-------------------|---------|--------|
| 1           | inter             | 778     | 4.6    |
| 2           | hugos             | 1,146   | 4.8    |
| 3           | hyatt             | 549     | 4.8    |
| 4           | ramla             | 988     | 4.9    |
| 5           | labranda          | 475     | 4.9    |
| 6           | odycy             | 749     | 4.9    |
| 7           | excelsior         | 176     | 4.8    |
| 8           | novotel           | 165     | 4.8    |
| 9           | aesthetics-clinic | 303     | 4.7    |
| 10          | slimming-clinic   | 17      | 5.0    |

## Seed method

1. For each location, opened the Google Maps listing (Playwright) and read
   listing name, rating, review count, and the listing ftid from the URL.
2. Extracted the `ChIJ…` place ID from the Google Search knowledge panel for
   the same business.
3. Verified each place ID by base64-decoding it and confirming it contains
   exactly the Maps listing's ftid pair (all 10 matched).
4. Upserted via PostgREST
   (`POST /rest/v1/google_reviews?on_conflict=date,location_id` with
   `Prefer: resolution=merge-duplicates`).

Place IDs are recorded in `lib/constants/google-places.ts`.

Note: Labranda Riviera is listed on Google as "Riviera Spa Resort" and
Sunny Coast (Odycy) as "AX Sunny Coast" — both verified as the correct
Carisma listings.

## Manual step for Mert — enable the daily ETL

The ongoing pipeline (`POST /api/etl/google-reviews`, which writes
`source = 'places_api'` rows) needs a Places API key:

1. In Google Cloud Console (any Carisma project), enable **Places API (New)**
   (`places.googleapis.com`).
2. Create an API key, restrict it to Places API (New).
3. Add `GOOGLE_PLACES_API_KEY=<key>` to:
   - `10-Tech/CEO-Cockpit/.env.local` (local dev)
   - Vercel project env vars (production) + redeploy
4. Verify: `curl -X POST https://carisma-support-u2vb.vercel.app/api/etl/google-reviews`
   — expect `{"status":"ok","rows_upserted":10,...}`.

Until the key exists, the route returns a clear
`GOOGLE_PLACES_API_KEY not set` error and logs a failed run in
`etl_sync_log` (source `google_reviews`).

Cost note: 10 Place Details (Essentials fields only: rating, userRatingCount,
displayName) per day ≈ 300 calls/month — well inside the free tier.
