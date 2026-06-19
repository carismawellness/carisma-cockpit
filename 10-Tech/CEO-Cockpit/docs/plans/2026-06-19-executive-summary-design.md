# Executive Summary — Design

**Date:** 2026-06-19
**Status:** Approved — building

## Goal

A single new dashboard, **Executive Summary**, that condenses every existing
dashboard (Sales, Finance, CRM, Marketing, Operations, HR, Funnel) into one
scrollable page for the selected time period. It surfaces each dashboard's key
metrics **and** its written commentary, plus a synthesized top-level "CEO
verdict" that rolls all 7 up. It is fully dynamic with the existing global date
filter — "the one place the CEO looks."

## Approved decisions

- **Data model:** Live recompute. Reuse the exact hooks + commentary engines the
  real dashboards use — guarantees parity to the cent, zero new Supabase tables.
- **Layout:** Single scrollable page.
- **Narrative:** Reuse each dashboard's existing templated commentary **and** add
  a new deterministic CEO roll-up. No LLM at view time.

## Architecture

### Route & nav
- New page `app/executive-summary/page.tsx`, wrapped in `<DashboardShell>` →
  inherits the global `DateRangeProvider` range automatically (no new filter
  code).
- New nav item in `lib/constants/departments.ts`, pinned to the **top** of the
  sidebar as the default landing view. Group `"General"`.
- Permission key `executive-summary` is auto-derived by
  `lib/constants/dashboards.ts`. Admins (the CEO) see it immediately; non-admins
  need the key granted in User Access (same as every dashboard — no migration).

### Self-contained sections (zero file contention)
Instead of one central orchestrator hook, **each department section owns its own
data** and reports a normalized summary up via callback. This keeps the 7 section
files fully independent so they can be built by parallel subagents without
touching a shared data layer.

```
ExecSummaryContent({ dateFrom, dateTo })
  ├─ collects DeptSummary objects via onSummary callback into state
  ├─ <CeoVerdictCard rollup={computeCeoRollup(summaries)} />
  ├─ <HeroKpiStrip summaries={summaries} />        // primary KPI + RAG per dept
  └─ <SalesSummarySection .../> ... <FunnelSummarySection .../>   // 7 sections
```

Each section component:
- Calls the **same hook(s)** its source dashboard uses with `dateFrom`/`dateTo`.
- Runs the **same commentary engine** function.
- Renders a compact `<SectionCard>`: 3–5 headline KPIs + verdict + top focus
  area + top win + "Open full dashboard →" (carries `?from&to`).
- Reports a normalized `DeptSummary` up via `onSummary(...)` in a `useEffect`.

### Shared contract — `lib/types/executive-summary.ts`
```ts
export type RAG = "GREEN" | "YELLOW" | "RED" | "NEUTRAL";
export interface DeptHeadlineKpi { label: string; value: string; deltaPct?: number; deltaLabel?: string; }
export interface DeptSummary {
  slug: string; label: string; path: string;
  rag: RAG; headline: string;          // verdict
  kpis: DeptHeadlineKpi[];             // 3–5; kpis[0] = the hero KPI
  focusAreas: string[]; wins: string[];
  loading: boolean;
}
export interface SectionProps { dateFrom: Date; dateTo: Date; onSummary: (s: DeptSummary) => void; }
```
All existing commentary results normalize cleanly: `overallState|overallRag` →
`rag`, `verdict` → `headline`, `focusAreas[].text|template` → `focusAreas`,
`wins[]` → `wins`.

### CEO roll-up — `lib/commentary/ceo-rollup.ts`
`computeCeoRollup(depts: DeptSummary[]): CeoRollup` — deterministic. Ranks depts
by severity (RED > YELLOW > GREEN > NEUTRAL); emits an overall RAG, a one-line
verdict, the 2–3 highest-priority focus areas pulled across all depts, and the
top wins. Consistent with the existing engine style.

## Build process (subagent orchestration)
1. **Coordinator (me)** builds the shared scaffolding: types contract,
   `SectionCard`, `ceo-rollup`, page + hero strip + CEO verdict card, nav item.
   Section components start as stubs so the page compiles.
2. **7 parallel subagents** — one per dashboard — each implements one isolated
   `components/executive-summary/<Dept>Summary.tsx` against the `SectionProps`
   contract, reading its source dashboard to replicate hooks + commentary.
3. **QC subagent** verifies each section's numbers match its source dashboard,
   the date range/filters propagate, and `npm run build` + lint pass.
4. Coordinator integrates, mirrors `10-Tech/CEO-Cockpit` → `Tech/CEO-Cockpit`,
   builds, commits, pushes (Vercel auto-deploys).

## Out of scope
- Sub-brand drill-downs (stay in the full dashboards).
- Stored/historical snapshots (live recompute only).
- Brand filter (not yet implemented app-wide).
