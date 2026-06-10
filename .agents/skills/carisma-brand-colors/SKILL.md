---
name: carisma-brand-colors
description: Official Carisma chart palette — brand colors, cost-line colors, channel colors, status colors. Use whenever applying colors to charts, tables, badges, or any UI element representing a brand, cost line, marketing channel, or status. Same entity → same color everywhere.
---

# Carisma Chart Palette

Soft pastel base. The three brand colors set the visual language; every other category in the dashboard derives from it. **Same entity always renders in the same colour, everywhere.**

---

## Brands

| Brand | Fill | Text variant (dark, for headers/dots-on-white) |
|---|---|---|
| **Spa** | `#EFE7D7` warm sand | `#8C7A5A` |
| **Aesthetics** | `#DEEBEB` soft teal | `#3B7676` |
| **Slimming** | `#C9D8C1` sage green | `#3D6B3D` |

Central config: `Tech/CEO-Cockpit/lib/charts/config.ts` — `chartColors.spa / aesthetics / slimming`.

---

## P&L cost lines (stacked bars — all distinguishable)

| Line | Fill | Used in |
|---|---|---|
| Wages | `#E5C088` soft amber | `ebitda-longitudinal` + per-brand EBITDA stacks |
| Advertising | `#E5B5D0` soft pink | ″ |
| Rent | `#C5D0E0` soft slate | ″ |
| COGS | `#E5B8B0` soft coral | ″ |
| SG&A | `#D5C0E5` soft purple | ″ |
| Utilities | `#B5DCDC` soft cyan | ″ |
| EBITDA (positive) | `#A8D4A8` soft green | ″ |
| EBITDA (negative) | `#E8A8A0` soft red | ″ |

---

## Marketing channels

| Channel | Fill | Rationale |
|---|---|---|
| Meta | `#B8C9E0` | soft Meta blue |
| Google | `#E8D08A` | soft Google yellow |
| Klaviyo (email) | `#D8B8E0` | soft email purple |
| TikTok | `#C5D5DE` | soft TikTok teal |
| WhatsApp | `#BFD8C0` | soft WhatsApp green (distinct from Slimming) |
| Misc / Organic | `#D5D0CA` | warm neutral |

---

## Status / state

| Status | Fill | Use |
|---|---|---|
| Success / On Track | `#7FB17F` | margin ≥ 20%, ROAS ≥ target |
| Warning / Watch | `#E5B66B` | margin 10–20% |
| Danger / Critical | `#D88B89` | margin < 10%, missed target |
| Info | `#A8C0DE` | neutral informational |
| Neutral / No data | `#C7C4BD` | n/a, unknown, "—" |

---

## Contrast rule

These are **pastel fill/background colors**. Because they are light:
- Bar chart labels inside colored bars → `fill: "#374151"` (dark gray), NOT white
- Dot indicators (circles) on light backgrounds → add 1px darker border using the brand text variant
- Sparkline strokes → pastels look faint as thin lines; use the text variant or darker status color instead

---

## Files using this palette (Jun 2026)

- `lib/charts/config.ts` — central `chartColors` (brand only)
- `app/finance/ebitda-longitudinal/page.tsx` — brand stacks + cost-line stacks
- `app/finance/ebitda/group/page.tsx` — brand row tints + cost-line stack
- `app/finance/ebitda/spa/page.tsx` — cost-line stack
- `app/finance/ebitda/aesthetics/page.tsx` — dept color + cost-line stack
- `app/finance/ebitda/slimming/page.tsx` — dept color + cost-line stack
- `app/marketing/page.tsx` — `BRAND` object
- `app/operations/page.tsx` — location review colors

## When adding new UI

1. **Brand** → import from central: `chartColors.spa / aesthetics / slimming`
2. **Cost lines, channels, status** → use the hex codes above directly; same hex everywhere it appears
3. **Never invent new colours** for the same semantic role. If a category doesn't exist here yet, add it to this skill first and pick a tone from the same pastel family
