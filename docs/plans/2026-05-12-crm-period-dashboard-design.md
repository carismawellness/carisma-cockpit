# CRM Master Sheet — Period Dashboard Design

**Date:** 2026-05-12
**Owner:** Mert
**Target sheet:** CRM Master (Google Sheets ID `1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI`)
**New tab name:** `Period Dashboard`
**Tab position:** Immediately after `MASTER`

## Context

The team currently reports a daily snapshot in the `MASTER` tab. A team-visible **period dashboard** is needed: same metrics, but aggregated across any user-selected date range, pulled dynamically from the existing individual KPI tabs (Anni, Nicci, Juliana, Nathalia, Dorianne, April, Queenie, Adeel, Abid, Rana).

## Decisions

| Question | Decision |
|---|---|
| Date filter mechanism | Dropdown with presets (Today, Yesterday, Last 7 Days, Last 14 Days, Last 30 Days, MTD, Last Month, Custom) + custom Start/End cells |
| Reps included | All 10 reps, grouped by brand (Spa / Aesthetics / Slimming) × role (SDR / Chat) |
| Metric list | Revenue (€), AOV, Dials, Bookings, Conversion Rate, Deposit Rate (6 metrics — "Sales made" dropped as duplicate of Bookings) |
| Implementation | Direct `SUMPRODUCT` formulas pulling from each rep KPI tab — no scripts, no helper tabs |
| Tab placement | Immediately right of `MASTER` |
| Tab name | `Period Dashboard` |

## Layout

Top-to-bottom:

1. **Title bar** — "TEAM PERFORMANCE DASHBOARD · Carisma Wellness Group · Sales Team"
2. **Filter panel** — preset dropdown + custom start/end + "Showing X → Y (N days)" caption
3. **KPI tiles row** — team totals: Revenue, Bookings, Dials, AOV, Conv %, Deposit %
4. **Team table** — rows grouped under brand section headers, subtotals per brand, grand total at bottom

### Brand grouping

| Brand | Reps |
|---|---|
| Spa | Nicci (SDR), Abid (Chat) |
| Aesthetics | Anni (SDR), Juliana (SDR), Nathalia (SDR), Rana (Chat) |
| Slimming | Dorianne (SDR), April (SDR), Queenie (SDR), Adeel (Chat) |

Note: Rana covers both Aes and Slm chat per the MASTER squad list. She's placed under Aes for the primary view; QC sub-agent to validate or propose alternative.

## Date filter mechanics

- **Preset dropdown** cell uses data validation (list-from-range or list-of-items).
- **Hidden helper cells** compute the effective `StartDate` and `EndDate` from the preset choice (nested `IF` or `SWITCH`). These two cells are exposed as **named ranges** `StartDate` and `EndDate` so every downstream formula reads them cleanly.
- **"Showing X → Y (N days)"** caption auto-updates from the named ranges.

Preset resolution:

| Preset | Start | End |
|---|---|---|
| Today | `TODAY()` | `TODAY()` |
| Yesterday | `TODAY()-1` | `TODAY()-1` |
| Last 7 Days | `TODAY()-6` | `TODAY()` |
| Last 14 Days | `TODAY()-13` | `TODAY()` |
| Last 30 Days | `TODAY()-29` | `TODAY()` |
| MTD | `DATE(YEAR(TODAY()),MONTH(TODAY()),1)` | `TODAY()` |
| Last Month | `EOMONTH(TODAY(),-2)+1` | `EOMONTH(TODAY(),-1)` |
| Custom | Custom Start cell | Custom End cell |

## Metric formulas (per rep)

Source rows in each rep KPI tab (dates live in row 1, columns C onward):

| Row | Metric in tab |
|---|---|
| 4 | Total Sales (€) |
| 5 | Total Dials (Calls) |
| 6 | Total Messages (Chats) |
| 7 | Total Bookings |
| 9 | Weighted Avg Deposit % (per day) |
| 13 | AOV (€) per day |

