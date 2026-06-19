"use client";

/**
 * Sales Strategic Commentary — warm amber "Performance Snapshot" card.
 *
 * Visual style matches PerformanceCommentary (employee) and CrmStrategicCommentary
 * (CRM / Marketing / Funnel) — the standard Cockpit snapshot pattern.
 *
 * Pure UI: takes a `SalesCommentaryInput` (declarative — same shape the engine
 * uses), translates into 3 contextual bullets via deterministic rules in
 * `buildSalesBullets`, and renders the amber snapshot. No async, no LLM call,
 * recomputes on every prop change.
 *
 * Bullet structure (3 lines, always):
 *   1. Headline growth — YoY or PoP, whichever is the brand's primary signal.
 *   2. Mix / quality — retail attach, AOV, brand concentration, cash share, etc.
 *   3. Action / context — non-hotel share, anomalies, or a coaching nudge.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SalesScope } from "@/lib/commentary/engine";

/* ── Public input ─────────────────────────────────────────────────────────── */

export interface SalesSnapshotInput {
  scope:               SalesScope;
  /** Pretty range label, e.g. "1 May – 31 May 2026". */
  periodLabel:         string;
  /** Total revenue for the selected window (inc-VAT). */
  periodRevenue:       number;

  /** YoY % change vs same window prior year (null = no LY baseline). */
  revenueYoyPct?:      number | null;
  /** Period-over-period growth (current vs prior same-length window). */
  revenuePopPct?:      number | null;

  /** Group: Spa retail / group-total %. */
  spaRetailAttachPct?: number | null;
  /** Group: top-brand share of group revenue. */
  topBrandSharePct?:   number | null;
  /** Group: top-brand name (Spa / Aesthetics / Slimming). */
  topBrandName?:       string | null;

  /** Spa: retail / Spa total %. */
  retailSharePct?:     number | null;
  /** Spa: non-hotel guest share of bookings %. */
  nonHotelSharePct?:   number | null;
  /** Spa & Aesthetics: cash share %. */
  cashSharePct?:       number | null;
  /** Aesthetics & Slimming: AOV (€). */
  aov?:                number | null;
}

interface Bullet { text: string }

/* ── Number helpers ───────────────────────────────────────────────────────── */

function fmtEUR(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${Math.round(v).toLocaleString("en-GB")}`;
}

function signed(v: number, decimals = 1): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}`;
}

/* ── Bullet builders ──────────────────────────────────────────────────────── */

/** Headline growth bullet — uses YoY when present, falls back to PoP. */
function bulletGrowth(scope: SalesScope, yoy: number | null | undefined, pop: number | null | undefined, revenue: number): Bullet {
  const revStr = fmtEUR(revenue);

  if (yoy != null && isFinite(yoy)) {
    if (yoy >= 20) return { text: `🚀 ${revStr} in revenue — ${signed(yoy)}% vs last year. Strong growth; lock in what's working and protect the upside next quarter.` };
    if (yoy >= 5)  return { text: `📈 ${revStr} in revenue — ${signed(yoy)}% vs last year. Above prior-year baseline; identify the lagging sub-line and stress-test its pipeline.` };
    if (yoy >= 0)  return { text: `📊 ${revStr} in revenue — ${signed(yoy)}% vs last year. Tracking flat; the next forecast cycle needs a clear acceleration plan.` };
    return { text: `🚨 ${revStr} in revenue — ${signed(yoy)}% vs last year. Material decline; convene a revenue review across brands and channels this week.` };
  }

  if (pop != null && isFinite(pop)) {
    if (pop >= 20) return { text: `🚀 ${revStr} in revenue — ${signed(pop)}% vs the prior window. Momentum is strong; double down on the channel driving the lift.` };
    if (pop >= 5)  return { text: `📈 ${revStr} in revenue — ${signed(pop)}% vs the prior window. Building positively; sustain with disciplined pipeline coverage.` };
    if (pop >= -5) return { text: `📊 ${revStr} in revenue — ${signed(pop)}% vs the prior window. Holding flat; watch the next two cycles before treating as a slowdown.` };
    return { text: `🚨 ${revStr} in revenue — ${signed(pop)}% vs the prior window. Clear momentum loss; diagnose by lead volume and close rate before next forecast call.` };
  }

  return { text: `📊 ${revStr} in revenue for the selected window. Add a prior-period comparison once two months of data is in.` };
}

