"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { format } from "date-fns";
import { useLookups } from "./useLookups";

export interface BrandFunnelMetrics {
  brand: string;
  totalLeads: number;
  totalBooked: number;
  totalSales: number;
  conversionPct: number;
  depositPct: number;
  stlMedian: number;
  unrepliedWhatsapp: number;
  metaSpend: number;
  metaLeads: number;
  metaCpl: number;
  metaRoas: number;
  daysWithData: number;
  isReal: boolean;
}

export interface UseFunnelMetricsResult {
  byBrand: Record<string, BrandFunnelMetrics>;
  isLoading: boolean;
}

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;

export function useFunnelMetrics(dateFrom: Date, dateTo: Date): UseFunnelMetricsResult {
  const supabase = createClient();
  const { brandMap } = useLookups();
  const fromStr = format(dateFrom, "yyyy-MM-dd");
  const toStr = format(dateTo, "yyyy-MM-dd");

  const { data: crmRows = [], isLoading: crmLoading } = useQuery({
    queryKey: ["funnel-crm", fromStr, toStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_daily")
        .select(
          "date, brand_id, total_leads, appointments_booked, total_sales, " +
          "conversion_rate_pct, deposit_pct, speed_to_lead_median_min, " +
          "unreplied_whatsapp"
        )
        .gte("date", fromStr)
        .lte("date", toStr);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const { data: metaRows = [], isLoading: metaLoading } = useQuery({
    queryKey: ["funnel-meta", fromStr, toStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("meta_campaigns_daily")
        .select("date, brand_id, spend, leads, attributed_revenue, roas")
        .gte("date", fromStr)
        .lte("date", toStr);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const byBrand: Record<string, BrandFunnelMetrics> = {};

  for (const slug of BRAND_SLUGS) {
    const bid = brandMap[slug];
    const brandCrm = (crmRows as any[]).filter(r => r.brand_id === bid);
    const brandMeta = (metaRows as any[]).filter(r => r.brand_id === bid);

    const totalLeads = brandCrm.reduce((s, r) => s + (r.total_leads ?? 0), 0);
    const totalBooked = brandCrm.reduce((s, r) => s + (r.appointments_booked ?? 0), 0);
    const totalSales = brandCrm.reduce((s, r) => s + (r.total_sales ?? 0), 0);
    const daysWithData = brandCrm.filter(r => (r.total_leads ?? 0) > 0).length;

    // Weighted conversion rate
    let convNum = 0, convDen = 0;
    for (const r of brandCrm) {
      if (r.conversion_rate_pct !== null && r.total_leads !== null && r.total_leads > 0) {
        convNum += r.conversion_rate_pct * r.total_leads;
        convDen += r.total_leads;
      }
    }
    const conversionPct = convDen > 0 ? convNum / convDen : 0;

    // Weighted deposit rate
    let depNum = 0, depDen = 0;
    for (const r of brandCrm) {
      if (r.deposit_pct !== null && r.total_sales !== null && r.total_sales > 0) {
        depNum += r.deposit_pct * r.total_sales;
        depDen += r.total_sales;
      }
    }
    const depositPct = depDen > 0 ? depNum / depDen : 0;

    // Median of daily medians for STL
    const stlValues = brandCrm
      .filter(r => r.speed_to_lead_median_min !== null && r.speed_to_lead_median_min > 0)
      .map(r => r.speed_to_lead_median_min as number)
      .sort((a, b) => a - b);
    const mid = Math.floor(stlValues.length / 2);
    const stlMedian = stlValues.length > 0
      ? stlValues.length % 2 === 1
        ? stlValues[mid]
        : (stlValues[mid - 1] + stlValues[mid]) / 2
      : 0;

    // Latest unreplied messages
    const sortedCrm = [...brandCrm].sort((a, b) => b.date.localeCompare(a.date));
    const unrepliedWhatsapp = sortedCrm[0]?.unreplied_whatsapp ?? 0;

    // Meta aggregates
    const metaSpend = brandMeta.reduce((s, r) => s + (r.spend ?? 0), 0);
    const metaLeads = brandMeta.reduce((s, r) => s + (r.leads ?? 0), 0);
    const metaCpl = metaLeads > 0 ? metaSpend / metaLeads : 0;
    const metaRoas = metaSpend > 0
      ? brandMeta.reduce((s, r) => s + (r.attributed_revenue ?? 0), 0) / metaSpend
      : 0;

    byBrand[slug] = {
      brand: slug,
      totalLeads,
      totalBooked,
      totalSales,
      conversionPct: Math.round(conversionPct * 10) / 10,
      depositPct: Math.round(depositPct * 10) / 10,
      stlMedian: Math.round(stlMedian * 10) / 10,
      unrepliedWhatsapp,
      metaSpend: Math.round(metaSpend),
      metaLeads,
      metaCpl: Math.round(metaCpl * 10) / 10,
      metaRoas: Math.round(metaRoas * 100) / 100,
      daysWithData,
      isReal: daysWithData > 0,
    };
  }

  return { byBrand, isLoading: crmLoading || metaLoading };
}
