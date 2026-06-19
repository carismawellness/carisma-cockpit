"use client";

// Motivational AI commentary card — 3 contextual bullet points derived from
// current-period performance metrics. All negative observations are paired with
// a positive reframe so the tone stays coaching, never critical.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface PerformanceCommentaryProps {
  employeeName: string;
  commissionTotal: number;
  retailRevenue: number;    // actual retail revenue (not commission amount)
  retailTarget: number;     // revenue target in €, typically 800
  totalRevenue: number;
  avgTicket: number;
  activeDays: number;
  prevCommissionTotal?: number;
  periodLabel: string;
  aiTip?: string;           // Claude-generated daily coaching insight
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function absDeltaPct(current: number, previous: number): number {
  if (previous === 0) return 0;
  return Math.abs(((current - previous) / previous) * 100);
}

interface Bullet {
  text: string;
}

function buildBullets({
  commissionTotal,
  retailRevenue,
  retailTarget,
  avgTicket,
  activeDays,
  prevCommissionTotal,
}: Omit<PerformanceCommentaryProps, "employeeName" | "periodLabel" | "totalRevenue">): Bullet[] {
  const bullets: Bullet[] = [];

  // ── 1. Performance snapshot (vs previous period) ──────────────────────────
  if (prevCommissionTotal !== undefined && prevCommissionTotal > 0) {
    const delta = absDeltaPct(commissionTotal, prevCommissionTotal);
    const deltaStr = delta.toFixed(1);
    if (commissionTotal > prevCommissionTotal) {
      bullets.push({
        text: `🚀 Up ${deltaStr}% vs last period — your momentum is building!`,
      });
    } else if (commissionTotal === prevCommissionTotal) {
      bullets.push({
        text: "📊 Holding steady — consistency is how champions are built.",
      });
    } else {
      bullets.push({
        text: `💪 Down ${deltaStr}% vs last period — every pro has dips. Here's how to bounce back: focus on one extra upsell per day and hit your retail target.`,
      });
    }
  } else {
    // No previous period data — show a motivational opener
    bullets.push({
      text: "📊 Every great streak starts somewhere — let's build on this period.",
    });
  }

  // ── 2. Retail insight (targets the €retailTarget revenue threshold) ────────
  if (retailTarget > 0) {
    const pctToTarget = retailRevenue / retailTarget; // e.g. 0.9 = 90%

    if (pctToTarget >= 1) {
      bullets.push({
        text: "🎉 Retail target crushed! Your €100 bonus is locked in. You're in the top tier.",
      });
    } else if (pctToTarget >= 0.8) {
      const pctStr = (pctToTarget * 100).toFixed(0);
      const remaining = Math.ceil(retailTarget - retailRevenue);
      bullets.push({
        text: `🛍️ You're ${pctStr}% to your retail bonus — just €${remaining} more in retail revenue to unlock your €100 extra!`,
      });
    } else {
      bullets.push({
        text: "🛍️ Retail is where your bonus lives. Even 2–3 extra product recommendations per week can get you there.",
      });
    }
  } else {
    // retailTarget is 0 — no target configured, show generic
    bullets.push({
      text: "🛍️ Every retail sale is a bonus multiplier — keep recommending products you genuinely believe in.",
    });
  }

  // ── 3. Consistency or growth tip ─────────────────────────────────────────
  if (activeDays < 10) {
    bullets.push({
      text: `📅 ${activeDays} active day${activeDays === 1 ? "" : "s"} this period — showing up consistently is the biggest lever you have.`,
    });
  } else if (avgTicket < 80) {
    const ticketStr = avgTicket.toFixed(0);
    bullets.push({
      text: `💡 Your avg ticket is €${ticketStr}. Small upsells (like a scalp massage add-on) can move this to €100+ and lift your commission meaningfully.`,
    });
  } else {
    const ticketStr = avgTicket.toFixed(0);
    bullets.push({
      text: `⭐ Strong average ticket of €${ticketStr}. You're already performing above baseline — keep recommending value-add services to maintain this level.`,
    });
  }

  return bullets;
}

export function PerformanceCommentary({
  employeeName,
  commissionTotal,
  retailRevenue,
  retailTarget,
  totalRevenue,
  avgTicket,
  activeDays,
  prevCommissionTotal,
  periodLabel,
  aiTip,
}: PerformanceCommentaryProps) {
  const first = firstName(employeeName);
  const bullets = buildBullets({
    commissionTotal,
    retailRevenue,
    retailTarget,
    avgTicket,
    activeDays,
    prevCommissionTotal,
  });

  return (
    <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-amber-900">
          Your Performance Snapshot
        </CardTitle>
        <p className="text-xs text-amber-700 mt-0.5">
          Hey {first} — here's what your numbers are saying
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {bullets.map((bullet, i) => (
            <li key={i} className="text-sm leading-snug text-amber-900">
              {bullet.text}
            </li>
          ))}
          {aiTip && (
            <li className="text-sm leading-snug text-amber-900 border-t border-amber-200 pt-3 mt-1">
              {aiTip}
              <span className="ml-1.5 text-[10px] text-amber-500 font-semibold uppercase tracking-wide">
                AI insight
              </span>
            </li>
          )}
        </ul>
        {periodLabel && (
          <p className="mt-4 text-[11px] text-amber-600 font-medium">
            {periodLabel}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
