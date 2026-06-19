"use client";

// CRM Performance Snapshot — matches the warm amber style of PerformanceCommentary
// (components/sales/employees/PerformanceCommentary.tsx).
// Three variants: team (/crm/individual), agent (/crm/individual/[slug]), master (/crm).

import { useMemo } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CrmAgent, useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { GhlSnapshot } from "@/lib/hooks/useGhlSnapshot";

// ── Shared panel renderer ─────────────────────────────────────────────────────

interface Bullet { text: string }

function SnapshotCard({
  title,
  subtitle,
  bullets,
  periodLabel,
  tip,
}: {
  title: string;
  subtitle: string;
  bullets: Bullet[];
  periodLabel?: string;
  tip?: string;
}) {
  return (
    <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-amber-900">{title}</CardTitle>
        <p className="text-xs text-amber-700 mt-0.5">{subtitle}</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {bullets.map((b, i) => (
            <li key={i} className="text-sm leading-snug text-amber-900">{b.text}</li>
          ))}
          {tip && (
            <li className="text-sm leading-snug text-amber-900 border-t border-amber-200 pt-3 mt-1">
              {tip}
              <span className="ml-1.5 text-[10px] text-amber-500 font-semibold uppercase tracking-wide">
                AI insight
              </span>
            </li>
          )}
        </ul>
        {periodLabel && (
          <p className="mt-4 text-[11px] text-amber-600 font-medium">{periodLabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Team bullets ──────────────────────────────────────────────────────────────

function buildTeamBullets(
  agents: CrmAgent[],
  priorAgents: CrmAgent[],
  periodDays: number,
): Bullet[] {
  const totalBookings  = agents.reduce((s, a) => s + a.totals.total_bookings, 0);
  const totalDeposits  = agents.reduce((s, a) => s + a.totals.total_deposits, 0);
  const priorBookings  = priorAgents.reduce((s, a) => s + a.totals.total_bookings, 0);
  const sdrAgents      = agents.filter(a => a.totals.avg_booking_eff > 0);
  const sdrMessages    = sdrAgents.reduce((s, a) => s + a.totals.total_messages, 0);
  const inactiveCount  = agents.filter(a => a.totals.total_bookings === 0 && a.totals.total_sales === 0).length;

  const convRates = agents.filter(a => a.totals.avg_conversion_rate > 0).map(a => a.totals.avg_conversion_rate);
  const avgConv   = convRates.length ? convRates.reduce((s, v) => s + v, 0) / convRates.length : 0;
  const teamDepositPct = totalBookings > 0 ? (totalDeposits / totalBookings) * 100 : 0;

  const bullets: Bullet[] = [];

  // ── Bullet 1: Bookings vs prior period ──
  if (priorBookings > 0) {
    const delta    = ((totalBookings - priorBookings) / priorBookings) * 100;
    const absStr   = Math.abs(delta).toFixed(0);
    if (delta >= 10) {
      bullets.push({ text: `🚀 ${totalBookings} bookings this period — up ${absStr}% vs last period. The pipeline is in strong shape.` });
    } else if (delta >= -5) {
      bullets.push({ text: `📊 ${totalBookings} bookings — holding steady vs last period (${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%). Consistent pipeline beats sporadic spikes.` });
    } else {
      bullets.push({ text: `📉 ${totalBookings} bookings — down ${absStr}% vs last period. Determine whether this is a dials issue or a conversion issue before next week's stand-up.` });
    }
  } else if (totalBookings >= 40) {
    bullets.push({ text: `🎯 ${totalBookings} bookings this period (${(totalBookings / periodDays).toFixed(1)}/day) — the team is hitting volume targets.` });
  } else if (totalBookings > 0) {
    bullets.push({ text: `📊 ${totalBookings} bookings this period (${(totalBookings / periodDays).toFixed(1)}/day) — push toward 40+ per period to sustain the pipeline.` });
  } else {
    bullets.push({ text: `⚠️ No bookings recorded yet — run an ETL sync to pull the latest data from the CRM sheet.` });
  }

  // ── Bullet 2: Conversion or deposit rate ──
  const convTarget    = 25;
  const depositTarget = 70;
  if (avgConv > 0 || teamDepositPct > 0) {
    const convGap    = avgConv - convTarget;
    const depositGap = teamDepositPct - depositTarget;
    // Focus on whichever is further below its target
    const useDeposit = teamDepositPct > 0 && (depositGap < convGap || avgConv === 0);
    if (useDeposit) {
      if (depositGap >= 0) {
        bullets.push({ text: `✅ Deposit rate at ${teamDepositPct.toFixed(0)}% — on target. No-show rates should be healthy this period.` });
      } else {
        bullets.push({ text: `⚠️ Deposit rate at ${teamDepositPct.toFixed(0)}% — ${Math.abs(depositGap).toFixed(0)}pp below the ${depositTarget}% target. Undeposited bookings carry elevated no-show risk. Make the deposit ask a mandatory close step on every call.` });
      }
    } else {
      if (convGap >= 5) {
        bullets.push({ text: `✅ Conversion rate at ${avgConv.toFixed(0)}% — ${convGap.toFixed(0)}pp above the ${convTarget}% target. Lock in the winning scripts and cross-train the lower performers now.` });
      } else if (convGap >= 0) {
        bullets.push({ text: `📋 Conversion rate at ${avgConv.toFixed(0)}% — just at target. Protect this by auditing the two lowest-converting agents' recordings this week.` });
      } else {
        bullets.push({ text: `⚠️ Conversion rate at ${avgConv.toFixed(0)}% — ${Math.abs(convGap).toFixed(0)}pp below the ${convTarget}% target. Pull the last 10 call recordings, identify where calls are dropping, and run a script refresh before the next dial session.` });
      }
    }
  } else {
    bullets.push({ text: `📊 Conversion and deposit data will populate once the ETL sync runs.` });
  }

  // ── Bullet 3: Dials / coverage ──
  if (sdrAgents.length > 0) {
    const avgDailyDials = sdrMessages / Math.max(sdrAgents.length * periodDays, 1);
    const dialTarget    = 60;
    if (inactiveCount >= 2) {
      bullets.push({ text: `⚠️ ${inactiveCount} agents with zero activity this period — confirm approved leave is logged, or follow up today. Silent gaps create pipeline holes that show up 2 weeks later.` });
    } else if (avgDailyDials >= 70) {
      bullets.push({ text: `💪 SDRs averaging ${avgDailyDials.toFixed(0)} dials/day — well above the ${dialTarget} minimum. Volume is strong. Cross-check booking rate to confirm calls are converting, not just running long.` });
    } else if (avgDailyDials >= dialTarget) {
      bullets.push({ text: `📞 SDRs averaging ${avgDailyDials.toFixed(0)} dials/day — at the ${dialTarget} minimum. Push toward 70/day to build cushion against slow-conversion days.` });
    } else if (avgDailyDials > 0) {
      bullets.push({ text: `📞 SDRs averaging ${avgDailyDials.toFixed(0)} dials/day — below the ${dialTarget}/day floor. Identify who is under-dialing and resolve before the pipeline thins next week.` });
    } else {
      bullets.push({ text: `📊 Dial volume data will populate once the ETL sync runs.` });
    }
  } else if (inactiveCount >= 3) {
    bullets.push({ text: `⚠️ ${inactiveCount} agents recorded zero activity this period — confirm approved leave or follow up today.` });
  } else {
    const activeChat = agents.filter(a => a.totals.total_messages > 0).length;
    bullets.push({ text: `💬 Chat team handled messages across ${activeChat} active agents this period.` });
  }

  return bullets;
}

// ── Agent bullets ─────────────────────────────────────────────────────────────

function buildAgentBullets(
  agent: CrmAgent,
  priorAgent: CrmAgent | null,
  periodDays: number,
): Bullet[] {
  const { totals } = agent;
  const bullets: Bullet[] = [];
  const isSdr = totals.avg_booking_eff > 0;

  // ── Bullet 1: vs prior period ──
  const priorBookings = priorAgent?.totals.total_bookings ?? 0;
  const priorSales    = priorAgent?.totals.total_sales ?? 0;

  if (priorBookings > 0) {
    const delta   = ((totals.total_bookings - priorBookings) / priorBookings) * 100;
    const absStr  = Math.abs(delta).toFixed(0);
    if (delta >= 10) {
      bullets.push({ text: `🚀 Up ${absStr}% on bookings vs last period — momentum is building. Keep the consistency.` });
    } else if (delta >= -5) {
      bullets.push({ text: `📊 ${totals.total_bookings} bookings — holding steady vs last period. Consistency is how top performers are built.` });
    } else {
      bullets.push({ text: `💪 Down ${absStr}% vs last period — every agent has dips. Focus on one extra conversion per day and the numbers will follow.` });
    }
  } else if (priorSales > 0) {
    const delta  = ((totals.total_sales - priorSales) / priorSales) * 100;
    const absStr = Math.abs(delta).toFixed(0);
    if (delta >= 0) {
      bullets.push({ text: `🚀 Up ${absStr}% in pipeline vs last period — strong momentum.` });
    } else {
      bullets.push({ text: `💪 Down ${absStr}% vs last period — every pro has dips. Focus on one extra conversion per day to bounce back.` });
    }
  } else {
    // No prior data — show current bookings
    if (totals.total_bookings >= 10) {
      bullets.push({ text: `🎯 ${totals.total_bookings} bookings this period — strong output. Keep this level of activity and the pipeline will follow.` });
    } else if (totals.total_bookings > 0) {
      bullets.push({ text: `📊 ${totals.total_bookings} bookings this period — every booking counts. Push for consistency to build momentum across the month.` });
    } else {
      bullets.push({ text: `📊 Every great streak starts somewhere — run a sync to load this period's data.` });
    }
  }

  // ── Bullet 2: Conversion or deposit rate ──
  const convTarget    = 25;
  const depositTarget = 70;
  const conv          = totals.avg_conversion_rate;
  const depositPct    = totals.total_bookings > 0 ? (totals.total_deposits / totals.total_bookings) * 100 : totals.avg_deposit_pct;

  if (conv > 0 || depositPct > 0) {
    const convGap    = conv - convTarget;
    const depositGap = depositPct - depositTarget;
    const useDeposit = depositPct > 0 && (depositGap < convGap || conv === 0);

    if (useDeposit) {
      if (depositGap >= 0) {
        bullets.push({ text: `✅ Deposit rate at ${depositPct.toFixed(0)}% — above target. Your show rates should be solid.` });
      } else {
        bullets.push({ text: `🛍️ Deposit rate at ${depositPct.toFixed(0)}% — below the ${depositTarget}% target. Make the deposit ask the last thing you say before hanging up — every time, no exceptions.` });
      }
    } else if (conv > 0) {
      const eff = isSdr && totals.avg_booking_eff > 0 ? totals.avg_booking_eff : conv;
      if (convGap >= 5) {
        bullets.push({ text: `✅ Conversion at ${eff.toFixed(0)}% — ${Math.abs(convGap).toFixed(0)}pp above target. You're one of the top converters. Keep sharpening the objection-handling script.` });
      } else if (convGap >= 0) {
        bullets.push({ text: `📋 Conversion at ${eff.toFixed(0)}% — at the ${convTarget}% target. One extra booking per active day would push you into the top tier.` });
      } else {
        bullets.push({ text: `⚠️ Conversion at ${eff.toFixed(0)}% — ${Math.abs(convGap).toFixed(0)}pp below the ${convTarget}% target. Listen back to your last 5 calls and spot the moment clients hesitate — that's where the script needs work.` });
      }
    }
  } else {
    bullets.push({ text: `📊 Conversion data will show once the ETL sync runs for this period.` });
  }

  // ── Bullet 3: Consistency / activity ──
  const activeDays  = totals.active_days;
  const totalDials  = totals.total_messages;
  const talkTime    = totals.total_talk_time ?? 0;
  const dailyDials  = activeDays > 0 ? totalDials / activeDays : 0;

  if (activeDays < 8 && periodDays >= 14) {
    bullets.push({ text: `📅 ${activeDays} active day${activeDays === 1 ? "" : "s"} this period — showing up consistently is the single biggest lever. Every missed day is pipeline that never gets built.` });
  } else if (isSdr && dailyDials > 0) {
    const dialTarget = 60;
    if (dailyDials >= 70) {
      bullets.push({ text: `💪 Averaging ${dailyDials.toFixed(0)} dials/day on active days — strong volume. Make sure the quality is there too: check your booking rate, not just your dial count.` });
    } else if (dailyDials >= dialTarget) {
      bullets.push({ text: `📞 ${dailyDials.toFixed(0)} dials/day on average — right at the ${dialTarget} minimum. Push toward 70 to give yourself more shots at conversion.` });
    } else {
      bullets.push({ text: `📞 Averaging ${dailyDials.toFixed(0)} dials/day — below the ${dialTarget} minimum. More dials equal more chances. Even 5 extra calls per day compounds meaningfully over a month.` });
    }
  } else if (talkTime > 0) {
    const talkPerDay = talkTime / Math.max(activeDays, 1);
    const talkTarget = 90;
    if (talkPerDay >= 120) {
      bullets.push({ text: `🎙️ ${talkPerDay.toFixed(0)} min/day on the phone — in the top tier for talk time. Strong indicator of engagement.` });
    } else if (talkPerDay >= talkTarget) {
      bullets.push({ text: `🎙️ ${talkPerDay.toFixed(0)} min/day of talk time — above the ${talkTarget} min baseline. Keep this up and your booking numbers will reflect it.` });
    } else {
      bullets.push({ text: `🎙️ ${talkPerDay.toFixed(0)} min/day of talk time — below the ${talkTarget} min target. More time on the phone directly increases booking chances. Aim to stay connected longer per call.` });
    }
  } else {
    bullets.push({ text: `📅 ${activeDays} active day${activeDays === 1 ? "" : "s"} logged this period — consistency is the foundation everything else builds on.` });
  }

  return bullets;
}

// ── CRM master bullets (GHL live data) ───────────────────────────────────────

function buildMasterBullets(snapshot: GhlSnapshot): Bullet[] {
  const bullets: Bullet[] = [];
  const brands = ["spa", "aesthetics", "slimming"] as const;

  // Bullet 1: Most urgent unread queue
  const unreadByBrand = brands.map(b => ({
    brand: b,
    unread: snapshot[b].unreadWhatsapp + snapshot[b].unreadCrm + snapshot[b].unreadEmail,
    whatsapp: snapshot[b].unreadWhatsapp,
  }));
  const worst = unreadByBrand.reduce((a, b) => b.unread > a.unread ? b : a);
  const totalUnread = unreadByBrand.reduce((s, b) => s + b.unread, 0);

  if (totalUnread === 0) {
    bullets.push({ text: `✅ All inboxes clear — no unread messages across Spa, Aesthetics, or Slimming. Great team coverage right now.` });
  } else if (worst.unread >= 50) {
    bullets.push({ text: `🔴 ${worst.brand.charAt(0).toUpperCase() + worst.brand.slice(1)} has ${worst.unread} unread messages — critical backlog. Clients waiting this long will disengage or go elsewhere. Assign additional chat capacity immediately.` });
  } else if (worst.unread >= 20) {
    bullets.push({ text: `⚠️ ${worst.brand.charAt(0).toUpperCase() + worst.brand.slice(1)} has ${worst.unread} unread messages — backlog building. Some clients may be past the 2-hour response window. Prioritise this channel in the next 30 minutes.` });
  } else {
    bullets.push({ text: `📬 ${totalUnread} unread messages across all brands — manageable. ${worst.brand.charAt(0).toUpperCase() + worst.brand.slice(1)} has the highest queue (${worst.unread}). Response time risk is low.` });
  }

  // Bullet 2: Follow-up backlog (todoCount)
  const totalTodo  = brands.reduce((s, b) => s + snapshot[b].todoCount, 0);
  const todoTarget = 20;
  if (totalTodo === 0) {
    bullets.push({ text: `✅ Zero follow-up backlog across all brands — the team is caught up on contacts. Lead cooling risk is low.` });
  } else if (totalTodo >= 100) {
    bullets.push({ text: `🔴 ${totalTodo} contacts in the follow-up queue across all brands — critically behind. Leads older than 48 hours have substantially lower conversion. Triage now: re-assign stalled contacts and verify agents are logging completions in GHL.` });
  } else if (totalTodo >= todoTarget) {
    bullets.push({ text: `⚠️ ${totalTodo} contacts in the follow-up queue — above the ${todoTarget} target. Prioritise oldest contacts first to prevent lead cooling before the end of day.` });
  } else {
    bullets.push({ text: `📋 ${totalTodo} contacts in the follow-up queue — manageable. Keep clearing oldest first to maintain healthy response cadence.` });
  }

  // Bullet 3: New leads pipeline
  const totalLeads = brands.reduce((s, b) => s + snapshot[b].newLeads, 0);
  const leadTarget = 30;
  if (totalLeads >= leadTarget) {
    bullets.push({ text: `🎯 ${totalLeads} new leads across all brands — healthy top-of-funnel. The team has sufficient new prospects to work this week.` });
  } else if (totalLeads >= 10) {
    bullets.push({ text: `📊 ${totalLeads} new leads in the pipeline — below typical weekly intake. Verify ad campaigns are running and forms are submitting correctly before assuming a slow week.` });
  } else if (totalLeads > 0) {
    bullets.push({ text: `⚠️ Only ${totalLeads} new leads — critically low top-of-funnel. SDRs will exhaust workable prospects quickly. Escalate to marketing to verify campaign status and form functionality now.` });
  } else {
    bullets.push({ text: `📊 New leads count showing 0 — this may be a GHL sync delay. Re-sync or check the pipeline manually if this persists.` });
  }

  return bullets;
}

// ── Date range label helper ───────────────────────────────────────────────────

function fmtRange(from: Date, to: Date): string {
  return `${format(from, "d MMM")} – ${format(to, "d MMM yyyy")}`;
}

// ── TEAM variant ──────────────────────────────────────────────────────────────

interface TeamCommentaryProps {
  agents: CrmAgent[];
  dateFrom: Date;
  dateTo: Date;
}

export function TeamCrmCommentary({ agents, dateFrom, dateTo }: TeamCommentaryProps) {
  const periodMs  = dateTo.getTime() - dateFrom.getTime() + 86_400_000;
  const priorTo   = new Date(dateFrom.getTime() - 86_400_000);
  const priorFrom = new Date(priorTo.getTime() - periodMs + 86_400_000);
  const { agents: priorAgents } = useCrmAgents(priorFrom, priorTo);

  const periodDays = Math.max(1, Math.round((dateTo.getTime() - dateFrom.getTime()) / 86_400_000) + 1);

  const bullets = useMemo(
    () => buildTeamBullets(agents, priorAgents, periodDays),
    [agents, priorAgents, periodDays],
  );

  if (agents.length === 0) {
    return (
      <SnapshotCard
        title="Team Performance Snapshot"
        subtitle="Here's what the team numbers are saying"
        bullets={[
          { text: "⚠️ No agent data loaded yet — run the ETL sync to pull the latest CRM sheet data." },
        ]}
        periodLabel={fmtRange(dateFrom, dateTo)}
      />
    );
  }

  return (
    <SnapshotCard
      title="Team Performance Snapshot"
      subtitle="Here's what the team numbers are saying"
      bullets={bullets}
      periodLabel={fmtRange(dateFrom, dateTo)}
    />
  );
}

// ── INDIVIDUAL AGENT variant ──────────────────────────────────────────────────

interface AgentCommentaryProps {
  agent: CrmAgent | undefined;
  dateFrom: Date;
  dateTo: Date;
}

export function AgentCrmCommentary({ agent, dateFrom, dateTo }: AgentCommentaryProps) {
  const periodMs  = dateTo.getTime() - dateFrom.getTime() + 86_400_000;
  const priorTo   = new Date(dateFrom.getTime() - 86_400_000);
  const priorFrom = new Date(priorTo.getTime() - periodMs + 86_400_000);
  const { agents: priorAgents } = useCrmAgents(priorFrom, priorTo);

  const periodDays = Math.max(1, Math.round((dateTo.getTime() - dateFrom.getTime()) / 86_400_000) + 1);
  const priorAgent = agent ? (priorAgents.find(a => a.slug === agent.slug) ?? null) : null;

  const bullets = useMemo(() => {
    if (!agent) return [];
    return buildAgentBullets(agent, priorAgent, periodDays);
  }, [agent, priorAgent, periodDays]);

  if (!agent) return null;

  const firstName = agent.name.trim().split(/\s+/)[0] ?? agent.name;

  return (
    <SnapshotCard
      title="Your Performance Snapshot"
      subtitle={`Hey ${firstName} — here's what your numbers are saying`}
      bullets={bullets}
      periodLabel={fmtRange(dateFrom, dateTo)}
    />
  );
}

// ── CRM MASTER variant (GHL live) ────────────────────────────────────────────

interface CrmMasterCommentaryProps {
  snapshot: GhlSnapshot;
}

export function CrmMasterCommentary({ snapshot }: CrmMasterCommentaryProps) {
  const bullets = useMemo(() => buildMasterBullets(snapshot), [snapshot]);

  return (
    <SnapshotCard
      title="Queue Health Snapshot"
      subtitle="Live — here's what the GHL queues are saying right now"
      bullets={bullets}
      periodLabel="Live · current GHL state"
    />
  );
}
