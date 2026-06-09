<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:revenue-etl-rules -->
# Revenue ETL — Cockpit Datasheet is the ONLY Source

All revenue data (Spa, Aesthetics, Slimming) is pulled from the **Cockpit datasheet**:
- Sheet ID: `195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a`
- Constants: `lib/constants/lapis-sheets.ts` (single source of truth for GIDs)
- Zero-auth CSV export: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}`

Tab → Supabase table mapping:
| Tab | GID | Supabase table |
|-----|-----|----------------|
| Service - Spa | 1281126329 | spa_revenue_daily (via lapis-revenue.ts) |
| Retail - Spa | 1170650850 | spa_revenue_daily (via lapis-revenue.ts) |
| Aesthetics | 2033734488 | aesthetics_sales_daily |
| Sales - Slimming | 1945063877 | slimming_sales_daily |
| Tx - Slimming | 1735295211 | slimming_treatments_daily |

**NEVER** reference the old Lapis POS sheet or use GIDs not listed in `lapis-sheets.ts`.
The nightly cron (`app/api/cron/nightly-refresh/route.ts`) triggers `revenue-refresh` which orchestrates all ETL feeds.
<!-- END:revenue-etl-rules -->
