"use client";

/**
 * Marketing section of the Executive Summary.
 *
 * Mirrors the cross-brand Marketing Master dashboard (`app/marketing/page.tsx`):
 *  - same hooks: useMetaCampaignsFromDb / useGoogleCampaignsFromDb (3 brands each)
 *    + useKlaviyoOverview (3 brands)
 *  - same engine: computeMasterCommentary (lib/commentary/marketing-engine.ts)
 *
 * KPI strip is computed with the SAME blended definitions the commentary engine
 * uses so the headline verdict and the numbers stay internally consistent:
 *   ROAS  = Σrevenue / Σspend          (Meta + Google, all brands)
 *   Spend = Σspend                     (Meta + Google, all brands)
 *   Rev   = ΣattributedRevenue         (Meta + Google, all brands)
 *   CPL   = ΣmetaSpend / ΣmetaLeads    (Meta only — "cost per lead")
 *   CPC   = ΣgoogleSpend / ΣgoogleLeads (Google conversions — engine's blended CPC)
 *
 * CAVEAT: Marketing source data (Meta/Google/Klaviyo) is fetched via external
 * APIs through Supabase-backed routes and has NO prior-period comparison on the
 * source page, so KPIs carry no deltaPct (not available for this range).
 */

import { useEffect, useMemo } from "react";
import { Megaphone } from "lucide-react";
import { SectionCard } from "@/components/executive-summary/SectionCard";
import { formatCurrency } from "@/lib/charts/config";
import {
  useMetaCampaignsFromDb as useMetaCampaigns,
  useGoogleCampaignsFromDb as useGoogleCampaigns,
} from "@/lib/hooks/useAdsCampaigns";
import { useKlaviyoOverview } from "@/lib/hooks/useKlaviyoOverview";
import type { CampaignData } from "@/lib/types/ads";
import {
  computeMasterCommentary,
  type MktFatigueStats,
} from "@/lib/commentary/marketing-engine";
import { normalizeRag, type DeptHeadlineKpi, type SectionProps } from "@/lib/types/executive-summary";

const META = { slug: "marketing", label: "Marketing", path: "/marketing" } as const;

/** Replicates the master page's per-brand creative-fatigue tally (Meta + Google). */
function countFatigue(campaigns: CampaignData[]): MktFatigueStats {
  let healthy = 0, watch = 0, fatigued = 0;
  for (const c of campaigns) {
    const ctrDrop = c.peakCtr > 0 ? (c.peakCtr - c.ctr) / c.peakCtr : 0;
    if (c.frequency > 3.0 && ctrDrop > 0.2) fatigued++;
    else if (c.frequency >= 2.0 && ctrDrop >= 0.1) watch++;
    else healthy++;
  }
  return { healthy, watch, fatigued };
}

