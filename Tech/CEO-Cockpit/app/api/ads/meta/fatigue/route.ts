import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { BrandSlug } from "@/lib/types/ads";

export const maxDuration = 60;

async function getMetaToken(): Promise<string | null> {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data } = await supabaseAdmin
      .from("integration_tokens")
      .select("token, expires_at")
      .eq("platform", "meta_ads")
      .is("brand_id", null)
      .single();
    if (data?.token) {
      const expired = data.expires_at ? new Date(data.expires_at) < new Date() : false;
      if (!expired) return data.token;
    }
  } catch { /* fall through */ }
  const env = process.env.META_ACCESS_TOKEN;
  return env && env !== "REPLACE_WITH_NEW_TOKEN" ? env : null;
}

const META_AD_ACCOUNTS: Record<BrandSlug, string> = {
  spa:        "act_654279452039150",
  aesthetics: "act_382359687910745",
  slimming:   "act_1496776195316716",
};

export interface CampaignFatigueResult {
  campaign: string;
  campaignId: string;
  currentCpl: number | null;
  launchCpl: number | null;
  currentWeekLeads: number;
  launchWeekLeads: number;
  weeksOfData: number;
  status: "healthy" | "watch" | "fatigued" | "new";
}

export interface FatigueApiResponse {
  campaigns: CampaignFatigueResult[];
  summary: { healthy: number; watch: number; fatigued: number; newCampaigns: number };
  error?: string;
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand") as BrandSlug | null;
  if (!brand || !META_AD_ACCOUNTS[brand]) {
    return NextResponse.json<FatigueApiResponse>(
      { campaigns: [], summary: { healthy: 0, watch: 0, fatigued: 0, newCampaigns: 0 }, error: "Invalid brand" },
      { status: 400 },
    );
  }

  const token = await getMetaToken();
  if (!token) {
    return NextResponse.json<FatigueApiResponse>(
      { campaigns: [], summary: { healthy: 0, watch: 0, fatigued: 0, newCampaigns: 0 }, error: "No Meta token" },
      { status: 401 },
    );
  }

  // Always query full history — fatigue is real-time, not date-filter-scoped
  const today = new Date().toISOString().slice(0, 10);
  const url = new URL(`https://graph.facebook.com/v22.0/${META_AD_ACCOUNTS[brand]}/insights`);
  url.searchParams.set("fields", "campaign_name,campaign_id,spend,actions,date_start");
  url.searchParams.set("level", "campaign");
  url.searchParams.set("time_range", JSON.stringify({ since: "2024-01-01", until: today }));
  url.searchParams.set("time_increment", "7");
  url.searchParams.set("limit", "2000");
  url.searchParams.set("access_token", token);

  const res = await fetch(url.toString(), { next: { revalidate: 900 } }); // 15-min cache
  const json = await res.json();

  if (json.error) {
    return NextResponse.json<FatigueApiResponse>(
      { campaigns: [], summary: { healthy: 0, watch: 0, fatigued: 0, newCampaigns: 0 }, error: json.error.message },
      { status: 502 },
    );
  }

  // Group weekly rows by campaign_id
  interface WeekEntry { date: string; spend: number; leads: number }
  const map = new Map<string, { name: string; weeks: WeekEntry[] }>();

  for (const row of json.data ?? []) {
    const id    = row.campaign_id   ?? "unknown";
    const name  = row.campaign_name ?? "Unknown";
    const spend = parseFloat(row.spend ?? "0") || 0;
    const leads = (row.actions ?? []).reduce(
      (s: number, a: { action_type: string; value: string }) =>
        a.action_type === "lead" ? s + parseInt(a.value || "0", 10) : s,
      0,
    );
    const entry: WeekEntry = { date: row.date_start ?? "", spend, leads };
    const existing = map.get(id);
    if (!existing) map.set(id, { name, weeks: [entry] });
    else existing.weeks.push(entry);
  }

  const campaigns: CampaignFatigueResult[] = [];
  for (const [id, { name, weeks }] of map) {
    weeks.sort((a, b) => a.date.localeCompare(b.date));

    if (weeks.length < 2) {
      // Too new — only 1 week of data, can't compare
      const lw = weeks[0];
      campaigns.push({
        campaign: name, campaignId: id,
        currentCpl: null, launchCpl: null,
        currentWeekLeads: lw?.leads ?? 0,
        launchWeekLeads: lw?.leads ?? 0,
        weeksOfData: weeks.length,
        status: "new",
      });
      continue;
    }

    const launchWeek  = weeks[0];
    const currentWeek = weeks[weeks.length - 1];

    const launchCpl  = launchWeek.leads  > 0 ? launchWeek.spend  / launchWeek.leads  : null;
    const currentCpl = currentWeek.leads > 0 ? currentWeek.spend / currentWeek.leads : null;

    let status: "healthy" | "watch" | "fatigued" = "healthy";
    if (currentCpl != null && launchCpl != null && launchCpl > 0) {
      if      (currentCpl > launchCpl * 1.75) status = "fatigued"; // >75% above baseline
      else if (currentCpl > launchCpl * 1.50) status = "watch";    // >50% above baseline
    } else if (launchCpl == null && currentCpl != null) {
      // Had no leads at launch but has leads now — too noisy to call fatigued
      status = "healthy";
    }

    campaigns.push({
      campaign: name, campaignId: id,
      currentCpl: currentCpl != null ? Math.round(currentCpl * 100) / 100 : null,
      launchCpl:  launchCpl  != null ? Math.round(launchCpl  * 100) / 100 : null,
      currentWeekLeads: currentWeek.leads,
      launchWeekLeads:  launchWeek.leads,
      weeksOfData: weeks.length,
      status,
    });
  }

  const summary = campaigns.reduce(
    (acc, c) => {
      if      (c.status === "fatigued") acc.fatigued++;
      else if (c.status === "watch")    acc.watch++;
      else if (c.status === "new")      acc.newCampaigns++;
      else                               acc.healthy++;
      return acc;
    },
    { healthy: 0, watch: 0, fatigued: 0, newCampaigns: 0 },
  );

  return NextResponse.json<FatigueApiResponse>({ campaigns, summary });
}
