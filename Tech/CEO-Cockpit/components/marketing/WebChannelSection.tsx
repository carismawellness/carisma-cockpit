"use client";

/**
 * WebChannelSection — GA4 web analytics card for brand marketing dashboards.
 * Shows traffic, engagement, and (for Spa) ecommerce funnel metrics.
 * Data is sourced from Supabase ga4_daily via /api/analytics/web.
 */

import { Card } from "@/components/ui/card";
import { useWebAnalytics } from "@/lib/hooks/useWebAnalytics";
import {
  AggregateBox,
  ChannelHeader,
  EmptyState,
} from "@/components/marketing/ui";
import type { BrandPair } from "@/components/marketing/ui";
import { Globe, MapPin, Clock, BarChart3, Target, ShoppingCart, CreditCard, Package } from "lucide-react";

/* ---------- helpers ---------- */

function fmtDuration(sec: number | null): string {
  if (sec === null || sec === undefined) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtCount(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString();
}

/* ---------- Ecommerce funnel step ---------- */

interface FunnelStepProps {
  label: string;
  count: number | null;
  pct: number | null;
  prevPct: number | null;
  brandColor: string;
  brandFill: string;
  icon: React.ReactNode;
}

function FunnelStep({ label, count, pct, prevPct, brandColor, brandFill, icon }: FunnelStepProps) {
  // Retention from previous step: pct / prevPct * 100 — green if > 50%
  const retention = prevPct !== null && prevPct > 0 && pct !== null
    ? (pct / prevPct) * 100
    : null;
  const retentionColor = retention !== null && retention >= 50 ? "#22C55E" : "#EF4444";

  return (
    <div className="flex-1 min-w-0">
      <div
        className="rounded-xl p-4 border flex flex-col gap-2"
        style={{ borderColor: brandFill, backgroundColor: `${brandFill}50` }}
      >
        <div className="flex items-center gap-2">
          <div className="rounded-lg p-1.5" style={{ backgroundColor: brandFill }}>
            <span style={{ color: brandColor }}>{icon}</span>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500 leading-tight">
            {label}
          </p>
        </div>
        <p className="text-xl font-black tabular-nums" style={{ color: brandColor }}>
          {fmtPct(pct)}
        </p>
        <p className="text-[11px] text-gray-400 tabular-nums">
          {fmtCount(count)} events
        </p>
        {retention !== null && (
          <p className="text-[10px] font-bold tabular-nums" style={{ color: retentionColor }}>
            {retention.toFixed(0)}% of prev step
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------- Arrow divider ---------- */

function FunnelArrow({ brandColor }: { brandColor: string }) {
  return (
    <div className="flex items-center justify-center w-6 shrink-0 mt-8">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 8h10M9 4l4 4-4 4" stroke={brandColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/* ---------- Main component ---------- */

interface Props {
  brand: "spa" | "aesthetics" | "slimming";
  brandColor: string;
  brandFill: string;
  dateFrom: Date;
  dateTo: Date;
}

export function WebChannelSection({ brand, brandColor, brandFill, dateFrom, dateTo }: Props) {
  const brandPair: BrandPair = { dark: brandColor, soft: brandFill };
  const { analytics, loading, error } = useWebAnalytics(brand, dateFrom, dateTo);

  if (loading) {
    return (
      <Card className="p-5 md:p-6">
        <ChannelHeader title="Web Analytics" brand={brandPair} channelLabel="GA4" channelVariant="seo" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-gray-100" />
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-5 md:p-6">
        <ChannelHeader title="Web Analytics" brand={brandPair} channelLabel="GA4" channelVariant="seo" />
        <EmptyState message={`Web analytics error: ${error}`} />
      </Card>
    );
  }

  if (!analytics.hasData) {
    return (
      <Card className="p-5 md:p-6">
        <ChannelHeader title="Web Analytics" brand={brandPair} channelLabel="GA4" channelVariant="seo" />
        <EmptyState
          icon={Globe}
          message="Web analytics will appear here once GA4 property IDs are configured."
        />
      </Card>
    );
  }

  const isSpa = brand === "spa";
  const hasEcommerce = isSpa && analytics.viewItemCount !== null;

  return (
    <Card className="p-5 md:p-6">
      <ChannelHeader title="Web Analytics" brand={brandPair} channelLabel="GA4" channelVariant="seo" />

      {/* Row 1: Visitors, Malta Traffic, Session Duration */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <AggregateBox
          brand={brandPair}
          label="Total Visitors"
          value={analytics.sessions.toLocaleString()}
          icon={Globe}
        />
        <AggregateBox
          brand={brandPair}
          label={`Malta Traffic${analytics.maltaPct !== null ? ` (${fmtPct(analytics.maltaPct)})` : ""}`}
          value={analytics.maltaSessions !== null ? analytics.maltaSessions.toLocaleString() : "—"}
          icon={MapPin}
        />
        <AggregateBox
          brand={brandPair}
          label="Avg Session Duration"
          value={fmtDuration(analytics.avgSessionDurationSec)}
          icon={Clock}
        />
      </div>

      {/* Row 2: Bounce Rate, Conversion Rate, Page Views */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <AggregateBox
          brand={brandPair}
          label="Bounce Rate"
          value={fmtPct(analytics.bounceRatePct)}
          icon={BarChart3}
          valueColor={
            analytics.bounceRatePct !== null
              ? analytics.bounceRatePct < 40
                ? "#22C55E"
                : analytics.bounceRatePct < 60
                ? "#F59E0B"
                : "#EF4444"
              : undefined
          }
        />
        <AggregateBox
          brand={brandPair}
          label={`Conversion Rate${analytics.conversionRatePct !== null ? " (target: 2%)" : ""}`}
          value={fmtPct(analytics.conversionRatePct)}
          icon={Target}
          valueColor={
            analytics.conversionRatePct !== null
              ? analytics.conversionRatePct >= 2
                ? "#22C55E"
                : analytics.conversionRatePct >= 1
                ? "#F59E0B"
                : "#EF4444"
              : undefined
          }
        />
        <AggregateBox
          brand={brandPair}
          label="Page Views"
          value={analytics.pageViews.toLocaleString()}
          icon={BarChart3}
        />
      </div>

      {/* Spa-only: Ecommerce funnel */}
      {hasEcommerce && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">
              Ecommerce Funnel
            </p>
            <div className="flex-1 h-px" style={{ backgroundColor: brandFill }} />
          </div>

          <div className="flex items-start gap-0">
            <FunnelStep
              label="View Product"
              count={analytics.viewItemCount}
              pct={analytics.viewItemPct}
              prevPct={null}
              brandColor={brandColor}
              brandFill={brandFill}
              icon={<Package className="h-3 w-3" />}
            />
            <FunnelArrow brandColor={brandColor} />
            <FunnelStep
              label="Add to Cart"
              count={analytics.addToCartCount}
              pct={analytics.addToCartPct}
              prevPct={analytics.viewItemPct}
              brandColor={brandColor}
              brandFill={brandFill}
              icon={<ShoppingCart className="h-3 w-3" />}
            />
            <FunnelArrow brandColor={brandColor} />
            <FunnelStep
              label="Checkout"
              count={analytics.beginCheckoutCount}
              pct={analytics.beginCheckoutPct}
              prevPct={analytics.addToCartPct}
              brandColor={brandColor}
              brandFill={brandFill}
              icon={<CreditCard className="h-3 w-3" />}
            />
            <FunnelArrow brandColor={brandColor} />
            <FunnelStep
              label="Purchase"
              count={analytics.purchaseCount}
              pct={analytics.purchasePct}
              prevPct={analytics.beginCheckoutPct}
              brandColor={brandColor}
              brandFill={brandFill}
              icon={<Target className="h-3 w-3" />}
            />
          </div>

          <p className="text-[10px] text-gray-400 mt-3">
            Funnel % = events / total sessions. &quot;% of prev step&quot; shown in green when retention ≥ 50%.
          </p>
        </>
      )}
    </Card>
  );
}
