---
name: carisma-brand-colors
description: Official brand color palette for Carisma's three brands. Use whenever applying colors to charts, tables, badges, or any UI element that represents a specific brand.
---

# Carisma Brand Colors

## Official Palette

| Brand | Hex | Usage |
|-------|-----|-------|
| **Spa** | `#EFE7D7` | Warm sand — carismaspa.com |
| **Aesthetics** | `#DEEBEB` | Soft teal — carismaaesthetics.com |
| **Slimming** | `#C9D8C1` | Sage green — carismaslimming.com |

## Central Source of Truth

`Tech/CEO-Cockpit/lib/charts/config.ts` — always update here first:

```typescript
export const chartColors = {
  spa: "#EFE7D7",
  aesthetics: "#DEEBEB",
  slimming: "#C9D8C1",
  target: "#E07A5F",
  budget: "#9CA3AF",
} as const;
```

Pages that import `chartColors` auto-inherit any change here.

## Text / Header Colors (derived darker shades)

When brand colors are used as text or section headers, use these readable darker variants:

| Brand | Text Hex |
|-------|----------|
| Spa | `#8C7A5A` |
| Aesthetics | `#3B7676` |
| Slimming | `#3D6B3D` |

## Contrast Rule

These are **pastel fill/background colors**. Because they are light:
- Bar chart labels inside colored bars → use `fill: "#374151"` (dark gray), NOT white
- Dot indicators (circles) on light backgrounds → add a 1px darker border matching the text variant
- Sparkline strokes → the pastels are faint as thin lines; consider using the text variant instead

## Files Updated (as of Jun 2026)

All of these reference the brand colors and were updated to match:

- `lib/charts/config.ts` — central config (imported by most pages)
- `app/finance/ebitda-longitudinal/page.tsx` — `BRAND_EBITDA_COLORS` + dark label text
- `app/finance/ebitda/group/page.tsx` — table row tints + dot indicators
- `app/finance/ebitda/aesthetics/page.tsx` — aesthetics dept color
- `app/finance/ebitda/slimming/page.tsx` — slimming dept color
- `app/marketing/page.tsx` — `BRAND` object
- `app/operations/page.tsx` — location review colors

## When Adding New Branded UI

Always import from the central config:

```typescript
import { chartColors } from "@/lib/charts/config";

// For fills/backgrounds
style={{ backgroundColor: chartColors.spa }}

// For text (use darker variant inline or derive)
style={{ color: "#8C7A5A" }}  // spa text
style={{ color: "#3B7676" }}  // aesthetics text
style={{ color: "#3D6B3D" }}  // slimming text
```
