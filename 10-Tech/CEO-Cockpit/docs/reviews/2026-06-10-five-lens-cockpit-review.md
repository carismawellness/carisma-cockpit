# CEO-Cockpit — Five-Lens Deep Review
**Date:** 2026-06-10
**Method:** 5 parallel specialist agents (Tech Infrastructure, UI/UX, Data Science, CEO/Strategy, Wellness-Industry Consultant), each performing an independent read-only audit of `10-Tech/CEO-Cockpit` (313 source files, 96 API routes, 26 ETL modules, 73 migrations, 33 pages).

---

## EXECUTIVE SUMMARY

**The verdict across all five lenses:** the cockpit's foundations — per-location EBITDA with drill-to-transaction, reconciliation engineering, funnel constraint detection, CRM telemetry, practitioner K% — are better than most PE portfolio dashboards. But it has four systemic problems that every agent independently found:

1. **It is publicly readable and writable.** Middleware deliberately exempts `/api/*`; ~80 of 96 routes (full P&L, payroll, CRM, settings mutations) are open to the internet, and the Supabase service-role key is hardcoded in the GitHub repo.
2. **It shows fiction next to fact, unlabeled.** Operations page (reviews, diligence audit), `/finance` page, RevenueForecast, and "booking efficiency" are hardcoded constants rendered as live metrics.
3. **Its intelligence layer is dead code.** AlertFeed, ExecutiveSummary, morning brief, CI chat, forecast, export, brand filter, error boundary, freshness indicators — all built, none mounted. `/` redirects to one brand's sales page; there is no executive home.
4. **It looks backward only.** No plan/budget/target layer, no cash, no forward bookings, no retention/cohort/outcome metrics — the cockpit reports a bad month after it happens and cannot warn of one.

Plus a set of **revenue-biasing correctness bugs** (refunds counted as positive revenue in Aesthetics, refunds zeroed in Slimming, off-by-one previous-period windows, undated rows leaking into weekly views, spa stale-upsert mode still live).

---

## CONVERGENT FINDINGS (flagged independently by 2+ agents)

| Finding | Flagged by |
|---|---|
| ~80 API routes unauthenticated + hardcoded service-role key in repo | Tech |
| Operations & `/finance` pages are hardcoded mock data without badges | Data, CEO, Wellness, UX |
| RevenueForecast card is 100% fabricated (hardcoded weeks + fake loading timer) | Data, CEO |
| No executive home; `/` → `/sales/spa` | UX, CEO |
| Entire CI/alert/brief/export/filter layer built but unmounted | UX, CEO, Tech |
| 3 incompatible ROAS definitions; VAT basis flips between (and within) pages | Data, CEO, UX |
| No plan/budget/target layer anywhere (only vs-LY) | CEO, Data |
| ETL failures and token expiry are silent (no alerting, no canary) | Tech, Data |
| Spa `spa_revenue_daily` still uses upsert-on-conflict → the documented stale-row bug class remains live | Data, Tech |
| No-show/cancelled rows deliberately discarded in ETL (`skipStatus`) | Wellness, Data |
| Client identity, service time, room, duration exist in source sheets but are dropped by live ETL | Wellness, Data |
| Date range resets on every page navigation; not in URL | UX, CEO |
| No tests, no CI pipeline, no error boundaries | Tech, UX |

---

## MASTER ACTION PLAN (deduplicated, prioritized)

### 🔴 P0 — Fix before anything else

**Security (Tech)**
1. **Auth-gate all `/api/*` routes.** Remove the blanket `/api/` exemption in `lib/supabase/middleware.ts`; allowlist only webhooks/cron (which verify themselves). ~80 routes currently expose P&L, payroll, CRM reads and settings mutations to the public internet. *(M)*
2. **Remove hardcoded service-role JWT from `lib/supabase/admin.ts` (+ anon key/URL in client.ts/server.ts/middleware.ts) and ROTATE the key in Supabase.** It is committed to GitHub. *(S)*
3. **Rotate + remove the GitHub PAT embedded in the `production` git remote URL.** *(S)*