export function MarketingSummarySection({ dateFrom, dateTo, onSummary }: SectionProps) {
  /* Same data sources as app/marketing/page.tsx */
  const metaSpa = useMetaCampaigns("spa", dateFrom, dateTo);
  const metaAes = useMetaCampaigns("aesthetics", dateFrom, dateTo);
  const metaSlim = useMetaCampaigns("slimming", dateFrom, dateTo);
  const googleSpa = useGoogleCampaigns("spa", dateFrom, dateTo);
  const googleAes = useGoogleCampaigns("aesthetics", dateFrom, dateTo);
  const googleSlim = useGoogleCampaigns("slimming", dateFrom, dateTo);
  const { overview: klavSpa, loading: klavSpaLoading } = useKlaviyoOverview({ brand: "spa", dateFrom, dateTo });
  const { overview: klavAes, loading: klavAesLoading } = useKlaviyoOverview({ brand: "aesthetics", dateFrom, dateTo });
  const { overview: klavSlim, loading: klavSlimLoading } = useKlaviyoOverview({ brand: "slimming", dateFrom, dateTo });

  const loading =
    metaSpa.isFetching || metaAes.isFetching || metaSlim.isFetching ||
    googleSpa.isFetching || googleAes.isFetching || googleSlim.isFetching ||
    klavSpaLoading || klavAesLoading || klavSlimLoading;

  /* Strategic commentary — identical input construction to the master page. */
  const commentary = useMemo(() => {
    function buildBrand(
      brand: "spa" | "aesthetics" | "slimming",
      meta: CampaignData[],
      google: CampaignData[],
      klav: { openRate: number; clickRate: number; hasData: boolean },
      klavLoading: boolean,
    ) {
      const fatigue = countFatigue([...meta, ...google]);
      return {
        brand,
        meta: {
          totalSpend: meta.reduce((s, c) => s + c.totalSpend, 0),
          totalLeads: meta.reduce((s, c) => s + c.totalLeads, 0),
          attributedRevenue: meta.reduce((s, c) => s + c.attributedRevenue, 0),
          fatigueStats: fatigue,
        },
        google: {
          totalSpend: google.reduce((s, c) => s + c.totalSpend, 0),
          totalLeads: google.reduce((s, c) => s + c.totalLeads, 0),
          attributedRevenue: google.reduce((s, c) => s + c.attributedRevenue, 0),
          fatigueStats: { healthy: 0, watch: 0, fatigued: 0 },
        },
        email: {
          openRate: klav.openRate,
          clickRate: klav.clickRate,
          hasData: !klavLoading && klav.hasData,
        },
      };
    }
    return computeMasterCommentary({
      spa:        buildBrand("spa",        metaSpa.data?.campaigns  ?? [], googleSpa.data?.campaigns  ?? [], klavSpa,  klavSpaLoading),
      aesthetics: buildBrand("aesthetics", metaAes.data?.campaigns  ?? [], googleAes.data?.campaigns  ?? [], klavAes,  klavAesLoading),
      slimming:   buildBrand("slimming",   metaSlim.data?.campaigns ?? [], googleSlim.data?.campaigns ?? [], klavSlim, klavSlimLoading),
    });
  }, [
    metaSpa.data, metaAes.data, metaSlim.data,
    googleSpa.data, googleAes.data, googleSlim.data,
    klavSpa, klavAes, klavSlim,
    klavSpaLoading, klavAesLoading, klavSlimLoading,
  ]);

  /* Blended KPIs — same definitions the commentary engine uses. */
  const kpis = useMemo<DeptHeadlineKpi[]>(() => {
    const meta = [
      ...(metaSpa.data?.campaigns ?? []),
      ...(metaAes.data?.campaigns ?? []),
      ...(metaSlim.data?.campaigns ?? []),
    ];
    const google = [
      ...(googleSpa.data?.campaigns ?? []),
      ...(googleAes.data?.campaigns ?? []),
      ...(googleSlim.data?.campaigns ?? []),
    ];
    const all = [...meta, ...google];

    const spend = all.reduce((s, c) => s + c.totalSpend, 0);
    const revenue = all.reduce((s, c) => s + c.attributedRevenue, 0);
    const metaSpend = meta.reduce((s, c) => s + c.totalSpend, 0);
    const metaLeads = meta.reduce((s, c) => s + c.totalLeads, 0);
    const googleSpend = google.reduce((s, c) => s + c.totalSpend, 0);
    const googleLeads = google.reduce((s, c) => s + c.totalLeads, 0);

    const roas = spend > 0 ? revenue / spend : 0;

    return [
      { label: "Blended ROAS", value: spend > 0 ? `${roas.toFixed(1)}x` : "—" },
      { label: "Ad Spend", value: formatCurrency(spend) },
      { label: "Attributed Rev", value: formatCurrency(revenue) },
      { label: "Meta CPL", value: metaLeads > 0 ? `€${(metaSpend / metaLeads).toFixed(1)}` : "—", invertDelta: true },
      { label: "Google CPC", value: googleLeads > 0 ? `€${(googleSpend / googleLeads).toFixed(2)}` : "—", invertDelta: true },
    ];
  }, [
    metaSpa.data, metaAes.data, metaSlim.data,
    googleSpa.data, googleAes.data, googleSlim.data,
  ]);

  const rag = normalizeRag(commentary.overallRag);
  const headline = commentary.hasData
    ? commentary.verdict
    : "No campaign data available for the selected period.";

  /* Report up to the page — only inside an effect, never during render. */
  useEffect(() => {
    if (loading) {
      onSummary({
        ...META,
        rag: "NEUTRAL",
        headline: "Loading marketing summary…",
        kpis: [],
        focusAreas: [],
        wins: [],
        loading: true,
      });
      return;
    }
    onSummary({
      ...META,
      rag,
      headline,
      kpis,
      focusAreas: commentary.focusAreas,
      wins: commentary.workingWell,
      loading: false,
    });
  }, [loading, rag, headline, kpis, commentary.focusAreas, commentary.workingWell, onSummary]);

  return (
    <SectionCard
      {...META}
      icon={Megaphone}
      rag={loading ? "NEUTRAL" : rag}
      headline={loading ? "" : headline}
      kpis={loading ? [] : kpis}
      focusAreas={loading ? [] : commentary.focusAreas}
      wins={loading ? [] : commentary.workingWell}
      loading={loading}
    />
  );
}
