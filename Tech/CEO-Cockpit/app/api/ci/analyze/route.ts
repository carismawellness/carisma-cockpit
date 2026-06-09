import { NextRequest, NextResponse } from "next/server";
import {
  loadTargets,
  getTarget,
  loadBrands,
} from "@/lib/utils/lookups";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

/* ------------------------------------------------------------------ */
/* POST /api/ci/analyze                                                */
/* Runs the nightly analysis cron — called by Vercel Cron or manual.   */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  const serviceSupabase = getAdminClient();
  try {
    // ---- Auth: cron secret -------------------------------------------
    const cronSecret = request.headers.get("x-cron-secret");
    const expectedSecret =
      process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!cronSecret || cronSecret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ---- Load dynamic targets & brands ------------------------------
    const targets = await loadTargets();
    const brands = await loadBrands();

    // Build per-brand CPL target map
    const brandTargetMap: Record<string, number | undefined> = {};
    for (const [slug, brandId] of Object.entries(brands)) {
      brandTargetMap[slug] = getTarget(targets, "cpl", brandId);
    }

    // ---- Pull latest data -------------------------------------------
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateFrom = sevenDaysAgo.toISOString().split("T")[0];
    const dateTo = now.toISOString().split("T")[0];

    const [marketingRes, crmRes, hrRes] = await Promise.all([
      serviceSupabase
        .from("marketing_daily")
        .select("*")
        .gte("date", dateFrom)
        .lte("date", dateTo),
      serviceSupabase
        .from("crm_daily")
        .select("*")
        .gte("date", dateFrom)
        .lte("date", dateTo),
      serviceSupabase
        .from("hr_weekly")
        .select("*")
        .gte("week_start", dateFrom)
        .lte("week_start", dateTo),
    ]);

    // ---- Build alerts -----------------------------------------------
    const alerts: Array<{
      department: string;
      severity: string;
      metric: string;
      value: number;
      target: number | undefined;
      brand_id: number | null;
      message: string;
    }> = [];

    // Marketing: CPL per brand
    if (marketingRes.data) {
      for (const [slug, brandId] of Object.entries(brands)) {
        const brandRows = marketingRes.data.filter(
          (r: Record<string, unknown>) => r.brand_id === brandId,
        );
        if (brandRows.length === 0) continue;

        const avgCPL =
          brandRows.reduce(
            (sum: number, r: Record<string, unknown>) =>
              sum + ((r.cpl as number) || 0),
            0,
          ) / brandRows.length;

        const cplTarget = getTarget(targets, "cpl", brandId);
        if (cplTarget && avgCPL > cplTarget) {
          alerts.push({
            department: "marketing",
            severity: avgCPL > cplTarget * 1.5 ? "critical" : "warning",
            metric: "cpl",
            value: Math.round(avgCPL * 100) / 100,
            target: cplTarget,
            brand_id: brandId,
            message: `${slug} CPL (EUR ${avgCPL.toFixed(2)}) exceeds target (EUR ${cplTarget})`,
          });
        }
      }

      // ROAS
      const totalSpend = marketingRes.data.reduce(
        (s: number, r: Record<string, unknown>) =>
          s + ((r.spend as number) || 0),
        0,
      );
      const totalRevenue = totalSpend > 0 ? totalSpend * 4 : 0; // placeholder until revenue join
      const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
      const roasTarget = getTarget(targets, "roas") || 5.0;

      if (roas < roasTarget) {
        alerts.push({
          department: "marketing",
          severity: "warning",
          metric: "roas",
          value: Math.round(roas * 100) / 100,
          target: roasTarget,
          brand_id: null,
          message: `ROAS (${roas.toFixed(2)}) below target (${roasTarget})`,
        });
      }
    }

    // CRM: speed to lead, conversion rate
    if (crmRes.data && crmRes.data.length > 0) {
      const avgStl =
        crmRes.data.reduce(
          (s: number, r: Record<string, unknown>) =>
            s + ((r.speed_to_lead_median_min as number) || 0),
          0,
        ) / crmRes.data.length;

      const stlTarget = getTarget(targets, "speed_to_lead_min") || 5;
      if (avgStl > stlTarget) {
        alerts.push({
          department: "sales",
          severity: avgStl > stlTarget * 2 ? "critical" : "warning",
          metric: "speed_to_lead_min",
          value: Math.round(avgStl * 10) / 10,
          target: stlTarget,
          brand_id: null,
          message: `Speed to lead (${avgStl.toFixed(1)} min) exceeds target (${stlTarget} min)`,
        });
      }

      const avgConv =
        crmRes.data.reduce(
          (s: number, r: Record<string, unknown>) =>
            s + ((r.conversion_rate_pct as number) || 0),
          0,
        ) / crmRes.data.length;

      const convTarget = getTarget(targets, "conversion_rate_pct") || 25;
      if (avgConv < convTarget) {
        alerts.push({
          department: "sales",
          severity: "warning",
          metric: "conversion_rate_pct",
          value: Math.round(avgConv * 10) / 10,
          target: convTarget,
          brand_id: null,
          message: `Conversion rate (${avgConv.toFixed(1)}%) below target (${convTarget}%)`,
        });
      }
    }

    // HR: HC%, utilization
    if (hrRes.data && hrRes.data.length > 0) {
      const avgHC =
        hrRes.data.reduce(
          (s: number, r: Record<string, unknown>) =>
            s + ((r.hc_pct as number) || 0),
          0,
        ) / hrRes.data.length;

      const hcTarget = getTarget(targets, "hc_pct") || 40;
      if (avgHC > hcTarget) {
        alerts.push({
          department: "hr",
          severity: "warning",
          metric: "hc_pct",
          value: Math.round(avgHC * 10) / 10,
          target: hcTarget,
          brand_id: null,
          message: `HC% (${avgHC.toFixed(1)}%) exceeds target (${hcTarget}%)`,
        });
      }

      const avgUtil =
        hrRes.data.reduce(
          (s: number, r: Record<string, unknown>) =>
            s + ((r.utilization_pct as number) || 0),
          0,
        ) / hrRes.data.length;

      const utilTarget = getTarget(targets, "utilization_pct") || 75;
      if (avgUtil < utilTarget) {
        alerts.push({
          department: "hr",
          severity: "warning",
          metric: "utilization_pct",
          value: Math.round(avgUtil * 10) / 10,
          target: utilTarget,
          brand_id: null,
          message: `Utilization (${avgUtil.toFixed(1)}%) below target (${utilTarget}%)`,
        });
      }
    }

    // ---- Persist alerts ---------------------------------------------
    if (alerts.length > 0) {
      const rows = alerts.map((a) => ({
        department: a.department,
        severity: a.severity,
        metric: a.metric,
        value: a.value,
        target: a.target,
        brand_id: a.brand_id,
        message: a.message,
        status: "pending",
      }));

      await serviceSupabase.from("ci_alerts").insert(rows);
    }

    return NextResponse.json({
      ok: true,
      alerts_generated: alerts.length,
      period: { from: dateFrom, to: dateTo },
    });
  } catch (err) {
    console.error("[ci/analyze] error:", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
