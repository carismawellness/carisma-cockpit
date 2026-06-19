# Agent Commission Hero Banner — Design

**Date:** 2026-06-10

## Goal

Display each sales agent's commission earned (revenue × rate) as a prominent full-width green hero banner at the top of their individual dashboard (`/crm/individual/[slug]`). Motivating, green, visible the moment they log in.

## Commission Rates

Rana: 1.5% · All other agents: 1%
Rates are static config — no DB required.

## Architecture

**Option chosen: B** — new `CommissionHeroBanner` component wired at the page level. Panel untouched.

### Files changed

| File | Change |
|---|---|
| `lib/constants/agents.ts` | Add `commissionRate: number` to `AgentMeta` interface + populate per agent |
| `components/crm/CommissionHeroBanner.tsx` | New component (green hero card) |
| `app/crm/individual/[slug]/page.tsx` | Look up rate, compute amount, render banner above panel |

### Files NOT changed

- `components/crm/AgentDetailPanel.tsx` — unchanged
- `lib/hooks/useCrmAgents.ts` — unchanged
- All API routes — unchanged

## Data Flow

```
slug → AGENT_META_BY_SLUG[slug].commissionRate
agent.totals.total_sales (already fetched by useCrmAgents)
commissionEarned = total_sales × commissionRate
→ passed as props to CommissionHeroBanner
```

## CommissionHeroBanner Visual Spec

- Full-width card, `bg-gradient-to-br from-emerald-50 to-green-100`, `border-emerald-200`
- Top-left: "💰 Your Commission" label (small caps, emerald-600)
- Top-right: rate pill — `bg-emerald-100 text-emerald-800 text-xs` e.g. "1% of revenue"
- Center: `€1,423.50` — `text-5xl font-bold text-emerald-700`
- Below amount: date range label + revenue base, e.g. "Jun 1 – Jun 10, 2026 · Based on €142,350 revenue"
- Loading state: skeleton shimmer (matches rest of page pattern)
- No target / progress bar (can be added later)

## Future Extensions

- Add monthly target + progress bar
- Surface on CRM overview leaderboard
- Push commission digest via WhatsApp/email on 1st of month