**Data integrity (Data)**
4. **Fix Aesthetics refund handling** — `aesthetics-sales.ts:110` `Math.abs()` turns a −€500 refund into +€500 revenue. Preserve sign, full re-sync. *(S)*
5. **Replace or remove the fake RevenueForecast** (`components/dashboard/RevenueForecast.tsx:40-50`). Minimum: MTD ÷ elapsed business days × month business days with LY seasonality. *(M)*
6. **Stop publishing planning constants as measurements** — `BRAND_PLANNING_CONVERSION` (booking efficiency 5/15/12%) in constraint-heatmap and campaign-drilldown; flag `is_assumption` or compute actuals. *(S)*
7. **Fix off-by-one previous-period window** in `usePeriodComparison.ts` (30-day period compared to 29-day previous = systematic upward bias in every PoP delta). *(S)*
8. **One ROAS definition** (POS revenue ÷ Meta+Google spend = "Blended"; rename pixel numbers "Platform-attributed"); rename the marketing "Revenue" tile. *(M)*
9. **Label VAT basis everywhere and unify per page** — Spa page mixes inc-VAT and ex-VAT charts side by side; Group is ex-VAT. *(S)*

**Trust (CEO, Wellness, UX)**
10. **De-mock or badge the Operations page** — hardcoded reviews/diligence/facility data rendered under a live date label can mislead fraud/GM decisions. Badge every section or gate the route. Same for legacy `/finance` page. *(S)*
11. **Reliability: alert on ETL/cron failure** — nightly-refresh computes per-source ok/error and tells no one; wire failures into the existing `ci/notify` Resend path. Highest-leverage reliability fix given the documented silent `invalid_grant` history. *(M)*

**Executive value (CEO, UX)**
12. **Build a real executive home at `/`** — group MTD revenue & EBITDA vs plan and vs LY per brand, top 3 alerts, forward-bookings gauge, constraint verdict. Mostly assembly of existing components. *(M)*
13. **Add a plan/target layer** — monthly revenue + EBITDA budget per brand & location (seed from the Monthly KPIs/EBITDA sheet); render "vs Plan" on Group Sales, EBITDA v2, Longitudinal. The cockpit cannot currently answer "are we on plan?" *(M)*

**UX correctness (UX)**
14. **Persist date range in URL** (`useDateRange` → searchParams + localStorage). It silently resets to last month on every navigation — the #1 source of "pages disagree" confusion. *(S)*
15. **Fix mobile drawer permission bypass** — `Sidebar.tsx:375` maps raw `departments` instead of `visibleDepts`; restricted users see all departments on phone. One line. *(S)*
16. **Define the missing Tailwind tokens** — 41 files use `warm-*`/`charcoal`/`gold-bg`/`text-secondary` classes that have no `@theme` definition (lost in v3→v4 migration); the intended design system silently doesn't render. *(S)*
17. **Fix dark mode or remove the toggle** — content hardcodes light-mode grays; dark mode yields near-invisible text. *(S–M)*

### 🟠 P1 — High-value, next sprint(s)

**Security hardening (Tech)**
18. Dedicated `CRON_SECRET` (stop accepting service-role key as bearer token in CI routes); harden both cron endpoints (one trusts spoofable `x-vercel-cron`, one has no check).
19. Fix GHL webhook fail-open (`if (!secret) accept all` → fail closed).
20. Run CI chat SQL with the user's session client (RLS), not service role.
21. Lock down the public-CSV Cockpit sheet + unauthenticated Apps Script URL (both leak full revenue/ledger data; both committed to GitHub).

