"use client";

import { useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { ServiceBreakdownChart } from "@/components/sales/ServiceBreakdownChart";
import { StaffPerformanceChart } from "@/components/sales/StaffPerformanceChart";
import { CIChat } from "@/components/ci/CIChat";
import { Card } from "@/components/ui/card";
import { chartColors, formatCurrency } from "@/lib/charts/config";
import {
  weekLabelsToDateObjects,
  getFilteredIndices,
  sumFiltered,
  formatDateRangeLabel,
  filteredCountLabel,
} from "@/lib/utils/mock-date-filter";
import { AlertTriangle, Target } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from "recharts";

/* ═══════════════════════════════════════════════════════════════════════
   MOCK DATA
   ═══════════════════════════════════════════════════════════════════════ */

const MOCK_SPA_WEEKS = [
  "05-Jan","12-Jan","19-Jan","26-Jan",
  "02-Feb","09-Feb","16-Feb","23-Feb",
  "02-Mar","09-Mar","16-Mar","23-Mar",
  "30-Mar","06-Apr","13-Apr","20-Apr",
];
const WEEK_DATES = weekLabelsToDateObjects(MOCK_SPA_WEEKS, 2026);

// Weekly revenue per hotel (EUR, services + products combined)
const MOCK_IC        = [10500,11200,10800,12500,11000,11500,12200,13000,11200,10500,12000,11500,10200,13500,12000,9491];
const MOCK_HUGOS     = [12200,13100,12700,14800,13000,13700,14200,15200,13300,12500,14200,13600,12200,15800,14200,10879];
const MOCK_HYATT     = [6000,6400,6200,7200,6300,6600,7000,7400,6400,6000,6800,6500,5900,7500,6800,5215];
const MOCK_RAMLA     = [5800,6200,6000,7000,6100,6400,6800,7200,6200,5900,6600,6300,5700,7300,6600,5003];
const MOCK_LABRANDA  = [3400,3700,3500,4100,3600,3800,4000,4300,3700,3400,3900,3700,3300,4400,3900,2954];
const MOCK_ODYCY     = [2900,3100,3000,3500,3100,3200,3400,3600,3100,2900,3300,3100,2800,3700,3300,2387];

// Bookings and shows
const MOCK_BOOKED    = [320,330,315,350,325,340,345,360,335,310,350,340,315,370,355,287];
const MOCK_SHOWS     = [279,289,276,308,285,298,302,316,293,271,308,298,276,325,311,253];

// Retail and add-on (weekly totals across all hotels)
const MOCK_RETAIL    = [2300,2400,2200,2700,2400,2500,2700,2900,2500,2300,2700,2500,2300,2900,2600,1993];
const MOCK_ADDON     = [1400,1500,1400,1700,1500,1600,1700,1800,1600,1500,1700,1600,1400,1900,1700,1260];

const HOTELS = [
  { id: "ic",       name: "InterContinental", data: MOCK_IC,       color: "#1B3A4B", weeklyTarget: 11000, aov: 165, aovLY: 158 },
  { id: "hugos",    name: "Hugo's",           data: MOCK_HUGOS,    color: "#96B2B2", weeklyTarget: 12000, aov: 178, aovLY: 165 },
  { id: "hyatt",    name: "Hyatt",            data: MOCK_HYATT,    color: "#B79E61", weeklyTarget: 6000,  aov: 142, aovLY: 148 },
  { id: "ramla",    name: "Ramla Bay",        data: MOCK_RAMLA,    color: "#8EB093", weeklyTarget: 6000,  aov: 138, aovLY: 132 },
  { id: "labranda", name: "Labranda",         data: MOCK_LABRANDA, color: "#E07A5F", weeklyTarget: 3500,  aov: 112, aovLY: 105 },
  { id: "odycy",    name: "Odycy",            data: MOCK_ODYCY,    color: "#4A90D9", weeklyTarget: 3500,  aov: 98,  aovLY: 96  },
];

const STAFF_PERFORMANCE = [
  { name: "Maria Grech",     serviceRevenue: 45200, retailRevenue: 3200 },
  { name: "Anna Camilleri",  serviceRevenue: 42800, retailRevenue: 2900 },
  { name: "Sarah Farrugia",  serviceRevenue: 39500, retailRevenue: 4100 },
  { name: "Leanne Attard",   serviceRevenue: 36800, retailRevenue: 3500 },
  { name: "Claire Vella",    serviceRevenue: 34500, retailRevenue: 2800 },
  { name: "Jessica Borg",    serviceRevenue: 31200, retailRevenue: 4600 },
  { name: "Michelle Zammit", serviceRevenue: 29800, retailRevenue: 3200 },
  { name: "Rachel Gauci",    serviceRevenue: 27500, retailRevenue: 2400 },
  { name: "Daniela Mifsud",  serviceRevenue: 25200, retailRevenue: 1900 },
  { name: "Karen Portelli",  serviceRevenue: 23600, retailRevenue: 2100 },
];

const SERVICE_BREAKDOWN = [
  { service: "Massage Therapy",  revenue: 68400, pct: 37.5 },
  { service: "Facials",          revenue: 34200, pct: 18.7 },
  { service: "Body Treatments",  revenue: 25600, pct: 14.0 },
  { service: "Hydrotherapy",     revenue: 18200, pct: 10.0 },
  { service: "Couples Packages", revenue: 14800, pct: 8.1  },
  { service: "Nail Services",    revenue: 11400, pct: 6.3  },
  { service: "Other",            revenue: 10000, pct: 5.5  },
];

const DEFAULT_TARGETS = { weeklyRevenue: 42000, weeklyBookings: 337, showRatePct: 90 };

/* ═══════════════════════════════════════════════════════════════════════
   MAIN CONTENT
   ═══════════════════════════════════════════════════════════════════════ */

function SpaContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const [targets, setTargets]         = useState(DEFAULT_TARGETS);
  const [editingTargets, setEditing]  = useState(false);
  const [draftTargets, setDraft]      = useState(DEFAULT_TARGETS);

  const filteredIdx = useMemo(
    () => getFilteredIndices(WEEK_DATES, dateFrom, dateTo),
    [dateFrom, dateTo]
  );
  const L = filteredIdx.length;

  /* ── KPIs ─────────────────────────────────────────────────────── */
  const hotelTotals = useMemo(
    () => HOTELS.map((h) => ({ ...h, revenue: sumFiltered(h.data, filteredIdx) })),
    [filteredIdx]
  );
  const totalRev     = useMemo(() => hotelTotals.reduce((s, h) => s + h.revenue, 0), [hotelTotals]);
  const serviceRev   = Math.round(totalRev * 0.87);
  const retailRev    = useMemo(() => sumFiltered(MOCK_RETAIL, filteredIdx), [filteredIdx]);
  const addonRev     = useMemo(() => sumFiltered(MOCK_ADDON,  filteredIdx), [filteredIdx]);
  const totalBooked  = useMemo(() => sumFiltered(MOCK_BOOKED, filteredIdx), [filteredIdx]);
  const totalShows   = useMemo(() => sumFiltered(MOCK_SHOWS,  filteredIdx), [filteredIdx]);
  const showRate     = totalBooked > 0 ? (totalShows / totalBooked) * 100 : 0;
  const noShows      = totalBooked - totalShows;
  const avgRevAppt   = totalShows > 0 ? Math.round(totalRev / totalShows) : 0;
  const revLostNoShow = Math.round(noShows * avgRevAppt);

  /* ── Subtitle ─────────────────────────────────────────────────── */
  const subtitle = useMemo(() => {
    const weekCount = filteredCountLabel(L, "week");
    const range = formatDateRangeLabel(dateFrom, dateTo);
    return `${range} · ${weekCount} · All figures EUR ex VAT`;
  }, [L, dateFrom, dateTo]);

  /* ── Hotel chart data (sorted by revenue desc) ────────────────── */
  const hotelChartData = useMemo(
    () => [...hotelTotals].sort((a, b) => b.revenue - a.revenue),
    [hotelTotals]
  );

  /* ── AOV chart ────────────────────────────────────────────────── */
  const aovData = HOTELS.map((h) => ({
    name:     h.name === "InterContinental" ? "IC" : h.name,
    "This Year": h.aov,
    "Last Year": h.aovLY,
    color:    h.color,
  }));

  /* ── Targets ──────────────────────────────────────────────────── */
  const revenueTarget   = targets.weeklyRevenue * L;
  const bookingsTarget  = targets.weeklyBookings * L;
  const locationTargets = hotelTotals.map((h) => ({
    name:   h.name,
    color:  h.color,
    actual: h.revenue,
    target: h.weeklyTarget * L,
    pct:    h.weeklyTarget > 0 ? Math.round((h.revenue / (h.weeklyTarget * L)) * 100) : 0,
  }));
  const totalTarget = HOTELS.reduce((s, h) => s + h.weeklyTarget * L, 0);
  const totalTargetPct = totalTarget > 0 ? Math.round((totalRev / totalTarget) * 100) : 0;

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          Sales Performance — Spa Network
        </h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {/* ── KPI Row 1 ──────────────────────────────────────────────── */}
      <SalesKPIGrid columns={4}>
        <SalesKPICard label="Total Revenue"   value={formatCurrency(totalRev)}   subtitle="All hotels combined"        yoyChange={-4.9} />
        <SalesKPICard label="Service Revenue" value={formatCurrency(serviceRev)} subtitle="Treatments & therapies"      yoyChange={-7.0} />
        <SalesKPICard label="Retail Revenue"  value={formatCurrency(retailRev)}  subtitle={`${((retailRev/totalRev)*100).toFixed(1)}% of total`} yoyChange={7.2} />
        <SalesKPICard label="Add-on Revenue"  value={formatCurrency(addonRev)}   subtitle={`${((addonRev/totalRev)*100).toFixed(1)}% of total`}  yoyChange={-8.7} />
      </SalesKPIGrid>

      {/* ── KPI Row 2 ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-3 md:p-5 text-center border-l-4" style={{ borderLeftColor: chartColors.spa }}>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Show Rate</p>
          <p className="text-3xl font-bold" style={{ color: chartColors.spa }}>{showRate.toFixed(0)}%</p>
          <p className="text-xs text-muted-foreground mt-1">{totalShows.toLocaleString()} showed of {totalBooked.toLocaleString()} booked</p>
        </Card>
        <Card className="p-3 md:p-5 text-center border-l-4 border-emerald-500">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Avg Revenue / Appointment</p>
          <p className="text-3xl font-bold text-emerald-600">{formatCurrency(avgRevAppt)}</p>
          <p className="text-xs text-muted-foreground mt-1">Based on {totalShows.toLocaleString()} appointments</p>
        </Card>
        <Card className="p-3 md:p-5 text-center border-l-4 border-red-400 bg-red-50/50">
          <div className="flex items-center justify-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <p className="text-xs uppercase tracking-wider text-red-600 font-medium">Revenue Lost to No-Shows</p>
          </div>
          <p className="text-3xl font-bold text-red-600">{formatCurrency(revLostNoShow)}</p>
          <p className="text-xs text-muted-foreground mt-1">{noShows} no-shows × {formatCurrency(avgRevAppt)} avg per appt</p>
        </Card>
      </div>

      {/* ── Revenue by Hotel ───────────────────────────────────────── */}
      <Card className="p-4 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Revenue by Hotel</h2>
        <p className="text-xs text-muted-foreground mb-5">
          Sorted by current total descending · EUR ex VAT
        </p>
        <div className="h-[280px] md:h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hotelChartData} margin={{ top: 24, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v: number) => v >= 1000 ? `€${Math.round(v/1000)}K` : `€${v}`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [formatCurrency(v), "Revenue"]} />
              <Bar dataKey="revenue" radius={[4,4,0,0]} barSize={44}>
                {hotelChartData.map((h) => <Cell key={h.id} fill={h.color} />)}
                <LabelList dataKey="revenue" content={(props) => {
                  const { x, width, y, value } = props as Record<string, unknown>;
                  const w = Number(width);
                  if (w < 20) return null;
                  const v = Number(value);
                  return (
                    <text x={Number(x)+w/2} y={Number(y)-7} textAnchor="middle" fontSize={10} fontWeight={700} fill="#374151">
                      {v >= 1000 ? `€${Math.round(v/1000)}K` : `€${v}`}
                    </text>
                  );
                }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── AOV by Location ────────────────────────────────────────── */}
      <Card className="p-4 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Average Order Value by Location</h2>
        <p className="text-xs text-muted-foreground mb-5">Current period AOV vs last year per hotel · EUR</p>
        <div className="h-[240px] md:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={aovData} margin={{ top: 12, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v: number) => `€${v}`} tick={{ fontSize: 11 }} domain={[0, 200]} />
              <Tooltip formatter={(v: number) => [`€${v}`, ""]} />
              <Bar dataKey="Last Year" fill="#e5e7eb" radius={[3,3,0,0]} barSize={20} />
              <Bar dataKey="This Year" radius={[3,3,0,0]} barSize={20}>
                {aovData.map((d) => <Cell key={d.name} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── Staff Performance ──────────────────────────────────────── */}
      <StaffPerformanceChart
        title="Staff Performance"
        subtitle="Top 10 staff (EUR)"
        data={STAFF_PERFORMANCE}
        serviceColor={chartColors.spa}
        retailColor="#B79E61"
      />

      {/* ── Service Revenue Breakdown ──────────────────────────────── */}
      <ServiceBreakdownChart
        title="Service Revenue Breakdown"
        data={SERVICE_BREAKDOWN}
        color={chartColors.spa}
      />

      {/* ── Targets vs Actual ──────────────────────────────────────── */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5" style={{ color: chartColors.spa }} />
            <h2 className="text-lg font-semibold text-foreground">Targets vs Actual — By Location</h2>
          </div>
          <button
            onClick={() => {
              if (editingTargets) { setTargets(draftTargets); setEditing(false); }
              else { setDraft(targets); setEditing(true); }
            }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border hover:bg-muted transition-colors"
          >
            {editingTargets ? "Save Targets" : "Edit Targets"}
          </button>
        </div>

        {editingTargets && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6 p-4 bg-muted/50 rounded-lg">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Weekly Revenue Target</label>
              <input type="number" value={draftTargets.weeklyRevenue}
                onChange={(e) => setDraft({ ...draftTargets, weeklyRevenue: Number(e.target.value) })}
                className="w-full border rounded px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Weekly Bookings Target</label>
              <input type="number" value={draftTargets.weeklyBookings}
                onChange={(e) => setDraft({ ...draftTargets, weeklyBookings: Number(e.target.value) })}
                className="w-full border rounded px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Show Rate Target %</label>
              <input type="number" value={draftTargets.showRatePct}
                onChange={(e) => setDraft({ ...draftTargets, showRatePct: Number(e.target.value) })}
                className="w-full border rounded px-2 py-1 text-sm" />
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground mb-4">
          Weekly targets × {L} week{L !== 1 ? "s" : ""} selected. Revenue in EUR ex VAT.
        </p>

        <div className="space-y-3">
          {locationTargets.map((loc) => {
            const isGreen  = loc.pct >= 95;
            const isAmber  = loc.pct >= 80 && loc.pct < 95;
            const barColor = isGreen ? "#059669" : isAmber ? "#d97706" : "#dc2626";
            return (
              <div key={loc.name} className="flex items-center gap-4">
                <div className="flex items-center gap-2 w-40 flex-shrink-0">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: loc.color }} />
                  <span className="text-sm font-medium truncate">{loc.name}</span>
                </div>
                <div className="flex-1">
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(loc.pct, 100)}%`, backgroundColor: barColor }} />
                  </div>
                </div>
                <div className="text-right w-28 flex-shrink-0">
                  <span className="text-sm font-semibold">{formatCurrency(loc.actual)}</span>
                  <span className="text-xs text-muted-foreground"> / {formatCurrency(loc.target)}</span>
                </div>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded w-12 text-center flex-shrink-0 ${isGreen ? "bg-green-50 text-green-700" : isAmber ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>
                  {loc.pct}%
                </span>
              </div>
            );
          })}
          {/* Total row */}
          <div className="flex items-center gap-4 border-t pt-3 mt-1">
            <div className="w-40 flex-shrink-0">
              <span className="text-sm font-bold">Company Total</span>
            </div>
            <div className="flex-1">
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(totalTargetPct, 100)}%` }} />
              </div>
            </div>
            <div className="text-right w-28 flex-shrink-0">
              <span className="text-sm font-bold">{formatCurrency(totalRev)}</span>
              <span className="text-xs text-muted-foreground"> / {formatCurrency(totalTarget)}</span>
            </div>
            <span className="text-xs font-bold px-1.5 py-0.5 rounded w-12 text-center flex-shrink-0 bg-green-50 text-green-700">
              {totalTargetPct}%
            </span>
          </div>
        </div>
      </Card>

      <CIChat />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PAGE EXPORT
   ═══════════════════════════════════════════════════════════════════════ */

export default function SpaSalesPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => <SpaContent dateFrom={dateFrom} dateTo={dateTo} />}
    </DashboardShell>
  );
}
