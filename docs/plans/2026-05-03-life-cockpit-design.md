# Life Cockpit — Strategic Design

**Date:** 2026-05-03
**Owner:** Mert Gulen
**Status:** Approved (3 pillars locked, Health → Love sequencing locked, monorepo architecture locked)

---

## Vision

A personal Life Cockpit modeled on the existing CEO Cockpit, organised around three pillars: **Health, Wealth, Love**. The Wealth pillar embeds the live CEO Cockpit so business intelligence stays inside one shell. Health and Love are net-new dashboards built to a strict minimum-effective-dose discipline.

The cockpit's purpose is *decision support*, not journaling. Every module home view shows ≤5 numbers + 1 chart + 1 action. Manual data entry is capped at ≤1 number/day per module. If a module is opened <10x in a 90-day window, it is deleted.

## Top-Level Architecture — Three Pillars

```
Life Cockpit
├── Health  — biology, state, performance (physical + mental)
├── Wealth  — business + personal capital
└── Love    — relationships + identity + experiences
```

**MECE rule:** every life domain maps to exactly one pillar. Mental health and cognitive baseline → Health (biology of the mind). Reading, learning, hobbies, journaling → Love (identity + growth). Look Book → Love (self-presentation). Grooming/skincare protocols → Health (regimen). Personal finance + business equity → Wealth.

## Health Pillar — 7 Modules (MECE)

| # | Module | What it owns |
|---|---|---|
| 1 | Health Stack | What you DO — supplements, protocols, recovery doses (sauna/cold/zone 2), grooming regimen |
| 2 | Health Records | What's been MEASURED clinically — Bloodwork Vault (optimal-vs-normal bands), imaging archive, screening calendar, meds, vaccines, family history, providers, visit log |
| 3 | WHOOP Live | Continuous wearable signal — recovery, sleep, strain, HRV (auto-pulled from existing `Tools/whoop/`) |
| 4 | Body Composition | Anthropometrics + metabolic — DEXA, weight trend, BP, CGM windows, nutrition signal (protein/fiber/eating window) |
| 5 | Performance | Functional benchmarks — VO2 max trajectory, 5 lifts, grip strength, dead hang, gait speed |
| 6 | Mental & Cognitive | 1-tap daily mood/energy/focus, meditation streak, quarterly cognitive battery |
| 7 | Biological Age Scorecard (HERO) | 8 numbers synthesized: DunedinPACE • VO2 max %ile • ApoB • Lp(a) • DEXA ALMI • grip • HbA1c+fasting insulin • deep sleep min/night |

## Love Pillar — 7 Modules (MECE)

| # | Module | What it owns |
|---|---|---|
| 1 | Look Book | Wardrobe + outfits — closet grid, slot-based outfit builder (Konva canvas in v2), AI "build me an outfit," weather + calendar integration, packing planner, before/after grooming photos |
| 2 | Inner Circle | Top 25 friends/mentors/network — last contact, cadence target, gift ideas, notes thread |
| 3 | Family Ledger | Family-only — parents/siblings/extended — with the "remaining encounters" counter |
| 4 | Travel | World map: been / want / planned — trip ratings, photo memories, wanderlist |
| 5 | Hobbies & Learning | Practice logs, reading list, deep-work hours — only for committed hobbies |
| 6 | Goals & Vision | Annual theme + personal OKRs + bucket list (one timeline of intent across three time horizons) |
| 7 | Reflection | Weekly review (10 questions) + monthly highlights + annual review (Ferriss template). Ambient "on this day" photo widget lives here. |

## Wealth Pillar — 2 Modules

| # | Module | What it owns |
|---|---|---|
| 1 | Business | Live-embedded CEO Cockpit at `/wealth/*` (departments: ceo/crm/finance/hr/marketing/ops/sales) |
| 2 | Personal Capital | Liquid NW + illiquid (Carisma equity) + Years of Freedom metric (= liquid NW ÷ annual personal burn) |

## North-Star Metrics (5-year)

- **Health:** VO2 max
- **Wealth:** Years of Freedom (liquid NW ÷ annual personal burn)
- **Love:** # of 1:1 conversations ≥30 min in last 30 days

## Build Philosophy — 4 Guardrails

1. **Auto-pulled data only.** Manual entry capped at ≤1 number/day. Never ban sliders.
2. **One screen, one decision.** Every module surfaces exactly one action.
3. **Read-mostly.** Cockpit reads life state; Day One handles journaling.
4. **Quarterly cull.** Modules opened <10x in 90 days get deleted, no exceptions.

## Architecture (Revised — 2026-05-03)

**Key principle:** CEO Cockpit stays standalone (shareable with team). Life Cockpit is separate (private to Mert). Wealth pillar **mirrors** CEO Cockpit via iframe — does not absorb or migrate it.