function bulletMix(input: SalesSnapshotInput): Bullet {
  const { scope } = input;

  if (scope === "group") {
    const top   = input.topBrandSharePct;
    const name  = input.topBrandName ?? "the top brand";
    const att   = input.spaRetailAttachPct;
    if (top != null) {
      if (top >= 80) return { text: `⚠️ Brand concentration risk — ${name} is ${top.toFixed(0)}% of group revenue. A single-brand shock would hit the group hard. Push budget into the two smaller brands' acquisition channels.` };
      if (top >= 65) return { text: `🟡 ${name} is ${top.toFixed(0)}% of group revenue — slightly concentrated. Watch the smaller brands' growth and don't starve them of marketing budget.` };
      if (att != null) {
        if (att >= 12) return { text: `✅ Brand mix balanced (${name} ${top.toFixed(0)}% of group) and Spa retail attach is healthy at ${att.toFixed(0)}%. Diversification is paying off.` };
        return { text: `✅ Brand mix balanced — ${name} ${top.toFixed(0)}% of group. Next leverage point: lift Spa retail attach (currently ${att.toFixed(0)}%, target 15%).` };
      }
      return { text: `✅ Brand mix balanced — ${name} is ${top.toFixed(0)}% of group revenue, within healthy bounds.` };
    }
    return { text: `📊 Brand-mix detail will populate once all three brands report for this window.` };
  }

  if (scope === "spa") {
    const retail = input.retailSharePct;
    if (retail != null) {
      if (retail >= 15) return { text: `✅ Retail at ${retail.toFixed(0)}% of Spa revenue — at or above the 15% target. Therapists are recommending well; keep the bonus structure protecting this.` };
      if (retail >= 8)  return { text: `🟡 Retail at ${retail.toFixed(0)}% of Spa revenue — below the 15% target. Refresh therapist product training and tighten reception's regimen pitch this month.` };
      return { text: `🚨 Retail at ${retail.toFixed(0)}% of Spa revenue — well below the 15% target. Audit product visibility at reception and the therapist incentive scheme this week.` };
    }
    return { text: `📊 Retail share will populate once spa retail rows arrive in the sync.` };
  }

  if (scope === "aesthetics") {
    const aov = input.aov;
    if (aov != null) {
      if (aov >= 180) return { text: `✅ AOV at ${fmtEUR(aov)} — at or above the €180 target. Treatment mix is biased to higher-value services; protect this with package construction.` };
      if (aov >= 130) return { text: `🟡 AOV at ${fmtEUR(aov)} — under the €180 target. Review the upsell flow at consultation close and re-bundle entry-level packages.` };
      return { text: `🚨 AOV at ${fmtEUR(aov)} — material gap to the €180 target. Investigate discounting practice and entry-level service mix this week.` };
    }
    return { text: `📊 AOV will populate once bookings finish syncing.` };
  }

  // slimming
  const aov = input.aov;
  if (aov != null) {
    if (aov >= 200) return { text: `✅ AOV at ${fmtEUR(aov)} — programme upsell is working. Mix is biased to multi-session packages, which is exactly the post-launch goal.` };
    if (aov >= 120) return { text: `🟡 AOV at ${fmtEUR(aov)} — under the €200 target. Review package upsell at consultation close — too many single-session sales.` };
    return { text: `🚨 AOV at ${fmtEUR(aov)} — material gap to the €200 target. Single-session sales are dominating; tighten the package pitch and re-train consult staff.` };
  }
  return { text: `📊 Per-treatment AOV will populate once the next sync completes.` };
}

