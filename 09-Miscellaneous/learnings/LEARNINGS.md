# System Learnings Log

> Every mistake becomes a rule. Every rule reduces future mistakes.
> Based on Boris Cherny's compounding engineering pattern.

---

## How to Use This Log

1. **When an agent makes an error** — add a timestamped entry in the relevant section below
2. **Distill each entry** into an ALWAYS/NEVER directive in the relevant CLAUDE.md file's `### Active Rules` section
3. **Review monthly** — remove outdated entries, promote recurring patterns to permanent rules
4. **Cross-pollinate** — if a learning in one brand applies universally, move it to Universal Rules

## Meta-Rules: How to Write Good Rules

- **Use absolute directives:** Start with ALWAYS or NEVER
- **Lead with rationale:** Explain WHY before stating the rule
- **Include a concrete example:** Show the wrong way and the right way
- **One rule per mistake:** Don't bundle multiple lessons into one entry
- **Keep it concise:** Bullets, not paragraphs. If it takes more than 3 lines, you're over-explaining.

### Rule Quality Checklist
- [ ] Does it start with ALWAYS or NEVER?
- [ ] Is the rationale clear in one sentence?
- [ ] Is there a concrete example?
- [ ] Would a new agent understand it without additional context?

---

## Universal Rules

> Apply to ALL agents across every brand. Distill to root CLAUDE.md.

<!--
Entry format:
### [YYYY-MM-DD] — [Short Title]
**What happened:** Brief description of the error
**Root cause:** Why it happened
**Rule:** ALWAYS/NEVER directive
**Distilled to:** [file path where the rule was added]
-->

### 2026-06-25 — Talexio roster location lives in `workShifts.costCentre`, NOT labels or GPS (a wrong discovery conclusion cost a rebuild)

**What happened:** The first Dynamic Location Wage Attribution ETL split wages by GPS clock-ins, producing wrong results (everyone ~100% to home, odd fractions like 94.4%). A prior "Agent 0" discovery had sampled shift `label` fields (all empty) and concluded "shifts carry no location," steering the design to GPS + org unit. The CEO rejected it: he wanted splits based on the ROSTER (days rostered per location). A second discovery agent found the location WAS on every shift all along — in `workShifts { costCentre { id name } }`, a field the original shift query never requested.

**Root cause:** Agent 0 generalized "the `label` field is empty" into "there is no location on shifts" without probing other candidate fields on the `WorkShift` type. The Talexio GraphQL API has introspection DISABLED and hides field errors behind a generic "unexpected error", so the only way to map the schema is to TRY candidate sub-fields one at a time and see which return data. `costCentre` returns real data; `organisationUnit`/`location`/`businessUnit`/etc. on the shift all error.

**Rule:** **NEVER** conclude a data field "doesn't exist" from one empty/queried field — on an introspection-disabled API, probe every plausible candidate field name one-by-one before declaring absence. A confident-but-unprobed "it's not there" sent an entire ETL down the wrong (GPS) path.

**Rule:** **ALWAYS** split Talexio location attribution by the ROSTER: `split% at location L = rostered working shifts at L ÷ total working shifts in period`. Resolve each shift's location from `costCentre` (map id 8091-8096 / name → canonical slug), falling back to the employee's home `organisationUnit` when `costCentre` is null (~45% of shifts are untagged). Only `type ∈ {SHIFT, FLEXIBLE_SHIFT}` count as worked; exclude OFF/REST/APPROVAL_BLOCK.