### Per-rep formulas

| Dashboard column | Formula (Anni example) |
|---|---|
| Revenue | `=SUMPRODUCT((Anni!$C$1:$ZZ$1>=StartDate)*(Anni!$C$1:$ZZ$1<=EndDate)*IFERROR(VALUE(Anni!$C$4:$ZZ$4),0))` |
| Dials | Same pattern, row 5 |
| Bookings | Same pattern, row 7 |
| AOV | `=IFERROR(Revenue/Bookings,"")` (weighted) |
| Conv % | `=IFERROR(Bookings/Dials,"")` |
| Deposit % | `=IFERROR(SUMPRODUCT((dates_in_range)*Anni!$C$9:$ZZ$9*Anni!$C$7:$ZZ$7)/SUMPRODUCT((dates_in_range)*Anni!$C$7:$ZZ$7),"")` (weighted by booking volume) |

Range `C:ZZ` covers ~700 days of date capacity — far beyond any expected horizon.

### Subtotals & Grand Total

- Revenue / Dials / Bookings = `SUM` of rep rows in the brand.
- AOV / Conv / Deposit % = **recomputed** from the brand totals (not averaged across rows) — preserves the weighted-aggregate principle.

## Visual design (sub-agent #2 — Designer)

- **Palette:** Deep Navy `#1B3A4B` + Muted Gold `#B8943E` (existing Carisma design system, matches Budgets vs Actuals dashboard)
- **Title bar:** Solid navy, white text, large
- **Brand section headers:** Solid navy, white text, smaller
- **KPI tiles:** Light grey background, large hero values, small subtitle labels
- **Banded rows** with subtle alternation
- **Subtotal rows:** Bold, light navy tint
- **Grand total row:** Bold, navy background, white text
- **Conditional formatting** (mirror daily report thresholds):
  - Dials: ≥100 green, 50–99 amber, <50 red
  - Conv %: ≥20% green, 10–20% amber, <10% red
  - Deposit %: ≥70% green, 40–70% amber, <40% red
- **Frozen rows:** Title + filter + table header
- **Number formats:** `€#,##0` for currency, `0%` for percentages, `D-MMM-YYYY` for dates

## QC review (sub-agent #3 — Sales Manager)

Pretends to open the dashboard cold and checks:

1. Can underperformers be spotted in <5 seconds?
2. Thresholds match daily report (Dials ≥100, Conv ≥20%, Deposit ≥70%)?
3. Should Rana sit under Aes or Slm (or both with a split)?
4. Should "Bookings with deposit" be its own column instead of just a ratio?
5. Does the filter cover real workflows (daily standup, weekly review, monthly review)?
6. Are blanks for inactive reps (e.g., Dorianne, Queenie) handled gracefully?
7. Are subtotals genuinely useful or noise?
8. Final spot-check: 3 cell values vs source data.

Output: a punch list of fixes for the data analyst + designer.

## Sub-agent workflow (sequential)

1. **Data Analyst sub-agent** — Create `Period Dashboard` tab, build filter cells + named ranges, write all formulas, verify math by spot-checking 3 reps against 11-May-2026 daily report figures. Reports back with: tab created, formulas working, spot-check passed.
2. **Design Expert sub-agent** — Apply all visual styling (palette, banding, conditional formatting, frozen panes, number formats). Reports back with screenshot.
3. **Sales Manager QC sub-agent** — Independent review. Produces punch list.
4. **Iteration round** — Data Analyst + Designer fix issues raised by QC.
5. **Final verification** — orchestrator confirms dashboard is complete, captures final state.

## Success criteria

- Dashboard loads in `Period Dashboard` tab with all 6 metrics for all 10 reps.
- Filter dropdown works for all 8 presets + Custom mode.
- Changing the preset instantly updates all values.
- Visual design is polished, professional, on-brand.
- QC review punch list is fully addressed.
- Math spot-checked against MASTER's 11-May daily values.