function bulletAction(input: SalesSnapshotInput): Bullet {
  const { scope } = input;

  if (scope === "group") {
    const att = input.spaRetailAttachPct;
    if (att != null) {
      if (att >= 15) return { text: `✅ Spa retail attach at ${att.toFixed(0)}% of group revenue — at the 15% target. Product income is doing real work alongside services.` };
      if (att >= 8)  return { text: `🟡 Spa retail attach at ${att.toFixed(0)}% of group revenue — below the 15% target. Each percentage point added is high-margin upside; refresh therapist training and reception prompts.` };
      return { text: `🚨 Spa retail attach at ${att.toFixed(0)}% of group revenue — well below the 15% target. This is the cheapest revenue uplift available; audit incentives and POS visibility this week.` };
    }
    return { text: `📊 Group retail-attach detail will populate as Spa retail rows finish syncing.` };
  }

  if (scope === "spa") {
    const nh = input.nonHotelSharePct;
    if (nh != null) {
      if (nh >= 25 && nh <= 50) return { text: `✅ Non-hotel guests at ${nh.toFixed(0)}% of bookings — healthy hotel/non-hotel balance. Demand isn't concentrated in a single channel.` };
      if (nh < 25)              return { text: `🟡 Non-hotel guests at ${nh.toFixed(0)}% of bookings — over-reliant on hotel partners. Increase local-resident marketing to reduce demand fragility.` };
      return { text: `🟡 Non-hotel guests at ${nh.toFixed(0)}% of bookings — drifting away from hotel partners. Re-engage hotel concierge teams before this becomes a relationship issue.` };
    }
    const cash = input.cashSharePct;
    if (cash != null) {
      if (cash <= 15) return { text: `✅ Cash sales at ${cash.toFixed(0)}% of total — within control bands. POS workflow is clean.` };
      if (cash <= 25) return { text: `🟡 Cash sales at ${cash.toFixed(0)}% of total — above the ≤15% control target. Review reception's payment workflow and float reconciliation.` };
      return { text: `🚨 Cash sales at ${cash.toFixed(0)}% of total — material cash exposure. Run an unannounced cashbox check at the worst-offending location this week.` };
    }
    return { text: `📊 Guest mix and payment quality will populate as the sync completes.` };
  }

  if (scope === "aesthetics") {
    const cash = input.cashSharePct;
    if (cash != null) {
      if (cash <= 15) return { text: `✅ Cash sales at ${cash.toFixed(0)}% of total — within control bands.` };
      if (cash <= 25) return { text: `🟡 Cash sales at ${cash.toFixed(0)}% of total — above the ≤15% control target. Tighten POS workflow and reconciliation.` };
      return { text: `🚨 Cash sales at ${cash.toFixed(0)}% of total — material cash exposure. Audit reception POS practices this week.` };
    }
    return { text: `📊 Cash share will populate once payment data finishes syncing.` };
  }

  // slimming
  const pop = input.revenuePopPct;
  if (pop != null) {
    if (pop >= 20)   return { text: `✅ Slimming ramp is healthy — pipeline depth and consult conversion are translating into revenue. Keep marketing budget on the channels driving lift.` };
    if (pop >= 0)    return { text: `🟡 Slimming ramp is positive but soft. Check consult-to-treatment conversion before adding marketing spend.` };
    return { text: `🚨 Slimming ramp has stalled. Audit ad spend, lead quality, and consult-show rate this week — the gap compounds fast for new brands.` };
  }
  return { text: `📊 Slimming launched Feb 2026 — period-over-period growth is the headline; YoY will reappear in Feb 2027.` };
}

/* ── Builder ──────────────────────────────────────────────────────────────── */

export function buildSalesBullets(input: SalesSnapshotInput): Bullet[] {
  if (input.periodRevenue <= 0) {
    return [{ text: `📊 No revenue recorded for ${input.periodLabel}. Trigger a sync to pull the latest data from the Cockpit datasheet.` }];
  }
  return [
    bulletGrowth(input.scope, input.revenueYoyPct, input.revenuePopPct, input.periodRevenue),
    bulletMix(input),
    bulletAction(input),
  ];
}

/* ── Component ───────────────────────────────────────────────────────────── */

const SCOPE_TITLE: Record<SalesScope, string> = {
  group:      "Group Sales — Performance Snapshot",
  spa:        "Spa Sales — Performance Snapshot",
  aesthetics: "Aesthetics Sales — Performance Snapshot",
  slimming:   "Slimming Sales — Performance Snapshot",
};

const SCOPE_SUBTITLE: Record<SalesScope, string> = {
  group:      "Cross-brand revenue health, mix balance, and the single highest-leverage action this period.",
  spa:        "Spa revenue trajectory, retail attach, and guest-mix balance for the selected window.",
  aesthetics: "Aesthetics revenue growth, AOV quality, and payment-mix control signals.",
  slimming:   "Slimming post-launch ramp and programme-upsell quality for the selected window.",
};

interface Props {
  input:    SalesSnapshotInput;
  loading?: boolean;
}

export function SalesStrategicCommentary({ input, loading = false }: Props) {
  if (loading) {
    return (
      <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 shadow-sm animate-pulse">
        <CardHeader className="pb-2">
          <div className="h-4 w-3/4 rounded bg-amber-200/60" />
          <div className="h-3 w-1/2 rounded bg-amber-200/40 mt-2" />
        </CardHeader>
        <CardContent className="space-y-3 pt-1">
          <div className="h-3 w-full rounded bg-amber-200/40" />
          <div className="h-3 w-5/6 rounded bg-amber-200/40" />
          <div className="h-3 w-2/3 rounded bg-amber-200/40" />
        </CardContent>
      </Card>
    );
  }

  const bullets = buildSalesBullets(input);
  return (
    <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-amber-900">{SCOPE_TITLE[input.scope]}</CardTitle>
        <p className="text-xs text-amber-700 mt-0.5">{SCOPE_SUBTITLE[input.scope]}</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {bullets.map((b, i) => (
            <li key={i} className="text-sm leading-snug text-amber-900">{b.text}</li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] text-amber-600 font-medium">{input.periodLabel}</p>
      </CardContent>
    </Card>
  );
}