**Additional facts:**
- costCentre names ≠ org-unit names ("Hyatt Regency Malta" cost centre vs "Hyatt" org unit) — normalize BOTH to a canonical slug or a single-location employee falsely looks split.
- Talexio org unit spells it "Riveira" (NOT "Riviera"); costCentre "Sunny Coast" → slug `odycy`; "Labranda Riviera Hotel & Spa" → `labranda`.
- Payslips run ~1 month behind: when a month has no payslip, EXTRAPOLATE from the most recent prior month's gross (`wage_source='extrapolated'`). June 2026 had ZERO real payslips — 100% extrapolated from May.
- **Skip employees with €0 resolved gross entirely** — no payslip means no wage to attribute; emitting their rows clutters per-location lists and mislabels source. (QC caught zero-gross rows mislabeled `wage_source='payslip'`.)
- For arbitrary date ranges (e.g. a 7-day dashboard view), store PER-DAY rows (`employee_location_splits_daily`, one row per working shift, `wage_share = gross ÷ working_shifts_in_month`) and SUM `wage_share` over `work_date BETWEEN from AND to`. Put the rounding remainder on the last row so each employee's sum == gross exactly (group invariant: total_attributed == total_monthly_gross to the cent).

**Distilled to:** Talexio-specific; captured in `Tech/CEO-Cockpit/app/api/etl/talexio-location-splits/route.ts` comments + memory `project_talexio_location_attribution.md`.

---

### 2026-06-22 — GSC ETL failed due to `GOOGLE_REFRESH_TOKEN` shadowing `GOOGLE_SHEETS_REFRESH_TOKEN`

**What happened:** GSC keyword positions showed as 0.0 in the CEO Cockpit marketing dashboard despite having data in Supabase. ETL calls returned `{"status":"error","error":"OAuth: invalid_grant"}` even after updating `GOOGLE_SHEETS_REFRESH_TOKEN` on Vercel.

**Root cause:** The ETL code uses `process.env.GOOGLE_REFRESH_TOKEN ?? process.env.GOOGLE_SHEETS_REFRESH_TOKEN` — checking `GOOGLE_REFRESH_TOKEN` first. A separate `GOOGLE_REFRESH_TOKEN` env var was added to Vercel on Jun 11 and had since expired, silently overriding the still-valid `GOOGLE_SHEETS_REFRESH_TOKEN`.

**Rule:** ALWAYS when GSC ETL returns `invalid_grant`, update BOTH `GOOGLE_REFRESH_TOKEN` and `GOOGLE_SHEETS_REFRESH_TOKEN` in Vercel — `GOOGLE_REFRESH_TOKEN` takes precedence in the ETL and will silently block auth if expired.

**Distilled to:** Root CLAUDE.md `### Active Rules`

---

### 2026-06-10 — Sheet-driven ETLs need per-tab header QC before deploy

**What happened:** The CEO-Cockpit `/api/etl/crm-agents` ETL was treating 7 of 12 CRM agents as the wrong layout (Chat vs SDR), because `SDR_AGENTS` only contained `nathalia`. As a result the Team Performance Dashboard showed values like Juliana = 25,251 bookings (which was actually her revenue €25,251 — written into the wrong DB column for months).

**Root cause:** I assumed sheet structure from the agent's role title (SDR vs Chat in the org chart) without reading each tab's header row in Google Sheets. The CRM Master Sheet has two layouts: Chat (A–T, LC/CRM/Other) and SDR (A–U, Outbound/Inbound/Chat) — and an agent's job title doesn't predict which layout their sheet owner used.

**Rule:** **ALWAYS** read every source-sheet tab's header row (`mcp__google-workspace__sheets_read_values <SheetId>!<Tab>!A1:Z2`) before wiring or modifying a sheet-backed ETL, and document the verified column→field map in the route file as a comment. Cell index assumptions silently produce wrong values; the dashboard will render plausible-looking numbers and nobody notices until a CEO QCs against the sheet.

**Rule:** **ALWAYS** after fixing a column-mapping bug in an ETL, force a full re-sync (TRUNCATE the target table or run with a wide date window) — `UPSERT on conflict (key, date)` won't overwrite rows that the new ETL no longer visits for those same dates. Stale rows persist invisibly.

**Rule:** **ALWAYS** verify the relevant OAuth refresh token works before claiming an ETL change is "live" (call the ETL endpoint, check for `invalid_grant`). The Vercel `GOOGLE_SHEETS_REFRESH_TOKEN` for the Cockpit project expires/revokes silently — re-auth flow lives at `~/.go-google-mcp/`.

