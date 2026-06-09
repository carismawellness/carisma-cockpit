---
name: crm-kpi-dashboard
version: "1.0.0"
description: "Maintains the CRM Master Sheet daily rep KPI dashboard. Use when rebuilding KPI tabs for agents, running QC checks, or refreshing the MASTER tab formulas. Covers the full pipeline: source sheets → agent KPI tabs → MASTER dashboard table."
user-invocable: true
allowed-tools: Bash, Read, Write, Edit
argument-hint: "[rebuild-tabs|run-qc|rebuild-dashboard] [--agent AgentName]"
metadata:
  author: Carisma
  tags:
    - crm
    - kpi
    - dashboard
    - google-sheets
    - daily-reporting
  triggers:
    - "rebuild kpi tabs"
    - "run kpi qc"
    - "rebuild dashboard"
    - "kpi dashboard"
    - "rebuild master formulas"
    - "update rep dashboard"
---

# CRM KPI Dashboard

Manages the daily rep KPI system in the CRM Master Sheet (`1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI`).

---

## Architecture

```
Source tabs (e.g. "Adeel (src)") → Python builder → KPI tabs (e.g. "Adeel") → MASTER dashboard
```

- **Source sheets**: named `{Agent} (src)` — original per-agent data grids with dates as columns
- **KPI tabs**: named `{Agent}` — transposed: dates as rows, metrics as columns
- **MASTER tab**: row 24-35 = per-rep daily KPI table, row 36 = TOTAL, date in D22

---

## Agent Roster

### CHAT agents (Live Chat / CRM / Other structure)
| Agent | Tab Name | Source Tab |
|-------|----------|------------|
| Adeel | `Adeel`  | `Adeel (src)` |
| Rana  | `Rana`   | `Rana (src)` |
| Abid  | `Abid`   | `Abid (src)` |
| K&M   | `K&M`    | `K&M (src)` |

### SDR agents (Outbound / Inbound / Chat structure)
| Agent    | Tab Name   | Source Tab |
|----------|------------|------------|
| Nicci    | `Nicci`    | `Nicci (src)` |
| Juliana  | `Juliana`  | `Juliana (src)` |
| Anni     | `Anni`     | `Anni (src)` |
| Nathalia | `Nathalia` | `Nathalia (src)` |
| April    | `April`    | `April (src)` |
| Dorianne | `Dorianne` | `Dorianne (src)` |
| Queenee  | `Queenee`  | `Queenee (src)` |
| VJ       | `VJ`       | `VJ (src)` |

**Note**: The MASTER tab rows show "Natalia" and "Queenie" as display names, but the actual KPI tab names are `Nathalia` and `Queenee`.

---

## KPI Tab Layouts

### CHAT (20 columns: A–T)
| Col | Metric | Source Row |
|-----|--------|-----------|
| A | Date | — |
| B | LC Sales | row 11 |
| C | LC Messages | row 12 |
| D | LC Booked | row 14 |
| E | LC w/ Deposit | row 15 |
| F | CRM Sales | row 19 (Abid/K&M: row 18) |
| G | CRM Messages | row 20 (Abid/K&M: row 19) |
| H | CRM Booked | row 22 (Abid/K&M: row 21) |
| I | CRM w/ Deposit | row 23 (Abid/K&M: row 22) |
| J | Oth Sales | row 29 (Abid/K&M: row 28) |
| K | Oth Messages | row 26 (Abid/K&M: row 25) |
| L | Oth Booked | row 27 (Abid/K&M: row 26) |
| M | Oth w/ Deposit | row 28 (Abid/K&M: row 27) |
| N | Total Messages | formula |
| O | Total Booked | formula |
| P | Total Deposits | formula |
| Q | Total Rate | formula |
| **R** | **KPI Sales** | formula ← MASTER Sales |
| S | KPI Dep% | formula ← MASTER Deposit % |
| T | KPI AOV | formula ← MASTER AOV |

### SDR (21 columns: A–U)
| Col | Metric | Source Row |
|-----|--------|-----------|
| A | Date | — |
| B | OB Sales | row 11 |
| C | OB Dials | row 12 |
| D | OB Answered | row 13 |
| E | OB Booked | row 14 |
| F | OB w/ Deposit | row 15 |
| G | IB Sales | row 20 |
| H | IB Received | row 21 |
| I | IB Booked | row 22 |
| J | IB w/ Deposit | row 23 |
| K | Chat Sales | row 29 |
| L | Chat Convs | row 26 ← MASTER Texts |
| M | Chat Booked | row 27 |
| N | Chat w/ Deposit | row 28 |
| **O** | **Total Sales** | formula ← MASTER Sales |
| **P** | **Total Booked** | formula ← MASTER Bookings |
| Q | Total Deposits | formula |
| **R** | **Total Rate** | formula ← MASTER Booking Rate |
| **S** | **Total Dials** | formula ← MASTER Dials |
| T | KPI Dep% | formula ← MASTER Deposit % |
| U | KPI AOV | formula ← MASTER AOV |

