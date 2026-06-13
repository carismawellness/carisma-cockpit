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
