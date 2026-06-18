---
name: sga-categorization
description: "Allocate a total SG&A figure from Zoho across 11 sub-categories using fixed weights. Triggered when an EBITDA P&L view needs an SG&A line-item breakdown (cockpit table, Excel model, finance report). Until Zoho CoA mapping is wired up for SG&A line items, all consumers must use these weights so numbers reconcile across the org."
---

# SG&A Categorization

## When to use

Any time you need to split a single SG&A total (sourced from Zoho Books or a derived figure) into the 11 standard sub-categories defined below. Cockpit dashboards, finance models, board packs, weekly reports — all must use the same weights so totals reconcile.

If Zoho CoA mapping ever provides actual per-account SG&A line items, prefer the real numbers and skip this skill. Until then, this allocation IS the source of truth.

## The 11 SG&A categories (canonical order, descending weight)

| Category       | Weight |
| -------------- | ------ |
| Prof services  | 20000  |
| Fuel           |  5000  |
| Laundry        |    50  |
| Software       |    10  |
| Cleaning       |    10  |
| Travel         |    10  |
| Misc           |    10  |
| Insurance      |     8  |
| Events         |     5  |
| Maintenance    |     5  |
| Telecom        |     2  |
| **Total**      | **25,110** |

These are unitless weights, not euros. The share for any category is:

```
category_share = sga_total * (weight / 25110)
```

## Where the canonical implementation lives

- Code: `10-Tech/CEO-Cockpit/app/finance/ebitda/page.tsx` — see the `SGA_CATEGORIES` constant and the `sgaShare(sgaTotal, weight)` helper.
- UI: the **P&L by Venue** table on `/finance/ebitda` exposes the breakdown via a chevron-toggle "SG&A" row.

When updating weights, change them in **one place only** (the `SGA_CATEGORIES` const) and any consumer using `sgaShare()` follows automatically.

## Rules

- **NEVER** add a new SG&A category without updating this file's table AND the `SGA_CATEGORIES` const together — divergence breaks reconciliation.
- **NEVER** show a category breakdown that doesn't sum (within rounding) to the parent SG&A total. If rounding causes drift > €1, prefer to round all but the last category and put the residual into `Misc`.
- **ALWAYS** label allocated rows with `(allocated)` or similar tag in user-facing UI so it's obvious they're not direct line items from Zoho.
- **ALWAYS** prefer real Zoho CoA-mapped line items over this allocation if/when they become available. This skill exists because that mapping is not yet in place.

## How to update weights

1. Open `10-Tech/CEO-Cockpit/app/finance/ebitda/page.tsx`.
2. Edit the `SGA_CATEGORIES` array (search for `SGA_CATEGORIES`).
3. Update the table in this skill file to match.
4. Run `npx tsc --noEmit` in the cockpit directory to confirm no breakage.
5. Commit both files together with message `chore(sga): update categorization weights`.

## Future work

- Wire Zoho Books CoA mapping so each SG&A sub-account auto-maps to one of these 11 categories. When that lands, replace weight-based allocation with direct sums per category and retire this skill.
- Add a Settings page that lets users edit weights without touching code.
