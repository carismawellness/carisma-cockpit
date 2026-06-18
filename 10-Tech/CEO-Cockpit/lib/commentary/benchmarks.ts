// lib/commentary/benchmarks.ts
// Expert-calibrated benchmark configuration for the Carisma CEO Cockpit
// Strategic Commentary Engine — deterministic RAG thresholds

export interface MetricBenchmark {
  key: string;
  label: string;
  unit: string;        // '%' | 'EUR' | 'min/day' | 'dials' | 'bookings' | 'deposits' | 'EUR/day' | 'bookings/day' | 'leads/week' | 'contacts' | 'messages' | 'agents'
  benchmark: number;   // world-class / Carisma target
  benchmarkLabel: string;
  green: number;       // >= green → GREEN  (for higherIsBetter=true; <= green → GREEN for false)
  yellow: number;      // >= yellow → YELLOW (for higherIsBetter=true; <= yellow → YELLOW for false)
  // < yellow (for higherIsBetter=true) → RED; > yellow (for higherIsBetter=false) → RED
  higherIsBetter: boolean;
  priority: number;    // 1 = most critical, 9 = lowest
  templates: {
    green: string;
    yellow: string;
    red: string;
  };
}

export const CRM_AGENT_BENCHMARKS: MetricBenchmark[] = [
  {
    key: "avg_conv_pct",
    label: "Conversion Rate",
    unit: "%",
    benchmark: 25,
    benchmarkLabel: "Carisma target (industry upper-mid: 15–30%)",
    green: 25,
    yellow: 18,
    higherIsBetter: true,
    priority: 1,
    templates: {
      green:  "Conv % at {value} — {delta}pp above the {benchmark}% target. Audit top-converting scripts and standardize objection-handling language across the team.",
      yellow: "Conv % at {value}, {delta}pp below the {benchmark}% target. Review call recordings for the bottom two agents; identify whether drop-off is at pitch, objection, or close.",
      red:    "Conv % at {value} — {delta}pp below {benchmark}% target. Pull last 20 recordings now. Determine whether the gap is lead quality, script failure, or follow-up timing. Run a same-day script refresh before the next dial session.",
    },
  },
  {
    key: "avg_deposit_pct",
    label: "Deposit Rate",
    unit: "%",
    benchmark: 70,
    benchmarkLabel: "Carisma hardcoded target (industry range: 60–80%)",
    green: 70,
    yellow: 55,
    higherIsBetter: true,
    priority: 2,
    templates: {
      green:  "Deposit rate at {value} — {delta}pp above the {benchmark}% target. Monitor no-show rate to confirm deposits are translating to attended appointments.",
      yellow: "Deposit rate at {value}, {delta}pp below the {benchmark}% target. The deposit ask may be skipped or weak. Role-play the deposit close and make it a non-negotiable part of every booking script.",
      red:    "Deposit rate at {value} — {delta}pp below {benchmark}% target. Cross-reference bookings against no-show data. If no-show rate is elevated, halt soft-booking and enforce deposit collection on every call before it ends.",
    },
  },
  {
    key: "bkg_rate_pct",
    label: "Booking Rate (answered calls)",
    unit: "%",
    benchmark: 30,
    benchmarkLabel: "Outbound wellness warm-lead standard (world-class: 35–45%)",
    green: 30,
    yellow: 22,
    higherIsBetter: true,
    priority: 3,
    templates: {
      green:  "Booking rate at {value} — {delta}pp above the {benchmark}% benchmark. Document what is working in this agent's pitch for team-wide replication.",
      yellow: "Booking rate at {value}, {delta}pp below the {benchmark}% benchmark. Listen to 5 recent answered calls. Identify the specific objection or drop-off point and script a response to test next session.",
      red:    "Booking rate at {value} — {delta}pp below {benchmark}% benchmark. Do not allow this agent to dial unsupervised. Book a 30-minute coaching session today focused on the first 90 seconds and closing language.",
    },
  },
  {
    key: "bkg_eff_pct",
    label: "Booking Efficiency (bookings / total dials)",
    unit: "%",
    benchmark: 8,
    benchmarkLabel: "Conservative floor for Malta outbound wellness (range: 6–12%)",
    green: 10,
    yellow: 6,
    higherIsBetter: true,
    priority: 4,
    templates: {
      green:  "Booking efficiency at {value} — {delta}pp above the {benchmark}% benchmark. Pair this agent with lower-efficiency agents for shadowing.",
      yellow: "Booking efficiency at {value}, {delta}pp below the {benchmark}% benchmark. Determine whether the issue is answer rate (bad call times) or conversion rate (script/pitch) — the fix differs significantly.",
      red:    "Booking efficiency at {value} — {delta}pp below {benchmark}% benchmark. Verify dial count is at target (≥60/day), check answer rate vs prior period, and diagnose whether this is a dialing-time or conversion problem before the next session.",
    },
  },
  {
    key: "active_days_ratio",
    label: "Active Days Ratio",
    unit: "%",
    benchmark: 85,
    benchmarkLabel: "85% of working days (6-day weeks; floor accounts for approved leave)",
    green: 85,
    yellow: 65,
    higherIsBetter: true,
    priority: 5,
    templates: {
      green:  "{value}% active days — consistent presence. Pipeline is being fed reliably across the period.",
      yellow: "{value}% active days, {delta}pp below the {benchmark}% benchmark. If this is not approved leave, flag for a check-in. Inconsistent activity creates pipeline gaps that appear 2–3 weeks later.",
      red:    "{value}% active days — below the minimum threshold. Either an attendance concern or the agent is inactive in the system while technically clocked in. Requires immediate manager follow-up.",
    },
  },
  {
    key: "total_talk_time",
    label: "Talk Time",
    unit: "min/day",
    benchmark: 120,
    benchmarkLabel: "120 min/day per SDR (floor 90 min, strong target 120 min)",
    green: 120,
    yellow: 80,
    higherIsBetter: true,
    priority: 6,
    templates: {
      green:  "Talk time at {value} min/day — {delta} min above the {benchmark} min benchmark. Cross-check booking rate to confirm long calls are converting, not just running long.",
      yellow: "Talk time at {value} min/day, {delta} min below the {benchmark} min benchmark. Determine whether this is a low answer rate or short-call issue; pull dial-to-answer ratio for this period.",
      red:    "Talk time at {value} min/day — {delta} min below {benchmark} min benchmark. Verify agent is hitting ≥60 daily dials. If dials are at target, answer rate is critically low. Test a different calling window before next session.",
    },
  },
  {
    key: "total_messages",
    label: "Total Dials",
    unit: "dials",
    benchmark: 60,
    benchmarkLabel: "60 dials/day minimum per SDR (high-performer target: 70–80)",
    green: 70,
    yellow: 60,
    higherIsBetter: true,
    priority: 7,
    templates: {
      green:  "Team logged {value} dials this period — {delta} above the {benchmark}/day minimum. Volume is in the high-performer range; the pipeline is being worked hard.",
      yellow: "Team hit {value} dials — at the {benchmark}/day floor but not exceeding it. Encourage SDRs to push toward 70/day to build cushion against slow-conversion days.",
      red:    "Team logged only {value} dials — {delta} below the {benchmark}/day floor. Identify who is below 60/day and address immediately; pipeline will thin within 1–2 weeks at this pace.",
    },
  },
  {
    key: "avg_aov",
    label: "Average Order Value",
    unit: "EUR",
    benchmark: 200,
    benchmarkLabel: "Blended ~€200 (Spa €180, Aesthetics €280, Slimming €160)",
    green: 175,
    yellow: 130,
    higherIsBetter: true,
    priority: 7,
    templates: {
      green:  "AOV at {value} — above the {benchmark} blended benchmark. The team is booking quality treatments. Monitor that volume growth does not compress the AOV.",
      yellow: "AOV at {value}, {delta} below the {benchmark} benchmark. Check whether agents are defaulting to lower-tier treatments or whether upsell conversations are consistently happening.",
      red:    "AOV has fallen to {value} — {delta} below {benchmark} benchmark. Even strong booking volume will miss revenue targets at this level. Review treatment mix and upsell scripts urgently.",
    },
  },
  {
    key: "revenue_per_active_day",
    label: "Revenue per Active Day",
    unit: "EUR/day",
    benchmark: 980,
    benchmarkLabel: "~€980/agent/day (€3.3M ÷ 12 agents ÷ 280 active days)",
    green: 1000,
    yellow: 600,
    higherIsBetter: true,
    priority: 7,
    templates: {
      green:  "{value} per active day — above the {benchmark} team benchmark. Strong per-day output. Review what is driving this agent's efficiency.",
      yellow: "{value}/active day, {delta} below the {benchmark} benchmark. Active and dialing but not converting at full rate. Review booking and conversion metrics to isolate the gap.",
      red:    "{value}/active day — significantly below {benchmark} benchmark. Agent is present but underproducing. Prioritize a performance conversation and review call recordings this week.",
    },
  },
  {
    key: "bookings_per_active_day",
    label: "Bookings per Active Day",
    unit: "bookings/day",
    benchmark: 3,
    benchmarkLabel: "3.0 bookings/active day (range: 2.0–3.5; derived from 60–80 dials × 5–10% efficiency)",
    green: 3,
    yellow: 2,
    higherIsBetter: true,
    priority: 8,
    templates: {
      green:  "{value} bookings/active day — above the {benchmark} benchmark. Consistent pipeline builder. Document habits for team replication.",
      yellow: "{value} bookings/active day, below the {benchmark} target. Check dial volume first; if dials are at target, focus coaching on the opening and pitch.",
      red:    "{value} bookings/active day — below minimum threshold. At this rate the agent is not sustaining their share of the pipeline. Review call recordings and dial logs immediately.",
    },
  },
  {
    key: "total_bookings",
    label: "Total Bookings",
    unit: "bookings",
    benchmark: 40,
    benchmarkLabel: "40/week team minimum (realistic range: 35–55 for 7 SDRs)",
    green: 40,
    yellow: 25,
    higherIsBetter: true,
    priority: 8,
    templates: {
      green:  "{value} bookings this period — team is hitting volume targets. Check that no single agent represents >35% to manage concentration risk.",
      yellow: "{value} bookings, below the {benchmark}/week target. Check dials volume first. If dials are on track but bookings lag, the conversion script or lead quality needs attention.",
      red:    "Only {value} bookings this period — significant shortfall that will directly impact next month's revenue. Verify dials are happening, review conversion per agent, and confirm no CRM follow-up backlog is blocking re-engagement.",
    },
  },
  {
    key: "total_deposits",
    label: "Total Deposits",
    unit: "deposits",
    benchmark: 28,
    benchmarkLabel: "70% of total_bookings (absolute count tracks at 0.7× bookings)",
    green: 28,
    yellow: 22,
    higherIsBetter: true,
    priority: 8,
    templates: {
      green:  "{value} deposits — deposit rate is on target (≥70%). Show rates should be healthy this period.",
      yellow: "{value} deposits — below the 70% target. Undeposited bookings are at elevated no-show risk. Identify which agents are not collecting and address in the next daily stand-up.",
      red:    "{value} deposits — critically below target. High undeposited-booking count signals agents are skipping the collection step. Review call recordings for the deposit ask and enforce same-day deposit confirmation as a mandatory close.",
    },
  },
  {
    key: "total_revenue",
    label: "Pipeline Revenue (self-reported)",
    unit: "EUR",
    benchmark: 0,
    benchmarkLabel: "Relative: vs trailing 4-week average (self-reported; not POS-verified)",
    green: 0,
    yellow: -14,
    higherIsBetter: true,
    priority: 8,
    templates: {
      green:  "Pipeline revenue at {value} — {delta}% vs 4-week average. A strong commercial week. Verify broad distribution across agents to manage concentration risk.",
      yellow: "Pipeline revenue at {value} is {delta}% below the recent average. Check whether this reflects fewer bookings or lower AOV before acting.",
      red:    "Pipeline revenue at {value} is {delta}% below the 4-week average. Identify whether this is a dials problem (volume), conversion problem (quality), or a reporting gap before the week closes.",
    },
  },
  {
    key: "newLeads",
    label: "New Leads (by brand)",
    unit: "leads/week",
    benchmark: 15,
    benchmarkLabel: "Spa 15–25/week | Aesthetics 10–18/week | Slimming 8–15/week",
    green: 15,
    yellow: 8,
    higherIsBetter: true,
    priority: 8,
    templates: {
      green:  "{value} new leads in the pipeline — healthy top-of-funnel. The team has sufficient new prospects to work this week.",
      yellow: "{value} new leads — below typical weekly intake. Verify ad campaigns are running and forms are submitting correctly. Check if lead quality filters are too aggressive.",
      red:    "Only {value} new leads — critically low top-of-funnel. SDRs will exhaust workable prospects within days. Escalate to marketing immediately to verify campaign status and form functionality.",
    },
  },
  {
    key: "team_concentration_risk",
    label: "Team Concentration Risk (top-2 share)",
    unit: "%",
    benchmark: 55,
    benchmarkLabel: "Top 2 agents ≤55% of total bookings (critical above 65%)",
    green: 55,
    yellow: 65,
    higherIsBetter: false,
    priority: 8,
    templates: {
      green:  "Top 2 agents at {value}% of bookings — healthy distribution. The pipeline is not dependent on any single performer.",
      yellow: "Top 2 agents represent {value}% of bookings — above the {benchmark}% balanced threshold. If either were unavailable, the team would feel it immediately. Consider cross-training strong chat agents to SDR.",
      red:    "Top 2 agents carry {value}% of all bookings — critical concentration risk. One departure collapses near-term pipeline. Coach up mid-performers and review bottom performers urgently.",
    },
  },
  {
    key: "inactive_agents_count",
    label: "Inactive Agents",
    unit: "agents",
    benchmark: 0,
    benchmarkLabel: "0 agents with zero activity in period (unless approved leave is logged)",
    green: 0,
    yellow: 1,
    higherIsBetter: false,
    priority: 9,
    templates: {
      green:  "All agents recorded activity this period — full team utilization. No capacity gaps.",
      yellow: "{value} agent(s) recorded zero bookings and zero revenue this period. Confirm approved leave is logged. If not, this agent's capacity is silently missing from the team's output.",
      red:    "{value} agent(s) were completely inactive this period — unaccounted-for capacity loss. Requires immediate manager follow-up today.",
    },
  },
  {
    key: "todoCount",
    label: "Follow-up Backlog (by brand)",
    unit: "contacts",
    benchmark: 20,
    benchmarkLabel: "<20 per brand; same-day clearance expected",
    green: 20,
    yellow: 40,
    higherIsBetter: false,
    priority: 9,
    templates: {
      green:  "{value} to-do backlog — manageable. The team is keeping up with follow-up volume.",
      yellow: "{value} contacts in to-do backlog — may not clear today at current capacity. Prioritize oldest follow-ups first to prevent lead cooling.",
      red:    "{value} to-do backlog — team is significantly behind. Leads >48 hours old have substantially lower conversion probability. Triage immediately: re-assign stalled contacts and verify agents are logging completions correctly in GHL.",
    },
  },
  {
    key: "unreadWhatsapp",
    label: "Unread WhatsApp (by brand)",
    unit: "messages",
    benchmark: 10,
    benchmarkLabel: "<10 per brand during business hours (Malta response expectation: <2 hours)",
    green: 10,
    yellow: 25,
    higherIsBetter: false,
    priority: 9,
    templates: {
      green:  "{value} unread WhatsApp — chat agents are keeping up. Response time risk is low.",
      yellow: "{value} unread WhatsApp messages. Some clients may be waiting beyond the 2-hour threshold. Chat agents should prioritize this channel in the next 30 minutes.",
      red:    "{value} unread WhatsApp — inbox is in backlog. Clients waiting this long will disengage or contact a competitor. Assign additional chat capacity or escalate to team lead immediately.",
    },
  },
  {
    key: "unreadCrm",
    label: "Unread CRM SMS (by brand)",
    unit: "messages",
    benchmark: 8,
    benchmarkLabel: "<8 per brand; same-day clearance",
    green: 8,
    yellow: 20,
    higherIsBetter: false,
    priority: 9,
    templates: {
      green:  "{value} CRM SMS unread — SMS follow-up is being managed effectively.",
      yellow: "{value} CRM SMS unread — likely prospects from automated sequences. Ensure chat agents are reviewing and responding to qualify or disqualify each.",
      red:    "{value} CRM SMS unread — automated sequences are generating responses no one is acting on. These are warm leads going cold. Assign at least one agent to clear this queue today.",
    },
  },
  {
    key: "unreadEmail",
    label: "Unread Email (by brand)",
    unit: "messages",
    benchmark: 15,
    benchmarkLabel: "<15 per brand; 24-hour clearance acceptable",
    green: 15,
    yellow: 35,
    higherIsBetter: false,
    priority: 9,
    templates: {
      green:  "{value} unread emails — within acceptable range. Complete responses within today's business hours.",
      yellow: "{value} unread emails — some may be approaching the 24-hour response threshold. Assign a chat agent to work through this queue before end of day.",
      red:    "{value} unread emails — beyond acceptable backlog. Emails older than 24 hours damage brand professionalism and lose leads to competitors. Review routing, confirm channel assignment, and clear the backlog today.",
    },
  },
];

// Lookup map for O(1) access
export const BENCHMARK_BY_KEY: Record<string, MetricBenchmark> = Object.fromEntries(
  CRM_AGENT_BENCHMARKS.map((m) => [m.key, m])
);

// Which metrics drive the overall verdict for each dashboard view
export const CRITICAL_METRICS = {
  team:       ["avg_conv_pct", "avg_deposit_pct", "total_bookings"],
  individual: ["avg_conv_pct", "avg_deposit_pct", "active_days_ratio"],
  crm_master: ["unreadWhatsapp", "newLeads", "todoCount"],
} as const;

// GHL live metric thresholds (used internally by engine for crm_master)
export const GHL_THRESHOLDS = {
  unread_total: { green: 10,  yellow: 50,  red: 100 },
  new_leads:    { green: 30,  yellow: 15,  red: 5   },
  todo_count:   { green: 5,   yellow: 20,  red: 50  },
};