**Reliability (Tech, Data)**
22. Token-health canary (Zoho, Sheets, GHL, Talexio, Klaviyo) recorded to `etl_sync_log` + alert.
23. Wire `ETLLogger` into all ~18 ETLs (only 4 use it; `/api/etl/status` is blind to most pipelines).
24. Spa ETL: switch `spa_revenue_daily` to delete-range-then-insert + weekly full-history re-sync (closes the still-live stale-upsert failure mode).
25. Staleness sentinels: per-feed expected cadence, alert when a source silently stops updating.
26. Add test harness (Vitest) + first regression tests on CSV parsing, normalizeContact drift, zoho-line-extractor; add GitHub Actions lint/typecheck/build.

**Data correctness (Data, Wellness)**
27. Net Slimming refunds instead of zeroing (`slimming-sales.ts:143`).
28. Exclude/flag undated sales rows in sub-month windows (`sales/group/route.ts:104`).
29. Verify spa Quantity column (per house Active Rule: read the tab header) — unit price summed without quantity.
30. Stop overwriting Slimming `full_price` with `paid` — destroys installment/receivable tracking at ingestion.
31. Validate Meta lead action types (`lead` vs `leadgen_grouped`) — CPL/reconciliation may undercount.
32. Include Google spend in heatmap ROAS/CPL (currently Meta-only despite synced `google_campaigns_daily`).
33. Like-for-like monthly chart: render current month as partial (MTD vs LY-MTD), not full-month-vs-full-month.
34. Right-censoring handling in GHL cohort funnel (young cohorts read as conversion collapse).

**Executive/strategic capability (CEO)**
35. Forward bookings (next 2–4 weeks) from GHL/Fresha calendars → populate `appointments`, mount `AppointmentPipeline`. The single best leading indicator in this business.
36. Rewire `/api/ci/analyze` to real tables (it currently reads dead tables and uses `revenue = spend × 4` placeholder), schedule it + morning-brief in `vercel.json`, mount `AlertFeed` on home.
37. Cash dashboard from Zoho Books: bank balances, AR aging, AP, 13-week view.
38. Fix CI chat's fictional schema (system prompt describes tables that don't exist) — or keep it unmounted.
39. Same-store vs new-store growth split (`opened_date` on locations).
40. Location benchmarking table (EBITDA/room, RevPAH, K%, utilization per venue) — the M&A lens.
41. Turnover + key-person dependency ("top 3 therapists = X% of location revenue").

**Vertical operator metrics (Wellness)**
42. **No-show/cancellation dashboard** — stop discarding non-"Given" status rows in spa ETLs (one-line change unlocks it).
43. **Tox 90-day recall-compliance cohort + recall work-list** (Aesthetics) — computable today from `aesthetics_sales_daily`; typically 20–30% of medspa revenue.
44. **Consult→treatment conversion rate** (Aesthetics) — computable today; the #1 medspa sales KPI.
45. **Slimming active-patient census + week-by-week attrition curve** — from program starts + last-session dates.
46. **Weight-loss outcome capture** (weigh-ins via GHL custom fields or Cockpit tab) — the product is currently unmeasured.
47. Extend live Spa ETL to carry client identity, service time, room, duration, lead_type (historic backfill schema proves the source has them) — unlocks utilization, occupancy heatmaps, room yield, retention, lead-source attribution.
48. Therapist utilization % (treated hours ÷ Talexio scheduled hours — both halves already synced, never joined).
49. New-vs-returning mix + retention cohorts (Aesthetics/Slimming client names already in Supabase).
50. Rebooking-at-checkout rate via Fresha (occupancy-checker pipe exists).
51. Lead→customer→revenue identity join (GHL contacts ↔ sales client names) → real CAC, conversion lag, replaces modelled ROAS.
52. Membership/package/gift-card metrics: active members, redemption pace, liability, breakage (Zoho liability accounts + existing categories).
53. GLP-1/medication vs non-medication program mix flag.
54. De-mock diligence audit with a real ETL into the existing `diligence_audit` table (statuses + payment types largely already fetched).
55. Google Reviews ETL into the existing `google_reviews` table (Business Profile API, 10 locations).

