---
name: carisma-brand-colors
description: Use when applying colors to any chart, table, badge, legend, section header, or UI element that represents one of the three Carisma brands (Spa, Aesthetics, Slimming) — or a cost line, marketing channel, or status. Covers Recharts bars/lines/pies, table tints, dots, and brand chips. Same entity → same color everywhere.
---

# Carisma Brand & Chart Palette

The three brand colors set the visual language for every Carisma dashboard. **Same entity always renders in the same color, everywhere.** A Spa bar is the same Spa color on the sales dashboard, the EBITDA page, and the CRM leaderboard.

## Single source of truth — import it, never hardcode

```ts
// 10-Tech/CEO-Cockpit/lib/constants/design-tokens.ts
import { BRAND, LY_OVERLAY } from "@/lib/constants/design-tokens";

export const BRAND = {
  spa:        { dark: "#8C7A5A", soft: "#EFE7D7" }, // warm tan / sand
  aesthetics: { dark: "#3B7676", soft: "#DEEBEB" }, // teal / soft blue
  slimming:   { dark: "#3D6B3D", soft: "#C9D8C1" }, // forest / sage green
} as const;
export const LY_OVERLAY = "#9CA3AF"; // same-period-last-year, neutral gray
```

**Always `import { BRAND }` from `design-tokens`.** Never hardcode a brand hex. Never define a local `const BRAND = {…}` duplicate. A local map (`BRAND_FILL`, `BRAND_BG`, etc.) is fine **only if its values reference `BRAND.<brand>.dark/.soft`**.

> `lib/charts/config.ts` → `chartColors` is a *derived* light palette (it re-exports the `.soft` tints) for generic non-brand-segmented multi-series charts. Do NOT use `chartColors.spa/aesthetics/slimming` to color a chart that represents the brands — that's what produces washed-out bars. Use `BRAND.<brand>.dark`.

## dark vs soft — the rule that matters most

| You are coloring… | Use | Example |
|---|---|---|
| A series that **represents a brand** — bar fill, line stroke, pie slice, area fill, funnel segment | `BRAND.<brand>.dark` | Spa revenue bar → `#8C7A5A` |
| A **background**: section-header row, card tint, badge/chip background, prior-period / companion bar | `BRAND.<brand>.soft` | "SPA" roster header row → `#EFE7D7` |
| **Text / a dot / a label** sitting on a soft brand background | `BRAND.<brand>.dark` | "Spa" label on the soft header → `#8C7A5A` |
| A **same-period-last-year** overlay line/bar (any brand) | `LY_OVERLAY` | LY total line → `#9CA3AF` |

A brand chip = soft background **+** dark text together. A solid brand bar = dark.

## What is NOT a brand color (leave these alone)

These are deliberately separate palettes — do not "correct" them to brand colors, and do not reuse a brand's identity hex for them:

- **Spa hotel / location palettes** (Inter, Hyatt, Excelsior, Ramla, Hugos, Riviera, Odycy, Novotel…) — intentional per-location colors.
- **P&L cost lines** — Wages `#E5C088`, Advertising `#E5B5D0`, Rent `#C5D0E0`, COGS `#E5B8B0`, SG&A `#D5C0E5`, Utilities `#B5DCDC`, EBITDA+ `#A8D4A8`, EBITDA− `#E8A8A0`.
- **Marketing channels** — Meta `#B8C9E0`, Google `#E8D08A`, Klaviyo `#D8B8E0`, TikTok `#C5D5DE`, WhatsApp `#BFD8C0`, Misc `#D5D0CA`.
- **CRM lead channels** — Live Chat `#4285F4`, GHL `#F9AB00`, Email `#EA4335`, Chat `#9334E6`, Inbound `#12B5CB`, Outbound `#34A853`.
- **Status / state** — Success `#7FB17F`, Warning `#E5B66B`, Danger `#D88B89`, Info `#A8C0DE`, Neutral/No-data `#C7C4BD`.

## Contrast rule

The `soft` tints are light backgrounds. On them:
- Value labels inside a soft-filled bar → dark gray `#374151`, not white.
- Dots/markers on white → fill `soft`, add a 1px border in the `dark` variant.
- Thin strokes (sparklines) → use the `dark` variant; soft looks faint as a line.

## Common mistakes (these caused real washed-out / off-brand charts)

| Mistake | Fix |
|---|---|
| Using `chartColors.spa` (soft) as a **bar/line fill** for a brand series | Use `BRAND.spa.dark` |
| Hardcoding `#B79E61` (gold) or `#4A90D9` (blue) for Aesthetics/Slimming | `BRAND.aesthetics.dark` / `BRAND.slimming.dark` |
| Generic Tailwind for brand labels/chips (`text-purple-700` for Aesthetics, `text-orange-600` for Slimming, `bg-sky-100` for Spa) | `style={{ color: BRAND.x.dark }}` / soft bg + dark text |
| Re-declaring a local `const BRAND = { spa: {dark:"#8C7A5A"…} }` | Delete it; `import { BRAND }` |
| Coloring a Spa hotel or a cost line with another brand's identity hex | Use the location / cost palette above |

## When adding any new brand-colored UI

1. `import { BRAND, LY_OVERLAY } from "@/lib/constants/design-tokens";`
2. Series representing a brand → `BRAND.<brand>.dark`. Background / header / chip → `BRAND.<brand>.soft` (+ dark text). LY overlay → `LY_OVERLAY`.
3. Cost line / channel / status → use the exact hex from the tables above, same hex everywhere.
4. Never invent a new color for an entity that already has one. If a new category needs a color, add it to this skill first.