**Distilled to:** Root `CLAUDE.md` Active Rules (sheet-ETL QC), and 10-Tech/CEO-Cockpit/`CLAUDE.md` (post-fix re-sync requirement, Google token re-auth).

### 2026-06-16 — Google Ads rootDirectory mismatch caused all ETL fixes to silently fail

**What happened:** The CEO-Cockpit Google Ads ETL showed ~7× lower spend than Google Ads Manager (Spa: €70.8 vs $491.43, Aesthetics: €12.1 vs $125.58). Three separate fixes were applied over a full session — v21 API upgrade, MCC header removal, frankfurter URL fix, USD→EUR currency detection — yet every ETL call still returned wrong numbers.

**Root cause:** `.vercel/project.json` has `"rootDirectory": "Tech/CEO-Cockpit"` but the local filesystem has `10-Tech/CEO-Cockpit/` (the directory was renamed). All code changes went to `10-Tech/CEO-Cockpit/` while Vercel kept building the old code from `Tech/CEO-Cockpit/` in the GitHub repo. Nothing deployed. The deployed code ran v20 (deprecated per-account by Google), used `api.frankfurter.app` (301 redirect, so FX calls silently fell back to 0.92 — but even that didn't fire because currency detection was missing), and stored raw USD values as EUR in Supabase.

**Rule:** **ALWAYS** verify which directory Vercel is building from before applying any ETL fix — check `.vercel/project.json` `rootDirectory` and confirm it matches the local path of the file you're editing. A successful git push ≠ a successful deploy if the build root is a different directory.

**Rule:** **ALWAYS** confirm the new code is actually live after deploy by checking for a unique marker in the ETL log response (e.g., `[etl] using https://...v21`). If the marker is absent, the old code is running.

**Rule:** **NEVER** assume `api.frankfurter.app` works — it returns a 301 redirect that Vercel edge functions may not follow. Use `api.frankfurter.dev/v1/latest?from=USD&to=EUR` directly.

**Rule:** **ALWAYS** include `customer.currency_code` in every Google Ads GAQL SELECT and apply USD→EUR conversion before storing to Supabase. Spa (5355967868) and Aesthetics (6561523786) are USD accounts; Slimming (2186664413) is EUR.

**Distilled to:** Root `CLAUDE.md` Active Rules.

---

## Brand-Specific Rules

### Carisma Spa & Wellness (Sarah)

> Distill to `CRM/CRM-SPA/CLAUDE.md` Active Rules section.

<!-- Entry format same as above -->

_No entries yet._

### Carisma Aesthetics (Sarah)

> Distill to `CRM/CRM-AES/CLAUDE.md` Active Rules section.

<!-- Entry format same as above -->

_No entries yet._

### Carisma Slimming (Katya)

> Distill to `CRM/CRM-SLIM/CLAUDE.md` Active Rules section.

<!-- Entry format same as above -->

_No entries yet._

---

## Workflow Learnings

> Execution issues, API quirks, tool failures, better methods discovered.
> Distill to the relevant workflow's "Known Issues & Learnings" footer.

<!-- Entry format same as above, plus:
**Workflow:** [workflow filename]
-->

_No entries yet._

---

## Skill Learnings

> Customer interaction patterns that skills didn't anticipate.
> Distill to the relevant skill's "Edge Cases Discovered" footer.

<!-- Entry format same as above, plus:
**Skill:** [skill filename]
**Brand:** [SPA/AES/SLIM]
-->

_No entries yet._

---

## Changelog

| Date | Entry | Category | Distilled To |
|------|-------|----------|-------------|
| 2026-03-01 | System initialized | Setup | All CLAUDE.md files |
| 2026-06-10 | Sheet-driven ETL header QC | Universal | Root CLAUDE.md |
| 2026-06-16 | Google Ads rootDirectory mismatch + v21 + FX conversion | Universal | Root CLAUDE.md |