**UX (UX)**
56. Decide canonical EBITDA pair; redirect/delete the two legacy generations (3 parallel implementations can disagree).
57. Mount error boundary at shell level; add `error.tsx`/`loading.tsx`.
58. Skeleton system replacing text "Loading…" (~20 pages, mechanical swap).
59. Surface ETL failure globally (SyncStatusWidget red state + per-card FreshnessIndicator).
60. Wire BrandFilter or strip the dead prop; restore real LY values on marketing hero KPIs (permanent "—" placeholders).
61. Consolidate 3 KPI-card components; one currency formatter (53 local definitions; €1.18M vs €1,180,500 vs €1.2M).
62. Data-driven CRM agent nav (12 hardcoded names; adding Angela = deploy).

### 🟡 P2 — Improvements & polish

63. Decompose 1,300-line aggregation routes; push rollups into SQL/materialized views; pre-materialize the Apps Script dependency nightly.
64. Zod validation on all mutating routes; shared route utilities (20 files reimplement date helpers).
65. Replace in-memory rate limiter (decorative across serverless instances).
66. Delete/protect `/api/debug/zoho-tags` + one-time seed endpoints; centralize ADMIN_EMAILS (5 copies, includes test accounts).
67. Timezone discipline (Europe/Malta vs server UTC; GHL windows off by evening hours).
68. VAT model as config (0.18 hardcoded ×5; 12% rate keyed to 3 hardcoded employee names).
69. Move hardwired rent rules + Apps Script token out of route code.
70. EBITDA: use daily spa actuals instead of smearing monthly across days; allocate wholesale by revenue ratio not ÷8.
71. Forecast-vs-actual tracking table (bias/MAPE) once forecast ships.
72. Repeat-rate + simple LTV; price/volume/mix decomposition of YoY change.
73. Board-pack export (mount ExportMenu; one-click PDF/Sheet monthly pack).
74. Ship-or-delete: keyboard shortcuts, onboarding tour, annotations, `/data` page, CI components cleanup (~600 lines dead weight).
75. Accessibility pass (charts invisible to screen readers; missing aria-labels; 10px tick text), mobile chart ergonomics, tab the 7-section Spa page into Overview/Staff/Payments.
76. Exceptions-first strip on every page header (alerts API + severity model already exist).
77. Seasonality vs Malta tourist arrivals overlay (historic 2014–2023 norms + NSO data).
78. Maintenance-program conversion, adherence/missed check-ins (Slimming); adverse-event + photo-compliance log (Aesthetics — also M&A diligence posture); device ROI; waitlist depth; couples/group bookings; items-per-ticket/retail attach; online booking share; hotel-partner economics (capture rate, rent-vs-revenue per venue); repo hygiene (duplicate migration numbers, stray files).

---

## AGENT-BY-AGENT HIGHLIGHTS

### 1. Tech Infrastructure (Principal Engineer lens)
- **Strengths:** clean layering (routes→ETL→helpers→hooks), idempotent upserts, pagination guard against PostgREST 1000-row truncation, real rate-limit handling (Klaviyo Retry-After, Zoho limiter), `Promise.allSettled` nightly orchestration with dependency phases, strict TS with only 18 `any` across 313 files, zero TODOs, dated design docs for every feature.
- **Critical:** middleware exempts `/api/*` (≈80/96 routes public, including settings mutations on service-role clients); service-role JWT hardcoded & committed; GitHub PAT in git remote; GHL webhook fails open when secret unset; zero tests; zero CI; zero error boundaries; ETL failures alert no one.

### 2. UI/UX (Product Design lens)
- **Strengths:** flagship Spa sales page (YoY badges, honest empty/error/sync states), CRM "Live vs date-scoped" segregation, deliberate mobile engineering (44px targets, safe-area insets), brand palette tokens genuinely used, value labels on bars standard.
- **Critical:** no executive home; ~18 built-but-unmounted components (the entire intelligence layer); dead notification bell; date range resets per navigation; 41 files reference undefined Tailwind utilities; broken dark mode; 3 EBITDA generations live simultaneously; mobile drawer leaks restricted nav; Operations static data under a live date label.
- **Scorecard:** IA C−, Design system C, Data viz B+, State C+, Interaction C−, Responsive/a11y B−, Cognitive load B−.

