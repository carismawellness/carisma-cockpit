"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, ArrowUpRight,
  TrendingUp, TrendingDown, Minus, RefreshCw, FileSpreadsheet,
} from "lucide-react";
import { CIChat } from "@/components/ci/CIChat";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { chartColors, formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useSpaEbitda, SPA_LOCATION_META } from "@/lib/hooks/useSpaEbitda";
import { useAestheticsEbitda } from "@/lib/hooks/useAestheticsEbitda";
import { useHqEbitda } from "@/lib/hooks/useHqEbitda";
import { useEbitdaAggregated } from "@/lib/hooks/useEbitdaAggregated";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

type Brand = "Spa" | "Aesthetics" | "Slimming";

interface VenueRow {
  id: string;
  name: string;
  brand: Brand;
  brandColor: string;
  wages: number;
  advertising: number;
  rent: number;
  utilities: number;
  cogs: number;
  sga: number;
  ebitda: number;
  revenue: number;
}

/* ------------------------------------------------------------------ */
/*  SG&A CATEGORY BREAKDOWN (allocated weights — placeholder until    */
/*  per-account Zoho line-items are wired into this view)              */
/* ------------------------------------------------------------------ */

const SGA_CATEGORIES: { label: string; weight: number }[] = [
  { label: "Prof services", weight: 20000 },
  { label: "Fuel",          weight: 5000  },
  { label: "Laundry",       weight: 50    },
  { label: "Software",      weight: 10    },
  { label: "Cleaning",      weight: 10    },
  { label: "Travel",        weight: 10    },
  { label: "Misc",          weight: 10    },
  { label: "Insurance",     weight: 8     },
  { label: "Events",        weight: 5     },
  { label: "Maintenance",   weight: 5     },
  { label: "Telecom",       weight: 2     },
];
const SGA_WEIGHT_TOTAL = SGA_CATEGORIES.reduce((a, c) => a + c.weight, 0);
function sgaShare(total: number, weight: number) {
  return Math.round(total * (weight / SGA_WEIGHT_TOTAL));
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

type Status = "green" | "amber" | "red";

function pctOf(part: number, whole: number) {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
function fmtPct(v: number) { return `${Math.round(v)}%`; }
function fmtCurrencyShort(v: number) {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(1)}`;
}

function statusColor(s: Status) {
  return s === "green" ? "bg-emerald-50 border-emerald-200"
       : s === "amber" ? "bg-amber-50 border-amber-200"
       :                 "bg-red-50 border-red-200";
}
function statusDot(s: Status) {
  return s === "green" ? "bg-emerald-500" : s === "amber" ? "bg-amber-500" : "bg-red-500";
}
function statusText(s: Status) {
  return s === "green" ? "text-emerald-700" : s === "amber" ? "text-amber-700" : "text-red-700";
}
function getStatus(v: number, green: number, amber: number): Status {
  return v >= green ? "green" : v >= amber ? "amber" : "red";
}
function TrendIcon({ trend }: { trend: number }) {
  if (trend > 0) return <TrendingUp className="h-4 w-4 text-emerald-600" />;
  if (trend < 0) return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-gray-400" />;
}

/* ------------------------------------------------------------------ */
/*  WATERFALL BUILDER                                                  */
/* ------------------------------------------------------------------ */

function buildWaterfall(rows: VenueRow[], hqEbitda: number) {
  const entries: {
    name: string; value: number; cumulative: number;
    start: number; end: number; isTotal?: boolean;
  }[] = [];
  let running = 0;

  const spaRows = rows.filter(v => v.brand === "Spa").sort((a, b) => b.ebitda - a.ebitda);
  for (const row of spaRows) {
    const s = running;
    running += row.ebitda;
    entries.push({ name: row.name, value: row.ebitda, cumulative: running, start: s, end: running });
  }
  for (const row of rows.filter(v => v.brand !== "Spa")) {
    const s = running;
    running += row.ebitda;
    entries.push({ name: row.name, value: row.ebitda, cumulative: running, start: s, end: running });
  }
  if (hqEbitda !== 0) {
    const s = running;
    running += hqEbitda;
    entries.push({ name: "Corporate / HQ", value: hqEbitda, cumulative: running, start: s, end: running });
  }
  entries.push({ name: "Group EBITDA", value: running, cumulative: running, start: 0, end: running, isTotal: true });
  return entries;
}

/* ------------------------------------------------------------------ */
/*  INNER COMPONENT                                                    */
/* ------------------------------------------------------------------ */

function EBITDAOverviewContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {

  /* ── Live data hooks ─────────────────────────────────────────────── */
  // Per-venue hooks still drive the venue P&L table and waterfall — the
  // aggregated API only has brand-level granularity.
  const spa = useSpaEbitda(dateFrom, dateTo);
  const aes = useAestheticsEbitda(dateFrom, dateTo);
  const hq  = useHqEbitda(dateFrom, dateTo);
  // Brand summary cards (top of page) now come from the aggregated API,
  // which applies TTM / manual / previous-month / quarterly-average
  // fallback rules and reads from the live Zoho-backed Aggregated Data tab.
  const agg = useEbitdaAggregated(dateFrom, dateTo);

  /* ── EBITDA Export ───────────────────────────────────────────────── */
  // Calls /api/finance/ebitda-export which talks to Apps Script and writes
  // a timestamped tab to the Accounting Master sheet. We only show
  // ok/err + the new tab name; the user opens the sheet to see it.
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function runEbitdaExport() {
    if (exporting) return;
    setExporting(true);
    setExportMsg(null);
    try {
      // Local-date ISO (not UTC) — see the same fix in useEbitdaAggregated.
      // toISOString() would shift midnight-local to the previous UTC day
      // for users east of GMT, breaking partial-period detection in the
      // aggregated route.
      const isoLocal = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      const df = isoLocal(dateFrom);
      const dt = isoLocal(dateTo);
      const res = await fetch(
        `/api/finance/ebitda-export?date_from=${df}&date_to=${dt}`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setExportMsg({ ok: true, text: `Tab ${json.tab ?? "exported"}` });
    } catch (e) {
      setExportMsg({ ok: false, text: (e as Error).message });
    } finally {
      setExporting(false);
      setTimeout(() => setExportMsg(null), 6000);
    }
  }

  const isFetching    = spa.isFetching || aes.isFetching || hq.isFetching || agg.isFetching;
  const isSyncing     = spa.isSyncing  || aes.isSyncing  || hq.isSyncing;
  const syncError     = spa.syncError  || aes.syncError  || hq.syncError || (agg.error ? agg.error.message : null);
  const missingMonths = [...spa.missingMonths, ...aes.missingMonths, ...hq.missingMonths];
  // CORPORATE (= HQ) used to come from the old useHqEbitda hook. It now
  // comes from the aggregated API so partial periods get fallback
  // smoothing too. Field shape is identical (revenue/wages/.../ebitda).
  const CORPORATE     = agg.hqRow;

  /* ── Dept splits (now from aggregated API) ─────────────────────── */
  const aesData  = agg.aesRow;
  const slimData = agg.slimRow;

  /* ── Brand aggregates (sourced from aggregated API) ─────────────── */
  // These now reflect TTM-spread / manual-annual / previous-month /
  // quarterly-average fallback rules — correct for partial-period EBITDA.
  // The venue table below still uses the per-venue Supabase hooks; numbers
  // can disagree on partial periods (the aggregated values are the truth).
  const spaTotals = useMemo(() => ({
    revenue: agg.spa.revenue, ebitda: agg.spa.ebitda,
  }), [agg.spa.revenue, agg.spa.ebitda]);

  const aesSummary = useMemo(() => ({
    revenue:   agg.aes.revenue,
    ebitda:    agg.aes.ebitda,
    ebitdaPct: agg.aes.ebitdaPct,
  }), [agg.aes.revenue, agg.aes.ebitda, agg.aes.ebitdaPct]);

  const slimSummary = useMemo(() => ({
    revenue:   agg.slim.revenue,
    ebitda:    agg.slim.ebitda,
    ebitdaPct: agg.slim.ebitdaPct,
  }), [agg.slim.revenue, agg.slim.ebitda, agg.slim.ebitdaPct]);

  const groupRevenue = spaTotals.revenue + aesSummary.revenue + slimSummary.revenue + agg.hq.revenue;
  const groupEbitda  = spaTotals.ebitda  + aesSummary.ebitda  + slimSummary.ebitda  + agg.hq.ebitda;
  const groupMargin  = groupRevenue > 0 ? Math.round((groupEbitda / groupRevenue) * 100) : 0;

  /* ── Date labels ─────────────────────────────────────────────────── */
  const monthCount = useMemo(
    () => (dateTo.getFullYear() - dateFrom.getFullYear()) * 12
        + dateTo.getMonth() - dateFrom.getMonth() + 1,
    [dateFrom, dateTo],
  );
  const monthLabel = monthCount === 1 ? "1 month" : `${monthCount} months`;
  const rangeLabel = useMemo(() => formatDateRangeLabel(dateFrom, dateTo), [dateFrom, dateTo]);

  /* ── KPI status ──────────────────────────────────────────────────── */
  const ebitdaStatus: Status = getStatus(groupMargin, 30, 15);

  /* ── Venue rows for P&L table (from aggregated API) ─────────────── */
  // SPA venues come from the aggregated API's column-E values. Reverse
  // SPA_LOCATION_META once so we keep the existing brand colours and slug
  // ids for venues we recognise. Unknown venue names still render with
  // a sensible default colour.
  const spaVenueDisplayMeta = useMemo(() => {
    const m: Record<string, { slug: string; color: string }> = {};
    for (const slug in SPA_LOCATION_META) {
      const meta = SPA_LOCATION_META[slug];
      m[meta.name.toLowerCase()] = { slug, color: meta.color };
    }
    return m;
  }, []);

  const venueRows = useMemo((): VenueRow[] => {
    const spaRows: VenueRow[] = agg.spaVenues.map(v => {
      const meta = spaVenueDisplayMeta[v.venueKey.toLowerCase()] ?? {
        slug:  v.venueKey || "spa-other",
        color: chartColors.spa,
      };
      return {
        id:         meta.slug,
        name:       v.venueKey || "Spa (unmapped)",
        brand:      "Spa" as Brand,
        brandColor: meta.color,
        wages:       v.wages,
        advertising: v.advertising,
        rent:        v.rent,
        utilities:   v.utilities,
        cogs:        v.cogs,
        sga:         v.sga,
        ebitda:      v.ebitda,
        revenue:     v.revenue,
      };
    });

    const aesRow: VenueRow | null = aesData.revenue > 0 ? {
      id: "aesthetics", name: "Aesthetics", brand: "Aesthetics" as Brand,
      brandColor: chartColors.aesthetics,
      wages: aesData.wages, advertising: aesData.advertising, rent: aesData.rent,
      utilities: aesData.utilities, cogs: aesData.cogs, sga: aesData.sga,
      ebitda: aesData.ebitda, revenue: aesData.revenue,
    } : null;

    const slimRow: VenueRow | null = slimData.revenue > 0 ? {
      id: "slimming", name: "Slimming", brand: "Slimming" as Brand,
      brandColor: chartColors.slimming,
      wages: slimData.wages, advertising: slimData.advertising, rent: slimData.rent,
      utilities: slimData.utilities, cogs: slimData.cogs, sga: slimData.sga,
      ebitda: slimData.ebitda, revenue: slimData.revenue,
    } : null;

    return [
      ...spaRows,
      ...(aesRow  ? [aesRow]  : []),
      ...(slimRow ? [slimRow] : []),
    ].filter(v => v.revenue > 0);
  }, [agg.spaVenues, aesData, slimData, spaVenueDisplayMeta]);

  const venueTotals = useMemo(() => venueRows.reduce(
    (acc, v) => ({
      revenue:     acc.revenue     + v.revenue,
      wages:       acc.wages       + v.wages,
      advertising: acc.advertising + v.advertising,
      rent:        acc.rent        + v.rent,
      utilities:   acc.utilities   + v.utilities,
      cogs:        acc.cogs        + v.cogs,
      sga:         acc.sga         + v.sga,
      ebitda:      acc.ebitda      + v.ebitda,
    }),
    { revenue: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, cogs: 0, sga: 0, ebitda: 0 },
  ), [venueRows]);

  /* ── Table expand states ─────────────────────────────────────────── */
  const [rentExpanded, setRentExpanded] = useState(false);
  const [adsExpanded,  setAdsExpanded]  = useState(false);
  const [sgaExpanded,  setSgaExpanded]  = useState(false);
  const [spaExpanded,  setSpaExpanded]  = useState(false);

  /* ── Spa aggregate row for collapsed view ────────────────────────── */
  const spaVenueCount  = useMemo(() => venueRows.filter(v => v.brand === "Spa").length, [venueRows]);
  const displayedVenues = useMemo(() => {
    const spaVenues = venueRows.filter(v => v.brand === "Spa");
    const rest      = venueRows.filter(v => v.brand !== "Spa");
    if (spaExpanded || spaVenues.length === 0) return venueRows;
    const agg: VenueRow = {
      id: "spa-aggregate", name: "Spa", brand: "Spa", brandColor: chartColors.spa,
      revenue:     spaVenues.reduce((a, v) => a + v.revenue,     0),
      wages:       spaVenues.reduce((a, v) => a + v.wages,       0),
      advertising: spaVenues.reduce((a, v) => a + v.advertising, 0),
      rent:        spaVenues.reduce((a, v) => a + v.rent,        0),
      utilities:   spaVenues.reduce((a, v) => a + v.utilities,   0),
      cogs:        spaVenues.reduce((a, v) => a + v.cogs,        0),
      sga:         spaVenues.reduce((a, v) => a + v.sga,         0),
      ebitda:      spaVenues.reduce((a, v) => a + v.ebitda,      0),
    };
    return [agg, ...rest];
  }, [venueRows, spaExpanded]);

  /* ── Advertising channel breakdown (real data from line_items) ──── */
  // Aggregates lineItems where ebitda_category === "advertising" into the
  // 5 fixed channel buckets (Meta / Google / Klaviyo / GHL / Misc). Channel
  // is pre-resolved server-side via the advertising_contact_mapping table
  // (anything unmatched or with null contact lands in Misc). Per-venue
  // values are keyed by the same venueRow.id slugs used in displayedVenues,
  // so the SPA-aggregate column can sum them at render time.
  type AdChannelRow = {
    label:    string;
    perVenue: Record<string, number>;    // keyed by venueRow.id
    hq:       number;
    total:    number;
  };
  const adChannelRows = useMemo((): AdChannelRow[] => {
    const order = ["Meta", "Google", "Klaviyo", "GHL", "Misc"] as const;
    const byLabel: Record<string, AdChannelRow> = {};
    for (const label of order) {
      byLabel[label] = { label, perVenue: {}, hq: 0, total: 0 };
    }
    for (const li of agg.lineItems) {
      if (li.ebitda_category !== "advertising") continue;
      const v = li.period_value;
      if (v === 0) continue;
      const label = (li.ad_channel && order.includes(li.ad_channel as typeof order[number]))
        ? li.ad_channel
        : "Misc";
      const row = byLabel[label];
      if (li.brand === "HQ") {
        row.hq += v;
      } else if (li.brand === "SPA") {
        const slug = spaVenueDisplayMeta[li.venue.toLowerCase()]?.slug
                  ?? (li.venue || "spa-other");
        row.perVenue[slug] = (row.perVenue[slug] ?? 0) + v;
      } else if (li.brand === "AES") {
        row.perVenue["aesthetics"] = (row.perVenue["aesthetics"] ?? 0) + v;
      } else if (li.brand === "SLIM") {
        row.perVenue["slimming"] = (row.perVenue["slimming"] ?? 0) + v;
      }
      row.total += v;
    }
    return order.map(l => byLabel[l]);
  }, [agg.lineItems, spaVenueDisplayMeta]);

  // Sum spa-venue keys into a single value for the spa-aggregate column.
  // Used when SPA is collapsed (displayedVenues includes {id: "spa-aggregate"}).
  const spaSlugs = useMemo(() => new Set(Object.values(SPA_LOCATION_META).map(m => m.name.toLowerCase())
    .map(name => spaVenueDisplayMeta[name]?.slug ?? name)),
    [spaVenueDisplayMeta]);

  function adChannelValueForVenue(row: AdChannelRow, venueId: string): number {
    if (venueId !== "spa-aggregate") return row.perVenue[venueId] ?? 0;
    let sum = 0;
    for (const k in row.perVenue) {
      if (spaSlugs.has(k) || k === "spa-other") sum += row.perVenue[k];
    }
    return sum;
  }

  /* ── Waterfall & brand cards ─────────────────────────────────────── */
  const waterfallData = useMemo(() => buildWaterfall(venueRows, CORPORATE.ebitda), [venueRows, CORPORATE.ebitda]);

  const brands = useMemo(() => [
    {
      name: "Spa", color: chartColors.spa,
      revenue: spaTotals.revenue, ebitda: spaTotals.ebitda,
      margin: spaTotals.revenue > 0 ? Math.round((spaTotals.ebitda / spaTotals.revenue) * 100) : 0,
    },
    {
      name: "Aesthetics", color: chartColors.aesthetics,
      revenue: aesSummary.revenue, ebitda: aesSummary.ebitda, margin: aesSummary.ebitdaPct,
    },
    {
      name: "Slimming", color: chartColors.slimming,
      revenue: slimSummary.revenue, ebitda: slimSummary.ebitda, margin: slimSummary.ebitdaPct,
    },
  ], [spaTotals, aesSummary, slimSummary]);

  /* ── Render ──────────────────────────────────────────────────────── */
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">EBITDA Overview</h1>
          <p className="text-sm text-muted-foreground">
            Group-wide EBITDA performance — {rangeLabel} ({monthLabel})
          </p>
        </div>
        <div className="flex items-center gap-3">
          {syncError && (
            <span className="text-xs text-red-500 max-w-[200px] truncate" title={syncError}>{syncError}</span>
          )}
          {missingMonths.length > 0 && !isSyncing && (
            <span className="text-xs text-amber-600">{missingMonths.length} month(s) missing</span>
          )}
          <button
            type="button"
            onClick={() => { spa.triggerSync(true); aes.triggerSync(true); hq.triggerSync(true); }}
            disabled={isSyncing || isFetching}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing…" : isFetching ? "Loading…" : "Sync"}
          </button>
          {exportMsg && (
            <span
              className={`text-xs max-w-[220px] truncate ${exportMsg.ok ? "text-emerald-600" : "text-red-500"}`}
              title={exportMsg.text}
            >
              {exportMsg.text}
            </span>
          )}
          <button
            type="button"
            onClick={runEbitdaExport}
            disabled={exporting}
            title="Write a timestamped EBITDA tab to the Accounting Master sheet"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <FileSpreadsheet className={`h-3.5 w-3.5 ${exporting ? "animate-pulse" : ""}`} />
            {exporting ? "Exporting…" : "EBITDA Export"}
          </button>
        </div>
      </div>

      {/* Loading state */}
      {isFetching && venueRows.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
          Loading EBITDA data…
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4 md:p-6 border-2 bg-emerald-50 border-emerald-200">
          <div className="flex items-start justify-between mb-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Group Net Revenue</p>
            <span className="text-muted-foreground"><ArrowUpRight className="h-4 w-4" /></span>
          </div>
          <div className="flex items-end gap-3 mb-2">
            <span className="text-3xl md:text-4xl font-bold text-foreground">{formatCurrency(groupRevenue)}</span>
            <div className="flex items-center gap-1 pb-1">
              <TrendIcon trend={1} />
              <span className="text-sm font-medium text-emerald-600">{monthLabel}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>
              <span className="font-medium" style={{ color: chartColors.spa }}>Spa</span>{" "}
              {formatCurrency(spaTotals.revenue)}
            </span>
            <span>
              <span className="font-medium" style={{ color: chartColors.aesthetics }}>Aes</span>{" "}
              {formatCurrency(aesSummary.revenue)}
            </span>
            <span>
              <span className="font-medium" style={{ color: chartColors.slimming }}>Slim</span>{" "}
              {formatCurrency(slimSummary.revenue)}
            </span>
          </div>
        </Card>

        <Card className={`p-4 md:p-6 border-2 ${statusColor(ebitdaStatus)}`}>
          <div className="flex items-start justify-between mb-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Group EBITDA ({monthLabel})
            </p>
            <span className="text-muted-foreground"><ArrowUpRight className="h-4 w-4" /></span>
          </div>
          <div className="flex items-end gap-3 mb-2">
            <span className="text-3xl md:text-4xl font-bold text-foreground">{formatCurrency(groupEbitda)}</span>
            <span className="text-sm text-muted-foreground pb-1">{groupMargin}% margin</span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className={`inline-block h-2 w-2 rounded-full ${statusDot(ebitdaStatus)}`} />
            <span className={statusText(ebitdaStatus)}>
              {ebitdaStatus === "green" ? "On track" : ebitdaStatus === "amber" ? "Below target" : "Critical"}
            </span>
            <span className="text-muted-foreground ml-2">Target 30%</span>
          </div>
        </Card>
      </div>

      {/* Brand Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
        {brands.map(brand => (
          <Card key={brand.name} className="p-3 md:p-6 border-l-4" style={{ borderLeftColor: brand.color }}>
            <h3 className="font-semibold text-foreground mb-3">{brand.name}</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Revenue</span>
                <span className="text-sm font-medium text-foreground">{formatCurrency(brand.revenue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">EBITDA</span>
                <span className={`text-sm font-bold ${brand.ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {formatCurrency(brand.ebitda)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">EBITDA Margin</span>
                <span className={`text-sm font-semibold ${brand.margin >= 30 ? "text-emerald-600" : brand.margin >= 15 ? "text-amber-500" : "text-red-600"}`}>
                  {brand.margin}%
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* P&L by Venue */}
      <Card className="p-3 md:p-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-1">P&amp;L by Venue</h2>
            <p className="text-sm text-muted-foreground">
              {spaExpanded
                ? `All ${venueRows.length} active venues side-by-side.`
                : `Spa rolled up (${spaVenueCount} venues) — click to expand. Costs shown as positive values against revenue.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setSpaExpanded(x => !x)}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/80 hover:text-foreground border border-border rounded-md px-2 py-1 transition-colors hover:bg-muted/50"
              aria-expanded={spaExpanded}
            >
              {spaExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {spaExpanded ? `Collapse Spa (${spaVenueCount})` : `Expand Spa (${spaVenueCount})`}
            </button>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
              {([
                { color: chartColors.spa,        label: "Spa"        },
                { color: chartColors.aesthetics, label: "Aesthetics" },
                { color: chartColors.slimming,   label: "Slimming"   },
              ] as const).map(({ color, label }) => (
                <span key={label} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-3 rounded-sm" style={{ backgroundColor: color }} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto -mx-3 md:-mx-6 px-3 md:px-6">
          <table className="w-full text-xs whitespace-nowrap border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left py-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sticky left-0 bg-background z-10 min-w-[120px] border-b border-border align-bottom">
                  Line Item
                </th>
                {displayedVenues.map(v => {
                  const isAgg = v.id === "spa-aggregate";
                  return (
                    <th
                      key={v.id}
                      className={`text-right py-2 px-2 font-semibold text-foreground min-w-[88px] border-b border-border align-bottom ${isAgg ? "bg-amber-50/40" : ""}`}
                    >
                      {isAgg ? (
                        <button
                          type="button"
                          onClick={() => setSpaExpanded(true)}
                          className="flex flex-col items-end gap-1 w-full cursor-pointer group"
                          title={`Expand to show ${spaVenueCount} individual Spa venues`}
                        >
                          <span className="block h-[2px] w-6 rounded-full" style={{ backgroundColor: v.brandColor }} />
                          <span className="inline-flex items-center gap-1 text-foreground group-hover:text-foreground/70 transition-colors">
                            <ChevronRight className="h-3 w-3" />{v.name}
                          </span>
                        </button>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <span className="block h-[2px] w-6 rounded-full" style={{ backgroundColor: v.brandColor }} title={v.brand} />
                          <span>{v.name}</span>
                        </div>
                      )}
                    </th>
                  );
                })}
                <th className="text-right py-2 px-2 font-semibold text-foreground bg-slate-50/60 border-l-2 border-border/80 border-b border-border min-w-[88px] align-bottom" title="HQ / corporate overhead (placeholder)">
                  <div className="flex flex-col items-end gap-1">
                    <span className="block h-[2px] w-6 rounded-full bg-slate-300" />
                    <span>HQ</span>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-bold text-foreground bg-slate-100/70 border-l-2 border-border border-b border-border min-w-[92px] align-bottom">
                  <div className="flex flex-col items-end gap-1">
                    <span className="block h-[2px] w-6 rounded-full bg-slate-500" />
                    <span>Group</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Net Revenue */}
              <tr className="group bg-slate-50/40 hover:bg-slate-50/80 transition-colors">
                <td className="py-2 px-2 text-[13px] font-semibold text-foreground sticky left-0 bg-slate-50/40 group-hover:bg-slate-50/80 z-10 border-b border-border transition-colors">Net Revenue</td>
                {displayedVenues.map(v => (
                  <td key={v.id} className="py-2 px-2 text-right text-[13px] font-semibold text-foreground tabular-nums border-b border-border">
                    {fmtCurrencyShort(v.revenue)}
                  </td>
                ))}
                <td className="py-2 px-2 text-right text-[13px] font-semibold text-foreground tabular-nums bg-slate-50/60 border-l-2 border-border/80 border-b border-border">
                  {CORPORATE.revenue > 0 ? fmtCurrencyShort(CORPORATE.revenue) : <span className="text-muted-foreground font-normal">&mdash;</span>}
                </td>
                <td className="py-2 px-2 text-right text-[13px] font-bold text-foreground tabular-nums bg-slate-100/70 border-l-2 border-border border-b border-border">
                  {fmtCurrencyShort(venueTotals.revenue + CORPORATE.revenue)}
                </td>
              </tr>

              {/* Wages */}
              <tr className="group hover:bg-muted/30 transition-colors">
                <td className="py-1.5 px-2 text-foreground sticky left-0 bg-background group-hover:bg-muted/30 z-10 border-b border-border/60 transition-colors">Wages &amp; Salaries</td>
                {displayedVenues.map(v => (
                  <td key={v.id} className="py-1.5 px-2 text-right text-foreground tabular-nums border-b border-border/60">
                    {fmtCurrencyShort(v.wages)} <span className="text-muted-foreground/80">· {fmtPct(pctOf(v.wages, v.revenue))}</span>
                  </td>
                ))}
                <td className="py-1.5 px-2 text-right tabular-nums bg-slate-50/60 border-l-2 border-border/80 border-b border-border/60">
                  {CORPORATE.wages > 0 ? fmtCurrencyShort(CORPORATE.wages) : <span className="text-muted-foreground">&mdash;</span>}
                </td>
                <td className="py-1.5 px-2 text-right font-medium text-foreground tabular-nums bg-slate-100/70 border-l-2 border-border border-b border-border/60">
                  {fmtCurrencyShort(venueTotals.wages + CORPORATE.wages)}{" "}
                  <span className="text-muted-foreground/80 font-normal">· {fmtPct(pctOf(venueTotals.wages + CORPORATE.wages, venueTotals.revenue))}</span>
                </td>
              </tr>

              {/* Advertising */}
              <tr className="group hover:bg-muted/30 transition-colors">
                <td className="py-1.5 px-2 text-foreground sticky left-0 bg-background group-hover:bg-muted/30 z-10 border-b border-border/60 transition-colors">
                  <button type="button" onClick={() => setAdsExpanded(x => !x)} className="flex items-center gap-1 hover:text-foreground/70 transition-colors" aria-expanded={adsExpanded}>
                    {adsExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <span>Advertising</span>
                  </button>
                </td>
                {displayedVenues.map(v => (
                  <td key={v.id} className="py-1.5 px-2 text-right text-foreground tabular-nums border-b border-border/60">
                    {fmtCurrencyShort(v.advertising)} <span className="text-muted-foreground/80">· {fmtPct(pctOf(v.advertising, v.revenue))}</span>
                  </td>
                ))}
                <td className="py-1.5 px-2 text-right tabular-nums bg-slate-50/60 border-l-2 border-border/80 border-b border-border/60">
                  {CORPORATE.advertising > 0 ? fmtCurrencyShort(CORPORATE.advertising) : <span className="text-muted-foreground">&mdash;</span>}
                </td>
                <td className="py-1.5 px-2 text-right font-medium text-foreground tabular-nums bg-slate-100/70 border-l-2 border-border border-b border-border/60">
                  {fmtCurrencyShort(venueTotals.advertising + CORPORATE.advertising)}{" "}
                  <span className="text-muted-foreground/80 font-normal">· {fmtPct(pctOf(venueTotals.advertising + CORPORATE.advertising, venueTotals.revenue))}</span>
                </td>
              </tr>
              {adsExpanded && adChannelRows.map(row => (
                <tr key={row.label} className="group hover:bg-muted/30 transition-colors">
                  <td className="py-1 px-2 text-muted-foreground sticky left-0 bg-background group-hover:bg-muted/30 z-10 border-b border-border/40 transition-colors">
                    <span className="inline-flex items-center pl-5 border-l border-border/60 ml-1">
                      <span>{row.label}</span>
                    </span>
                  </td>
                  {displayedVenues.map(v => {
                    const part = adChannelValueForVenue(row, v.id);
                    return (
                      <td key={v.id} className="py-1 px-2 text-right text-muted-foreground tabular-nums border-b border-border/40">
                        {part === 0
                          ? <span className="text-muted-foreground/40">&mdash;</span>
                          : <>{fmtCurrencyShort(part)} <span className="text-muted-foreground/60">· {fmtPct(pctOf(part, v.revenue))}</span></>}
                      </td>
                    );
                  })}
                  <td className="py-1 px-2 text-right text-muted-foreground tabular-nums bg-slate-50/60 border-l-2 border-border/80 border-b border-border/40">
                    {row.hq === 0
                      ? <span className="text-muted-foreground/40">&mdash;</span>
                      : fmtCurrencyShort(row.hq)}
                  </td>
                  <td className="py-1 px-2 text-right text-muted-foreground tabular-nums bg-slate-100/70 border-l-2 border-border border-b border-border/40">
                    {row.total === 0
                      ? <span className="text-muted-foreground/40">&mdash;</span>
                      : <>{fmtCurrencyShort(row.total)} <span className="text-muted-foreground/60">· {fmtPct(pctOf(row.total, venueTotals.revenue))}</span></>}
                  </td>
                </tr>
              ))}

              {/* SG&A */}
              <tr className="group hover:bg-muted/30 transition-colors">
                <td className="py-1.5 px-2 text-foreground sticky left-0 bg-background group-hover:bg-muted/30 z-10 border-b border-border/60 transition-colors">
                  <button type="button" onClick={() => setSgaExpanded(x => !x)} className="flex items-center gap-1 hover:text-foreground/70 transition-colors" aria-expanded={sgaExpanded}>
                    {sgaExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <span>SG&amp;A</span>
                  </button>
                </td>
                {displayedVenues.map(v => (
                  <td key={v.id} className="py-1.5 px-2 text-right text-foreground tabular-nums border-b border-border/60">
                    {fmtCurrencyShort(v.sga)} <span className="text-muted-foreground/80">· {fmtPct(pctOf(v.sga, v.revenue))}</span>
                  </td>
                ))}
                <td className="py-1.5 px-2 text-right tabular-nums bg-slate-50/60 border-l-2 border-border/80 border-b border-border/60">
                  {CORPORATE.sga > 0 ? fmtCurrencyShort(CORPORATE.sga) : <span className="text-muted-foreground">&mdash;</span>}
                </td>
                <td className="py-1.5 px-2 text-right font-medium text-foreground tabular-nums bg-slate-100/70 border-l-2 border-border border-b border-border/60">
                  {fmtCurrencyShort(venueTotals.sga + CORPORATE.sga)}{" "}
                  <span className="text-muted-foreground/80 font-normal">· {fmtPct(pctOf(venueTotals.sga + CORPORATE.sga, venueTotals.revenue))}</span>
                </td>
              </tr>
              {sgaExpanded && SGA_CATEGORIES.map(({ label, weight }) => (
                <tr key={label} className="group hover:bg-muted/30 transition-colors">
                  <td className="py-1 px-2 text-muted-foreground sticky left-0 bg-background group-hover:bg-muted/30 z-10 border-b border-border/40 transition-colors">
                    <span className="inline-flex items-center gap-1.5 pl-5 border-l border-border/60 ml-1">
                      <span>{label}</span>
                      <span className="inline-flex items-center rounded-sm border border-border/60 px-1 py-px text-[9px] font-medium text-muted-foreground/70">allocated</span>
                    </span>
                  </td>
                  {displayedVenues.map(v => {
                    const part = sgaShare(v.sga, weight);
                    return (
                      <td key={v.id} className="py-1 px-2 text-right text-muted-foreground tabular-nums border-b border-border/40">
                        {fmtCurrencyShort(part)} <span className="text-muted-foreground/60">· {fmtPct(pctOf(part, v.revenue))}</span>
                      </td>
                    );
                  })}
                  <td className="py-1 px-2 text-right text-muted-foreground bg-slate-50/60 border-l-2 border-border/80 border-b border-border/40">&mdash;</td>
                  <td className="py-1 px-2 text-right text-muted-foreground tabular-nums bg-slate-100/70 border-l-2 border-border border-b border-border/40">
                    {(() => {
                      const part = sgaShare(venueTotals.sga, weight);
                      return <>{fmtCurrencyShort(part)} <span className="text-muted-foreground/60">· {fmtPct(pctOf(part, venueTotals.revenue))}</span></>;
                    })()}
                  </td>
                </tr>
              ))}

              {/* COGS */}
              <tr className="group hover:bg-muted/30 transition-colors">
                <td className="py-1.5 px-2 text-foreground sticky left-0 bg-background group-hover:bg-muted/30 z-10 border-b border-border/60 transition-colors">COGS</td>
                {displayedVenues.map(v => (
                  <td key={v.id} className="py-1.5 px-2 text-right text-foreground tabular-nums border-b border-border/60">
                    {fmtCurrencyShort(v.cogs)} <span className="text-muted-foreground/80">· {fmtPct(pctOf(v.cogs, v.revenue))}</span>
                  </td>
                ))}
                <td className="py-1.5 px-2 text-right tabular-nums bg-slate-50/60 border-l-2 border-border/80 border-b border-border/60">
                  {CORPORATE.cogs > 0 ? fmtCurrencyShort(CORPORATE.cogs) : <span className="text-muted-foreground">&mdash;</span>}
                </td>
                <td className="py-1.5 px-2 text-right font-medium text-foreground tabular-nums bg-slate-100/70 border-l-2 border-border border-b border-border/60">
                  {fmtCurrencyShort(venueTotals.cogs + CORPORATE.cogs)}{" "}
                  <span className="text-muted-foreground/80 font-normal">· {fmtPct(pctOf(venueTotals.cogs + CORPORATE.cogs, venueTotals.revenue))}</span>
                </td>
              </tr>

              {/* Rent Plus */}
              <tr className="group hover:bg-muted/30 transition-colors">
                <td className="py-1.5 px-2 text-foreground sticky left-0 bg-background group-hover:bg-muted/30 z-10 border-b border-border/60 transition-colors">
                  <button type="button" onClick={() => setRentExpanded(x => !x)} className="flex items-center gap-1 hover:text-foreground/70 transition-colors" aria-expanded={rentExpanded}>
                    {rentExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <span>Rent Plus</span>
                  </button>
                </td>
                {displayedVenues.map(v => {
                  const sum = v.rent + v.utilities;
                  return (
                    <td key={v.id} className="py-1.5 px-2 text-right text-foreground tabular-nums border-b border-border/60">
                      {fmtCurrencyShort(sum)} <span className="text-muted-foreground/80">· {fmtPct(pctOf(sum, v.revenue))}</span>
                    </td>
                  );
                })}
                <td className="py-1.5 px-2 text-right tabular-nums bg-slate-50/60 border-l-2 border-border/80 border-b border-border/60">
                  {(CORPORATE.rent + CORPORATE.utilities) > 0
                    ? fmtCurrencyShort(CORPORATE.rent + CORPORATE.utilities)
                    : <span className="text-muted-foreground">&mdash;</span>}
                </td>
                <td className="py-1.5 px-2 text-right font-medium text-foreground tabular-nums bg-slate-100/70 border-l-2 border-border border-b border-border/60">
                  {(() => {
                    const sum = venueTotals.rent + venueTotals.utilities + CORPORATE.rent + CORPORATE.utilities;
                    return <>{fmtCurrencyShort(sum)} <span className="text-muted-foreground/80 font-normal">· {fmtPct(pctOf(sum, venueTotals.revenue))}</span></>;
                  })()}
                </td>
              </tr>
              {rentExpanded && (
                <>
                  <tr className="group hover:bg-muted/30 transition-colors">
                    <td className="py-1 px-2 text-muted-foreground sticky left-0 bg-background group-hover:bg-muted/30 z-10 border-b border-border/40 transition-colors">
                      <span className="inline-flex items-center pl-5 border-l border-border/60 ml-1">Rent</span>
                    </td>
                    {displayedVenues.map(v => (
                      <td key={v.id} className="py-1 px-2 text-right text-muted-foreground tabular-nums border-b border-border/40">
                        {v.rent > 0
                          ? <>{fmtCurrencyShort(v.rent)} <span className="text-muted-foreground/60">· {fmtPct(pctOf(v.rent, v.revenue))}</span></>
                          : <span className="text-muted-foreground">&mdash;</span>}
                      </td>
                    ))}
                    <td className="py-1 px-2 text-right text-muted-foreground tabular-nums bg-slate-50/60 border-l-2 border-border/80 border-b border-border/40">
                      {CORPORATE.rent > 0 ? fmtCurrencyShort(CORPORATE.rent) : <span className="text-muted-foreground">&mdash;</span>}
                    </td>
                    <td className="py-1 px-2 text-right text-muted-foreground tabular-nums bg-slate-100/70 border-l-2 border-border border-b border-border/40">
                      {(venueTotals.rent + CORPORATE.rent) > 0
                        ? <>{fmtCurrencyShort(venueTotals.rent + CORPORATE.rent)} <span className="text-muted-foreground/60">· {fmtPct(pctOf(venueTotals.rent + CORPORATE.rent, venueTotals.revenue))}</span></>
                        : <span className="text-muted-foreground">&mdash;</span>}
                    </td>
                  </tr>
                  <tr className="group hover:bg-muted/30 transition-colors">
                    <td className="py-1 px-2 text-muted-foreground sticky left-0 bg-background group-hover:bg-muted/30 z-10 border-b border-border/40 transition-colors">
                      <span className="inline-flex items-center pl-5 border-l border-border/60 ml-1">Utilities</span>
                    </td>
                    {displayedVenues.map(v => (
                      <td key={v.id} className="py-1 px-2 text-right text-muted-foreground tabular-nums border-b border-border/40">
                        {fmtCurrencyShort(v.utilities)} <span className="text-muted-foreground/60">· {fmtPct(pctOf(v.utilities, v.revenue))}</span>
                      </td>
                    ))}
                    <td className="py-1 px-2 text-right text-muted-foreground tabular-nums bg-slate-50/60 border-l-2 border-border/80 border-b border-border/40">
                      {CORPORATE.utilities > 0 ? fmtCurrencyShort(CORPORATE.utilities) : <span className="text-muted-foreground">&mdash;</span>}
                    </td>
                    <td className="py-1 px-2 text-right text-muted-foreground tabular-nums bg-slate-100/70 border-l-2 border-border border-b border-border/40">
                      {fmtCurrencyShort(venueTotals.utilities + CORPORATE.utilities)}{" "}
                      <span className="text-muted-foreground/60">· {fmtPct(pctOf(venueTotals.utilities + CORPORATE.utilities, venueTotals.revenue))}</span>
                    </td>
                  </tr>
                </>
              )}

              {/* EBITDA */}
              <tr className="group bg-slate-50/40 hover:bg-slate-50/80 transition-colors">
                <td className="py-2 px-2 text-[13px] font-semibold text-foreground sticky left-0 bg-slate-50/40 group-hover:bg-slate-50/80 z-10 border-t-2 border-foreground/15 border-b border-border transition-colors">EBITDA</td>
                {displayedVenues.map(v => (
                  <td key={v.id} className={`py-2 px-2 text-right text-[13px] font-semibold tabular-nums border-t-2 border-foreground/15 border-b border-border ${v.ebitda >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {fmtCurrencyShort(v.ebitda)}
                  </td>
                ))}
                {(() => {
                  const corpE = CORPORATE.ebitda;
                  return (
                    <td className={`py-2 px-2 text-right text-[13px] font-semibold tabular-nums bg-slate-50/60 border-l-2 border-border/80 border-t-2 border-foreground/15 border-b border-border ${corpE >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {corpE !== 0 ? fmtCurrencyShort(corpE) : <span className="text-muted-foreground font-normal">&mdash;</span>}
                    </td>
                  );
                })()}
                {(() => {
                  const groupE = venueTotals.ebitda + CORPORATE.ebitda;
                  return (
                    <td className={`py-2 px-2 text-right text-[13px] font-bold tabular-nums bg-slate-100/70 border-l-2 border-border border-t-2 border-foreground/15 border-b border-border ${groupE >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {fmtCurrencyShort(groupE)}
                    </td>
                  );
                })()}
              </tr>

              {/* EBITDA % */}
              <tr className="group bg-slate-50/40 hover:bg-slate-50/80 transition-colors">
                <td className="py-2 px-2 text-[13px] font-semibold text-foreground sticky left-0 bg-slate-50/40 group-hover:bg-slate-50/80 z-10 transition-colors">EBITDA %</td>
                {displayedVenues.map(v => {
                  const m = pctOf(v.ebitda, v.revenue);
                  const badge = m >= 50 ? "border-emerald-200 text-emerald-700 bg-emerald-50/60"
                              : m >= 30 ? "border-amber-200 text-amber-700 bg-amber-50/60"
                              :           "border-red-200 text-red-700 bg-red-50/60";
                  return (
                    <td key={v.id} className="py-2 px-2 text-right">
                      <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${badge}`}>{fmtPct(m)}</span>
                    </td>
                  );
                })}
                <td className="py-2 px-2 text-right bg-slate-50/60 border-l-2 border-border/80">
                  <span className="text-muted-foreground">&mdash;</span>
                </td>
                <td className="py-2 px-2 text-right bg-slate-100/70 border-l-2 border-border">
                  {(() => {
                    const m = pctOf(venueTotals.ebitda + CORPORATE.ebitda, venueTotals.revenue);
                    const badge = m >= 50 ? "border-emerald-300 text-emerald-800 bg-emerald-50"
                                : m >= 30 ? "border-amber-300 text-amber-800 bg-amber-50"
                                :           "border-red-300 text-red-800 bg-red-50";
                    return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${badge}`}>{fmtPct(m)}</span>;
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Contribution Waterfall */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Contribution Waterfall</h2>
        <p className="text-xs text-muted-foreground mb-4">
          How each location contributes to Group EBITDA ({monthLabel})
        </p>
        <div className="h-[280px] md:h-[380px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={waterfallData} margin={{ top: 20, right: 10, left: 10, bottom: 70 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-40} textAnchor="end" height={80} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v: number) => `€${(v / 1000).toFixed(1)}K`} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const entry = waterfallData.find(d => d.name === label);
                  if (!entry) return null;
                  return (
                    <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
                      <p className="font-semibold text-foreground text-sm">{entry.name}</p>
                      <p className={`text-sm font-bold ${entry.value >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {formatCurrency(entry.value)}
                      </p>
                      {!entry.isTotal && (
                        <p className="text-xs text-muted-foreground">Running: {formatCurrency(entry.cumulative)}</p>
                      )}
                    </div>
                  );
                }}
              />
              <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" />
              <Bar dataKey="start" stackId="waterfall" fill="transparent" />
              <Bar dataKey="value" stackId="waterfall" radius={[2, 2, 0, 0]}>
                {waterfallData.map((entry, i) => (
                  <Cell key={i} fill={entry.isTotal ? "#3B82F6" : entry.value >= 0 ? "#22C55E" : "#EF4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <CIChat />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function EBITDAPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <EBITDAOverviewContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
