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

<!-- BEGIN:chart-labels-rule -->
# Charts — Always Show Values Without Hovering

**EVERY chart in this Cockpit MUST display permanent value labels. Never rely on Tooltip hover only.**

- **Bar charts (horizontal or vertical):** Add `<LabelList>` inside `<Bar>` with `position="right"` (horizontal) or `position="top"` (vertical). Increase the chart's right/top margin by at least 60px to prevent label clipping.
- **Line charts:** Add `<LabelList dataKey="..." position="top" style={{fontSize:10, fontWeight:700}} formatter={(v) => v != null ? \`\${v}%\` : ''} />` inside `<Line>`. Increase top margin to at least 24px.
- **Import:** Always import `LabelList` from `"recharts"` when building charts.
- **Formatters:** Apply appropriate unit suffix — `${v}%` for percentages, `${v}` for counts, `€${v}` for currency.

```tsx
// Bar chart example
<Bar dataKey="count" ...>
  <LabelList dataKey="count" position="right" style={{ fontSize: 12, fontWeight: 700, fill: '#1f2937' }} formatter={(v: unknown) => `${v}`} />
</Bar>

// Line chart example
<Line dataKey="pct" ...>
  <LabelList dataKey="pct" position="top" style={{ fontSize: 10, fontWeight: 700, fill: '#059669' }} formatter={(v: unknown) => v != null ? `${v}%` : ''} />
</Line>
```
<!-- END:chart-labels-rule -->

<!-- BEGIN:crm-data-source-rule -->
# CRM Data Sources — What Each Table Is and Is NOT

## Revenue (Spa, Aesthetics, Slimming)

**ALWAYS use brand revenue tables for any revenue display:**
| Brand | Correct table | Column |
|-------|--------------|--------|
| Spa | `spa_revenue_daily` | `services + product_*` |
| Aesthetics | `aesthetics_sales_daily` | `price_inc_vat` |
| Slimming | `slimming_sales_daily` | `paid` |

**NEVER use `crm_agent_daily.total_sales` as revenue.** It is agents' self-reported pipeline value from personal tracking sheets — not verified POS revenue. It will typically differ 5–10× from actual POS revenue and will NOT match GHL "Booking Won" values.

Root cause (discovered 2026-06-16): Agent tabs in CRM Master Sheet have a "Tot Sales" column (Q for SDR, R for Chat) where agents manually record attributed sales. These are not cross-validated against POS or GHL. The ETL copies them faithfully, but they are NOT revenue.

## Bookings (Slimming)

**`crm_agent_daily.total_booked`** = agent self-reported bookings across all channels. This differs from GHL "Booking Won" stage count because agents may record a booking for contacts that land in different GHL stages (e.g., "Active Member"). Always display with "agent-tracked" label so users understand the source.

A GHL pipeline stage webhook → Supabase ETL is required for exact GHL match (not yet built).

## Lead Reconciliation — Date Filter

The `crm_lead_reconciliation` table uses `date` = **lead creation date** (Date Added in GHL). NEVER document or suggest comparing it against GHL's "Last Stage Change Date" filter — those are different populations.

To match the Cockpit Lead Reconciliation numbers in GHL: filter by **"Date Added"** (not "Last Stage Change Date"). The Cockpit shows leads CREATED in the selected period; GHL's last-stage-change filter shows leads that moved to a new pipeline stage during that period, which is a completely different set.

## Data Flow Summary

```
GHL "Booking Won" value/count      ← not yet in Supabase (ETL needed)
CRM Master Sheet agent tabs        → crm_agent_daily (agent attribution; NOT revenue, NOT GHL counts)
Cockpit datasheet (Zoho/POS)       → spa_revenue_daily / aesthetics_sales_daily / slimming_sales_daily (AUTHORITATIVE revenue)
GHL lead creation events           → crm_lead_reconciliation (keyed on lead Date Added, NOT last stage change)
```
<!-- END:crm-data-source-rule -->