**Anni override** (no OB Sales row — everything shifted up by 1):
- OB Sales = None (blank), Dials = row 11, Answered = row 12, Booked = row 13, Deps = row 14
- IB: Sales = row 19, Received = row 20, Booked = row 21, Deps = row 22
- Chat: Sales = row 28, Convs = row 25, Booked = row 26, Deps = row 27

---

## MASTER Dashboard Columns (rows 24–35, date in D22)

| Column | Metric | CHAT source | SDR source |
|--------|--------|-------------|------------|
| D | Sales | KPI tab col R (18) | KPI tab col O (15) |
| E | Bookings | KPI tab col O (15) | KPI tab col P (16) |
| F | AOV | KPI tab col T (20) | KPI tab col U (21) |
| G | Booking Eff | N/A | OB Booked (col 5) / OB Answered (col 4) |
| H | Booking Rate | N/A | KPI tab col R (18) |
| I | Dials | N/A | KPI tab col S (19) |
| J | Texts | KPI tab col N (14) | KPI tab col L (12) |
| K | Deposit % | KPI tab col S (19) | KPI tab col T (20) |

**CRITICAL date issue**: D22 in MASTER is stored as a date serial from the UI. KPI tab dates are written via Python. They have different serial number representations even for the same date. Always use `DATEVALUE(TEXT($D$22,"dd/mm/yyyy"))` as the VLOOKUP lookup key — never `$D$22` directly.

---

## Tools

All tools in `Tools/` directory. Run from the project root.

### Rebuild a single KPI tab
```bash
# CHAT agents (Adeel, Rana, Abid, K&M)
python3 Tools/build_kpi_chat_agent.py --agent Adeel

# SDR agents (all others)
python3 Tools/build_kpi_sdr_agent.py --agent VJ
python3 Tools/build_kpi_sdr_agent.py --agent Nathalia
python3 Tools/build_kpi_sdr_agent.py --agent Queenee
```

### QC check a KPI tab
```bash
python3 Tools/qc_kpi_agent.py --agent Adeel --type chat
python3 Tools/qc_kpi_agent.py --agent VJ --type sdr
```

### Rebuild MASTER dashboard formulas
```bash
python3 Tools/build_master_dashboard.py
```

---

## Workflow: Full Rebuild (all 12 agents)

Run in 4 parallel batches to avoid 429 rate limits (60 writes/min):

**Batch 1 — CHAT agents:**
```bash
python3 Tools/build_kpi_chat_agent.py --agent Adeel && \
python3 Tools/build_kpi_chat_agent.py --agent Rana
```

**Batch 2 — CHAT agents:**
```bash
python3 Tools/build_kpi_chat_agent.py --agent Abid && \
python3 Tools/build_kpi_chat_agent.py --agent "K&M"
```

**Batch 3 — SDR agents (part 1):**
```bash
python3 Tools/build_kpi_sdr_agent.py --agent VJ && \
python3 Tools/build_kpi_sdr_agent.py --agent Nicci && \
python3 Tools/build_kpi_sdr_agent.py --agent Juliana
```

**Batch 4 — SDR agents (part 2):**
```bash
python3 Tools/build_kpi_sdr_agent.py --agent Anni && \
python3 Tools/build_kpi_sdr_agent.py --agent Nathalia && \
python3 Tools/build_kpi_sdr_agent.py --agent April && \
python3 Tools/build_kpi_sdr_agent.py --agent Dorianne && \
python3 Tools/build_kpi_sdr_agent.py --agent Queenee
```

**Then run QC for each agent, then rebuild dashboard:**
```bash
python3 Tools/build_master_dashboard.py
```

---

## Non-Negotiable Rules

1. **NEVER use `$D$22` directly** as VLOOKUP key — always `DATEVALUE(TEXT($D$22,"dd/mm/yyyy"))`.
2. **CHAT agents**: Abid and K&M have row overrides — CRM rows 18/19/21/22, Other rows 28/25/26/27 (vs default 19/20/22/23 and 29/26/27/28).
3. **SDR agents**: Anni has no OB Sales row — all rows shifted up by 1 in Outbound section.
4. **Tab spelling**: Tabs are `Nathalia` and `Queenee` (not "Natalia" and "Queenie").
5. **K&M tab**: is a CHAT agent (Live Chat/CRM/Other), NOT SDR — do not use `build_kpi_sdr_agent.py`.
6. **Source tab naming**: source sheets renamed to `{Agent} (src)` — scripts reference this suffix.
7. Rate-limit protection: builders use single `batch_update` for all layout (freeze + merges + col widths + row heights) = ~5 API calls per script.
