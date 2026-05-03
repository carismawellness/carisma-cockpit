# Life Cockpit — Phase 1 Implementation Plan

**Date:** 2026-05-03
**Goal:** Ship a deployable Life Cockpit with all 16 modules visually populated (dummy data), WHOOP module connected to live data, and the Wealth pillar mirroring the existing CEO Cockpit. User can open the cockpit and decide what to cut by seeing it.

## Acceptance Criteria

1. `Tech/Life-Cockpit/` exists as a standalone Next.js 16 app
2. App runs locally (`npm run dev`) and opens to a 3-pillar dashboard (Health / Wealth / Love)
3. Every Health module (7) and Love module (7) has a dedicated page, populated with realistic dummy data
4. WHOOP module shows real data from existing `Tools/whoop/` (with dummy fallback when `USE_DUMMY_DATA=true`)
5. Wealth tab embeds CEO Cockpit via iframe; clicking sub-tabs navigates within the iframe
6. App deploys cleanly to a new Vercel project named `life-cockpit`
7. CEO Cockpit's existing `cockpit-run` Vercel project is untouched and still works

## Build Order (sequential where required, parallel where possible)

### Step 1 — Scaffold (sequential, ~10 min)
- Branch: `life-cockpit-phase1`
- Create `Tech/Life-Cockpit/` directory
- Copy minimal config from `Tech/CEO-Cockpit/`: `package.json` (renamed), `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `components.json`, `.gitignore`
- `npm install` (dependencies match CEO Cockpit)

### Step 2 — Shell (sequential, ~20 min)
- `app/layout.tsx` — root layout with sidebar nav (Health / Wealth / Love)
- `app/page.tsx` — landing dashboard with 3 hero tiles (one per pillar)
- `components/nav/sidebar.tsx` — collapsible 3-pillar nav with all module sub-routes
- `components/ui/*` — copy shadcn primitives from CEO Cockpit (Button, Card, Tabs, etc.)
- `app/globals.css` — same Tailwind theme as CEO Cockpit
- `lib/dummy-data.ts` — typed seed loader, gated by `USE_DUMMY_DATA` env flag

### Step 3 — Parallel module build-out (3 agents)

Dispatched concurrently after shell exists:

**Agent A — Health pillar (7 module pages with dummy data)**
- `app/health/page.tsx` — pillar overview with all 7 modules as cards
- `app/health/stack/page.tsx` — Health Stack
- `app/health/records/page.tsx` — Health Records (Bloodwork Vault, Screening Calendar, etc.)
- `app/health/whoop/page.tsx` — WHOOP module (built with dummy data; real-data wiring is Step 4)
- `app/health/body/page.tsx` — Body Composition
- `app/health/performance/page.tsx` — Performance
- `app/health/mind/page.tsx` — Mental & Cognitive
- `app/health/biological-age/page.tsx` — Biological Age Scorecard (HERO module — 8-number dashboard)
- For each: realistic dummy data in `lib/seed/health/*.ts`

**Agent B — Love pillar (7 module pages with dummy data)**
- `app/love/page.tsx` — pillar overview
- `app/love/look-book/page.tsx` — Look Book (closet grid + slot-based outfit builder + 30 dummy garments + 12 dummy outfits)
- `app/love/inner-circle/page.tsx` — Inner Circle (25 dummy contacts)
- `app/love/family/page.tsx` — Family Ledger (with "remaining encounters" counter)
- `app/love/travel/page.tsx` — Travel (world map with 20 dummy trips)
- `app/love/hobbies/page.tsx` — Hobbies & Learning
- `app/love/goals/page.tsx` — Goals & Vision
- `app/love/reflection/page.tsx` — Reflection
- For each: realistic dummy data in `lib/seed/love/*.ts`

**Agent C — Wealth pillar + dummy framework polish**
- `app/wealth/page.tsx` — Wealth pillar overview (2 modules: Business + Personal Capital)
- `app/wealth/business/[[...path]]/page.tsx` — iframe wrapper for CEO Cockpit URL (catch-all route so sub-paths work)
- `app/wealth/personal-capital/page.tsx` — Personal Capital module (liquid NW, illiquid Carisma equity, Years of Freedom metric — all dummy)
- Polish dummy data framework: type-safe loader, dev-mode banner showing "DUMMY DATA" when flag is on

### Step 4 — WHOOP live data (sequential, ~30 min)
- Install `python-shell` or use Next.js Server Action that shells out to existing `Tools/whoop/` Python scripts
- OR: write a minimal TypeScript client that re-implements the WHOOP API calls (cleaner, no Python in deploy)
- Wire `app/health/whoop/page.tsx` to switch between dummy and live based on `USE_DUMMY_DATA`
- For Phase 1, store WHOOP credentials in Life Cockpit's env vars

### Step 5 — Verify + deploy (sequential, ~30 min)
- `npm run build` locally — must pass
- Push branch to GitHub
- Create new Vercel project `life-cockpit`, link to branch
- Configure env vars on Vercel (Supabase URL/keys, WHOOP creds, Anthropic key, `USE_DUMMY_DATA=true` initially)
- Deploy preview → smoke test → promote to production

## Dummy Data Requirements

Every dummy seed must look real enough that Mert can decide whether to keep the module. Examples:
- Bloodwork: 4 years quarterly, ApoB drifting 70 → 95 → 110 (realistic founder metabolic drift)
- WHOOP: 90 days with realistic HRV/RHR variance
- Look Book: 30 garments tagged with brand/color/season/formality
- Inner Circle: 25 contacts with last-touch dates spanning weeks-months
- Travel: 20 trips with photo URLs (placeholder via picsum.photos)

## Risks

1. **Google Drive sync of node_modules** — already handled in CEO Cockpit, same `.gitignore` pattern
2. **WHOOP token in env vars** — must rotate from `.tmp/whoop_tokens.json`. Document in README.
3. **iframe embedding CEO Cockpit** — third-party cookies on different vercel.app subdomains may cause auth loop. Mitigation: same Supabase project means user is already logged into Supabase via Life Cockpit; CEO Cockpit reads same JWT cookie if domains share root. If both apps are on `*.vercel.app`, this won't share. Acceptable for Phase 1: user logs into CEO Cockpit once in iframe; future Phase 5 sets up custom root domain to fix properly.
4. **shadcn copy vs install** — copying primitives from CEO Cockpit is faster than re-running `shadcn add`; risk is drift over time. Acceptable for now.

## What's NOT in Phase 1

- Real DB writes for Health/Love modules (everything is dummy except WHOOP)
- Authentication (single-user app — auth added in Phase 2)
- Cloudflare R2 / fal.ai cutouts / Konva outfit canvas / lab PDF parser AI
- Migrations for `health`, `wardrobe`, `life` Supabase schemas (added in Phase 2 when first real-write module ships)
- Custom root domain
