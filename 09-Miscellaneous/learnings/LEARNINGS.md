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

### 2026-06-10 — Sheet-driven ETLs need per-tab header QC before deploy

**What happened:** The CEO-Cockpit `/api/etl/crm-agents` ETL was treating 7 of 12 CRM agents as the wrong layout (Chat vs SDR), because `SDR_AGENTS` only contained `nathalia`. As a result the Team Performance Dashboard showed values like Juliana = 25,251 bookings (which was actually her revenue €25,251 — written into the wrong DB column for months).

**Root cause:** I assumed sheet structure from the agent's role title (SDR vs Chat in the org chart) without reading each tab's header row in Google Sheets. The CRM Master Sheet has two layouts: Chat (A–T, LC/CRM/Other) and SDR (A–U, Outbound/Inbound/Chat) — and an agent's job title doesn't predict which layout their sheet owner used.

**Rule:** **ALWAYS** read every source-sheet tab's header row (`mcp__google-workspace__sheets_read_values <SheetId>!<Tab>!A1:Z2`) before wiring or modifying a sheet-backed ETL, and document the verified column→field map in the route file as a comment. Cell index assumptions silently produce wrong values; the dashboard will render plausible-looking numbers and nobody notices until a CEO QCs against the sheet.

**Rule:** **ALWAYS** after fixing a column-mapping bug in an ETL, force a full re-sync (TRUNCATE the target table or run with a wide date window) — `UPSERT on conflict (key, date)` won't overwrite rows that the new ETL no longer visits for those same dates. Stale rows persist invisibly.

**Rule:** **ALWAYS** verify the relevant OAuth refresh token works before claiming an ETL change is "live" (call the ETL endpoint, check for `invalid_grant`). The Vercel `GOOGLE_SHEETS_REFRESH_TOKEN` for the Cockpit project expires/revokes silently — re-auth flow lives at `~/.go-google-mcp/`.

**Distilled to:** Root `CLAUDE.md` Active Rules (sheet-ETL QC), and Tech/CEO-Cockpit/`CLAUDE.md` (post-fix re-sync requirement, Google token re-auth).

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