### 3. Data Science (Analytics Engineering lens)
- **Strengths:** zoho-pl-reconcile is genuine reconciliation engineering (signed netting, €1 tolerance, materiality-sorted drift); delete-then-insert for AES/SLIM internalized the past staleness lesson; fallback estimation is logged and auditable; ratio aggregation mostly correct (lead-weighted conversions).
- **Critical:** fabricated forecast; constants-as-metrics; 3 ROAS definitions; refund sign bugs both directions; off-by-one PoP windows; undated-row leakage; no like-for-like adjustment anywhere; no lead→sale identity join (no real CAC); spa stale-upsert mode still live; no statistical rigor (no run-rate, no business-day alignment, average-of-averages in Google CPC).
- Traced group revenue, EBITDA, and funnel ROAS end-to-end; estimated items 1–6 ≈ 2–3 days of work to materially restore trust.

### 4. CEO / Strategy (Operator lens)
- **Strengths:** per-location four-wall EBITDA with drill-to-transaction and source badges is "PE-diligence-grade"; constraint heatmap embodies the right operator mental model; practitioner K% rare at this scale; data-honesty culture (badges, recon, freshness).
- **Critical:** "a strong rear-view diagnostic instrument, not a steering instrument." Fails the 5-minute test at second zero. No plan layer (the only target in the app is a hardcoded 30% margin line), no cash (EBITDA-positive companies die of cash; Zoho already connected), 100% lagging indicators (no forward bookings despite calendars being integrated), Slimming treated as a till rather than a recurring medical-program business, no M&A/expansion lens despite active acquisition strategy, CI built on a fictional schema with `revenue = spend × 4` placeholders.
- "Items 1–6 are one focused sprint and would transform it from 'analyst tool the CEO visits' into 'the first screen the CEO opens every morning.'"

### 5. Wellness Industry Consultant (Medspa/Weight-loss/Spa operator lens)
- **Strengths:** money-in side is strong — revenue cuts, YoY discipline, K%, STL/SDR accountability, constraint thinking, hotel-channel mix, discount-depth tracking.
- **Critical — the three compounding engines are unmeasured:**
  - **Retention:** no repeat/cohort/recall metrics despite client names sitting in Supabase; tox-cycle compliance (the single biggest aesthetics retention lever) absent but computable today.
  - **Capacity:** live ETL drops time/room/duration that the source demonstrably captures → no utilization, no occupancy heatmaps, no yield management.
  - **Outcomes:** the Slimming brand sells weight loss and measures none of it — no census, no attrition curve, no outcome data, and the ETL destroys installment data at ingestion (`full_price = paid`).
- Cheapest high-leverage fixes: stop filtering out cancelled/no-show rows (one line), compute tox-recall + consult-conversion from data already in the warehouse, extend the spa ETL to carry the fields the sheet already has.

---

## SUGGESTED SEQUENCING

- **Sprint 0 (days):** Items 1–3 (security), 4–7 (data bugs), 10 (de-mock badges), 15–16 (one-liners). Mostly S-effort.
- **Sprint 1 (week):** 11 (ETL alerting) + 22 (token canary), 12–13 (executive home + plan layer), 14 (URL date range), 8–9 (metric unification).
- **Sprint 2 (week):** 35 (forward bookings), 36 (alert engine), 42–45 (no-show, tox recall, consult conversion, slimming census) — all computable from existing data.
- **Then:** cash dashboard, utilization (ETL field extension), lead→revenue join, retention cohorts, benchmarking/M&A views, board pack.

*Full agent transcripts available in session history (agent IDs: tech a1dba9c58eacc695a, ux a05f12cb21b81d7db, data a09a877da69093087, ceo a456d3e44d7753729, wellness ab17bae61bdce1933).*