- **CEO Cockpit:** stays at `Tech/CEO-Cockpit/`, deployed at existing Vercel project `cockpit-run`. Untouched. Shareable.
- **Life Cockpit:** new separate Next.js app at `Tech/Life-Cockpit/`, deployed to new Vercel project. Private to Mert (single user, RLS-enforced).
- **Wealth pillar mirror:** iframe embedding the live CEO Cockpit URL inside Life Cockpit's `/wealth/*` route. Same Supabase project = same auth session = single login for Mert. (Phase 5: upgrade to reverse-proxy via Vercel rewrites once a custom root domain is set up so cookies share via `.<root>`.)
- **Shared Supabase project:** `praceahubcvbrewuqejh.supabase.co`. CEO Cockpit owns `business` schema; Life Cockpit owns new schemas `health`, `wardrobe`, `life`. RLS on every table from day one.
- **No monorepo for now.** Each app is independent. Shared styling via convention (same Tailwind tokens, same shadcn primitives copied) — extracted into shared packages later only if pain emerges.
- **Stack:** Next.js 16 + React 19 + Tailwind v4 + shadcn/ui + Recharts + Supabase SSR + TanStack Query (matches CEO Cockpit exactly).
- **Deferred to later phases:**
  - Cloudflare R2 + Cloudflare Images (Look Book images) — Phase 1 uses Supabase Storage
  - fal.ai BiRefNet (garment cutout AI) — Phase 1 uses raw photos
  - Custom root domain + reverse-proxy + cookie-domain SSO — Phase 5
  - Claude Sonnet 4.5 vision (lab PDF parser + outfit AI) — Phase 5
  - Railway Python crons for non-WHOOP integrations — Phase 5

## Database — Single Supabase Project, Schema-per-Pillar

```
schema: business   (existing — preserved as-is)
schema: health     (whoop_*, labs_*, imaging, screenings, body_comp, performance, mental, stack)
schema: wardrobe   (garments, outfits, outfit_items, wear_log)
schema: life       (inner_circle, family, travel, hobbies, goals, reflection)
```

Every table: `user_id uuid references auth.users` + RLS policy `auth.uid() = user_id`. App-level roles via `auth.jwt() ->> 'role'` for future sharing (spouse, accountant).

## Dummy Data Strategy

Every module ships with a `seed/` directory of realistic synthetic data. Switch flag `USE_DUMMY_DATA=true` determines whether the module pulls from real sources or seed files. From end of Phase 2, the entire Health pillar appears fully populated visually, even though only WHOOP has live data flowing. Decisions about cutting modules are made by seeing them, not imagining them.

Examples:
- Bloodwork Vault → 4 years of quarterly labs with realistic ApoB/Lp(a)/HbA1c trends
- Body Composition → 90 days of weight/BP, 6 quarterly DEXAs, 1 CGM window
- Look Book → 30 garments (photographed cutouts) + 12 saved outfits
- Inner Circle → 25 contacts with cadence + last-touch dates
- Travel → 20 trips pinned on world map with photos

## Sequencing — Health → Love (Locked)

| Phase | ~Weeks | Scope |
|---|---|---|
| 1 | 3 | Monorepo + shell + nav + Wealth proxy + WHOOP module live |
| 2 | 5 | Health Records + Body Composition + Performance + dummy-data framework |
| 3 | 4 | Mental & Cognitive + Biological Age Scorecard + Health Stack + Look Book MVP |
| 4 | 4 | Inner Circle + Family Ledger + Travel + Goals & Vision + Reflection + Hobbies |
| 5 | 2 | Personal Capital under Wealth + outfit Konva canvas + AI features (lab PDF parser, outfit suggestions) |

Total: ~18 weeks part-time with Claude Code.

## Risks & Mitigations

1. **Moving CEO Cockpit into monorepo could break Vercel deployment.** Mitigation: do the move in a worktree, verify build + deploy preview before merging.
2. **Cookie domain misconfig → auth loops.** Mitigation: test SSO across both subdomains as part of Phase 1 acceptance criteria.
3. **Look Book scope creep.** Mitigation: ship slot-based picker first; Konva canvas waits for Phase 5.
4. **Lab PDF parser variance across providers.** Mitigation: schema-on-read (store raw JSON + extract typed columns lazily as needed).
5. **Manual-entry maintenance prison.** Mitigation: enforce 4 Guardrails as hard rules in code review.

## Success Criteria

- Phase 1 acceptance: opening `life.<root>/wealth/finance` shows the live CEO Cockpit finance dashboard inside the Life Cockpit nav shell, authenticated via shared Supabase session, working on Safari + iOS.
- Phase 2 acceptance: Health pillar fully visible with dummy data; user can flip `USE_DUMMY_DATA=false` and see real WHOOP data flow into the WHOOP module.
- Final acceptance (end of Phase 5): user opens cockpit daily, makes ≥1 decision per session, and has not abandoned any pillar within 90 days of launch.
