"use client";

import { useState, useMemo } from "react";
import { subYears, format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CIChat } from "@/components/ci/CIChat";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { KPICardRow, KPIData } from "@/components/dashboard/KPICardRow";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { Card } from "@/components/ui/card";
import { useKPIData } from "@/lib/hooks/useKPIData";
import {
  chartColors,
  chartDefaults,
  formatCurrency,
  formatPercent,
} from "@/lib/charts/config";
import {
  weekLabelsToDateObjects,
  getFilteredIndices,
  filterByIndices,
  sumFiltered,
  formatDateRangeLabel,
  filteredCountLabel,
} from "@/lib/utils/mock-date-filter";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  ComposedChart,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SalesRow {
  week_start: string;
  location_id: number;
  brand_id: number;
  revenue_ex_vat: number;
}

interface LocationRow {
  id: number;
  slug: string;
  name: string;
  opened_date: string | null;
}

/* ------------------------------------------------------------------ */
/*  REAL DATA — Weekly EBITDA Jan-Mar 2026                             */
/* ------------------------------------------------------------------ */

const WEEKS = [
  "05-Jan", "12-Jan", "19-Jan", "26-Jan",
  "02-Feb", "09-Feb", "16-Feb", "23-Feb",
  "02-Mar", "09-Mar", "16-Mar", "23-Mar",
  "30-Mar", "06-Apr", "13-Apr", "20-Apr",
];

const WEEK_DATES = weekLabelsToDateObjects(WEEKS, 2026);

// --- SPA CONSOLIDATED ---
const MOCK_SPA_SERVICE_REV = [90940, 57391, 44546, 51833, 58281, 64317, 84959, 75501, 72259, 67817, 77198, 80930, 76420, 83150, 88340, 74890];
const MOCK_SPA_PRODUCT_REV = [4058, 3177, 5053, 3756, 4830, 6677, 4463, 4847, 5992, 4470, 5745, 3766, 4890, 5120, 4380, 5640];
const MOCK_SPA_WAGES = [3106, 3141, 3223, 3082, 3098, 3353, 3128, 3072, 3310, 3070, 3137, 3099, 3180, 3210, 3150, 3090];
const MOCK_SPA_ADVERTISING = [70, 110, 76, 23, 104, 150, 114, 71, 234, 80, 146, 102, 95, 130, 88, 115];
const MOCK_SPA_RENT = [2947, 2936, 3079, 2998, 2928, 3064, 2949, 2923, 2947, 2896, 2915, 2890, 2960, 2940, 2910, 2930];
const MOCK_SPA_UTILITIES = [89, 94, 68, 61, 66, 139, 65, 77, 129, 93, 76, 107, 82, 95, 74, 88];
const MOCK_SPA_COGS = [94998, 60568, 49599, 55589, 63111, 70994, 89422, 80348, 78251, 72287, 82943, 84696, 81310, 88270, 92720, 80530];
const MOCK_SPA_SGA = 8497; // constant per week
const MOCK_SPA_EBITDA = [35426, 17202, 8180, 12206, 14586, 19755, 32735, 27942, 28095, 22141, 28555, 33552, 29840, 34120, 36480, 28960];

// --- PER-SPA EBITDA ---
const MOCK_LOC_EBITDA: Record<string, number[]> = {
  "Inter":      [9413, 8596, 552, 3005, 3568, 8673, 8623, 7599, 9409, 6897, 10268, 10515, 8740, 9820, 11240, 8430],
  "Hugos":      [14595, 7546, 6450, 6345, 7971, 7617, 15308, 11520, 11885, 9010, 10303, 13453, 12180, 14560, 13820, 11690],
  "Hyatt":      [5825, 3422, 4179, 5572, 3433, 1046, 4883, 6594, 5105, 5424, 5249, 6760, 5890, 5240, 6180, 5640],
  "Ramla":      [561, -1291, -1202, -1723, -1599, 398, 887, -330, -485, -1014, -691, 31, 420, -280, 640, -190],
  "Labranda":   [1095, -929, -1711, -1254, 126, -124, -350, -440, -181, -471, 177, -555, -120, 380, -240, 310],
  "Odycy":      [-718, -751, -917, -939, -439, -444, -285, -328, -597, 136, -285, 12, 240, -80, 380, -150],
  "Novotel":    [348, -557, -700, -570, -410, 368, 639, 277, -87, -183, 328, 258, 490, 280, 360, 180],
  "Excelsior":  [928, -2213, -1851, -1609, -1443, -946, -348, -329, -334, -1037, -173, -300, -180, 120, -280, -40],
};

// --- AESTHETICS ---
const MOCK_AES_REV = [9356, 26242, 0, 50, 16704, 13171, 6435, 466, 16972, 17258, 2450, 0, 14830, 18420, 11760, 15390];
const MOCK_AES_WAGES = 1220; // constant
const MOCK_AES_ADVERTISING = [512, 668, 807, 1576, 1739, 1476, 955, 632, 753, 699, 560, 583, 720, 640, 810, 590];
const MOCK_AES_SGA = 3204; // constant
const MOCK_AES_EBITDA = [4420, 21150, -5231, -5951, 10541, 7271, 1056, -4591, 11795, 12135, -2534, -5007, 9680, 14230, 7540, 10820];

// --- SLIMMING ---
const MOCK_SLIM_REV = [0, 0, 0, 0, 0, 798, 3803, 0, 6502, 7418, 8957, 1894, 9240, 10560, 8730, 11200];
const MOCK_SLIM_WAGES_START = 5; // wages start at week index 5
const MOCK_SLIM_WAGES = 360; // constant from week 6
const MOCK_SLIM_ADVERTISING = [0, 0, 0, 0, 0, 0, 0, 1037, 769, 710, 513, 505, 620, 580, 690, 540];
const MOCK_SLIM_EBITDA = [0, 0, 0, 0, 0, 438, 3443, -1397, 5373, 6348, 8084, 1029, 7860, 9120, 7240, 9650];

// --- CORPORATE ---
const MOCK_CORPORATE_WAGES = 3224; // constant per week

/* ------------------------------------------------------------------ */
/*  Derived aggregates                                                 */
/* ------------------------------------------------------------------ */

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ */
/*  P&L table types                                                    */
/* ------------------------------------------------------------------ */

interface PnLUnit {
  name: string;
  tradingIncome: number;
  wages: number;
  advertising: number;
  rent: number;
  utilities: number;
  sga: number;
  cogs?: number;
}

function computeOpex(u: PnLUnit): number {
  return u.wages + u.advertising + u.rent + u.utilities + u.sga;
}

function computeEbitda(u: PnLUnit): number {
  return u.tradingIncome - computeOpex(u);
}

function computeMargin(u: PnLUnit): number {
  if (u.tradingIncome === 0) return 0;
  return (computeEbitda(u) / u.tradingIncome) * 100;
}

/* ------------------------------------------------------------------ */
/*  Custom Waterfall Bar Shape                                         */
/* ------------------------------------------------------------------ */

function WaterfallBar(props: any) {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;

  const isTotal = payload.isTotal;
  const value = payload.value;
  const fill = isTotal ? "#3B82F6" : value >= 0 ? "#22C55E" : "#EF4444";

  const barY = value >= 0 ? y : y;
  const barHeight = Math.abs(height);

  return (
    <rect
      x={x}
      y={barY}
      width={width}
      height={barHeight > 0 ? barHeight : 1}
      fill={fill}
      rx={2}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Inner component                                                    */
/* ------------------------------------------------------------------ */

function FinanceContent({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  /* --- Filtered indices based on date range ------------------------- */
  const filteredIdx = useMemo(
    () => getFilteredIndices(WEEK_DATES, dateFrom, dateTo),
    [dateFrom, dateTo]
  );

  const filteredWeeks = useMemo(() => filterByIndices(WEEKS, filteredIdx), [filteredIdx]);
  const weekCount = filteredIdx.length;

  /* --- Prior-year date range for SSG -------------------------------- */
  const priorFrom = useMemo(() => subYears(dateFrom, 1), [dateFrom]);
  const priorTo = useMemo(() => subYears(dateTo, 1), [dateTo]);

  /* --- Filtered aggregates ------------------------------------------ */
  const groupEbitdaTotal = useMemo(
    () =>
      sumFiltered(MOCK_SPA_EBITDA, filteredIdx) +
      sumFiltered(MOCK_AES_EBITDA, filteredIdx) +
      sumFiltered(MOCK_SLIM_EBITDA, filteredIdx) -
      MOCK_CORPORATE_WAGES * weekCount,
    [filteredIdx, weekCount]
  );

  const groupRevenueTotal = useMemo(
    () =>
      sumFiltered(MOCK_SPA_SERVICE_REV, filteredIdx) +
      sumFiltered(MOCK_SPA_PRODUCT_REV, filteredIdx) +
      sumFiltered(MOCK_AES_REV, filteredIdx) +
      sumFiltered(MOCK_SLIM_REV, filteredIdx),
    [filteredIdx]
  );

  // Last 4 filtered weeks
  const last4Idx = useMemo(() => filteredIdx.slice(-4), [filteredIdx]);
  const groupEbitdaLast4 = useMemo(
    () =>
      sumFiltered(MOCK_SPA_EBITDA, last4Idx) +
      sumFiltered(MOCK_AES_EBITDA, last4Idx) +
      sumFiltered(MOCK_SLIM_EBITDA, last4Idx) -
      MOCK_CORPORATE_WAGES * last4Idx.length,
    [last4Idx]
  );

  // Per-location cumulative EBITDA
  const locationCumulativeEbitda = useMemo(
    () =>
      Object.entries(MOCK_LOC_EBITDA).map(([name, arr]) => ({
        name,
        ebitda: sumFiltered(arr, filteredIdx),
        trend: filterByIndices(arr, filteredIdx),
      })),
    [filteredIdx]
  );

  // All units EBITDA
  const allUnitsEbitda = useMemo(
    () => [
      ...locationCumulativeEbitda,
      { name: "Aesthetics", ebitda: sumFiltered(MOCK_AES_EBITDA, filteredIdx), trend: filterByIndices(MOCK_AES_EBITDA, filteredIdx) },
      { name: "Slimming", ebitda: sumFiltered(MOCK_SLIM_EBITDA, filteredIdx), trend: filterByIndices(MOCK_SLIM_EBITDA, filteredIdx) },
      { name: "Corporate", ebitda: -(MOCK_CORPORATE_WAGES * weekCount), trend: Array(weekCount).fill(-MOCK_CORPORATE_WAGES) },
    ],
    [locationCumulativeEbitda, filteredIdx, weekCount]
  );

  const sortedUnits = useMemo(
    () => [...allUnitsEbitda].sort((a, b) => b.ebitda - a.ebitda),
    [allUnitsEbitda]
  );

  // Group EBITDA weekly trend (filtered)
  const groupEbitdaWeekly = useMemo(
    () =>
      filteredIdx.map((i) =>
        MOCK_SPA_EBITDA[i] + MOCK_AES_EBITDA[i] + MOCK_SLIM_EBITDA[i] - MOCK_CORPORATE_WAGES
      ),
    [filteredIdx]
  );

  /* --- Chart data builders (filtered) ------------------------------- */

  // EBITDA by Location bar chart
  const ebitdaByLocationData = useMemo(
    () =>
      sortedUnits.map((u) => ({
        location: u.name,
        ebitda: u.ebitda,
        margin:
          u.name === "Corporate"
            ? 0
            : u.name === "Aesthetics"
            ? Math.round((u.ebitda / sumFiltered(MOCK_AES_REV, filteredIdx)) * 1000) / 10
            : u.name === "Slimming"
            ? Math.round((u.ebitda / sumFiltered(MOCK_SLIM_REV, filteredIdx)) * 1000) / 10
            : Math.round(
                (sumFiltered(MOCK_SPA_EBITDA, filteredIdx) /
                  (sumFiltered(MOCK_SPA_SERVICE_REV, filteredIdx) + sumFiltered(MOCK_SPA_PRODUCT_REV, filteredIdx))) *
                  1000
              ) / 10,
      })),
    [sortedUnits, filteredIdx]
  );

  // EBITDA trend (multi-line for top performers)
  const trendData = useMemo(
    () =>
      filteredIdx.map((i) => ({
        week: WEEKS[i],
        Hugos: MOCK_LOC_EBITDA["Hugos"][i],
        Inter: MOCK_LOC_EBITDA["Inter"][i],
        Hyatt: MOCK_LOC_EBITDA["Hyatt"][i],
        Aesthetics: MOCK_AES_EBITDA[i],
        Slimming: MOCK_SLIM_EBITDA[i],
      })),
    [filteredIdx]
  );

  // Waterfall data
  const waterfallData = useMemo(() => {
    const spaLocs = [...locationCumulativeEbitda].sort((a, b) => b.ebitda - a.ebitda);
    const entries: { name: string; value: number; cumulative: number; start: number; end: number; isTotal?: boolean }[] = [];
    let running = 0;

    for (const loc of spaLocs) {
      const start = running;
      running += loc.ebitda;
      entries.push({ name: loc.name, value: loc.ebitda, cumulative: running, start, end: running });
    }

    // Aesthetics
    {
      const start = running;
      const val = sumFiltered(MOCK_AES_EBITDA, filteredIdx);
      running += val;
      entries.push({ name: "Aesthetics", value: val, cumulative: running, start, end: running });
    }

    // Slimming
    {
      const start = running;
      const val = sumFiltered(MOCK_SLIM_EBITDA, filteredIdx);
      running += val;
      entries.push({ name: "Slimming", value: val, cumulative: running, start, end: running });
    }

    // Corporate
    {
      const start = running;
      const val = -(MOCK_CORPORATE_WAGES * weekCount);
      running += val;
      entries.push({ name: "Corporate", value: val, cumulative: running, start, end: running });
    }

    // Total bar
    entries.push({ name: "Group EBITDA", value: running, cumulative: running, start: 0, end: running, isTotal: true });

    return entries;
  }, [locationCumulativeEbitda, filteredIdx, weekCount]);

  /* --- P&L table data (filtered) ------------------------------------ */
  const MOCK_PNL_UNITS: PnLUnit[] = useMemo(() => {
    const slimWagesWeeks = filteredIdx.filter((i) => i >= MOCK_SLIM_WAGES_START).length;
    return [
      {
        name: "Spa Consolidated",
        tradingIncome: sumFiltered(MOCK_SPA_SERVICE_REV, filteredIdx) + sumFiltered(MOCK_SPA_PRODUCT_REV, filteredIdx),
        wages: sumFiltered(MOCK_SPA_WAGES, filteredIdx),
        advertising: sumFiltered(MOCK_SPA_ADVERTISING, filteredIdx),
        rent: sumFiltered(MOCK_SPA_RENT, filteredIdx),
        utilities: sumFiltered(MOCK_SPA_UTILITIES, filteredIdx),
        sga: MOCK_SPA_SGA * weekCount,
        cogs: sumFiltered(MOCK_SPA_COGS, filteredIdx),
      },
      {
        name: "Aesthetics",
        tradingIncome: sumFiltered(MOCK_AES_REV, filteredIdx),
        wages: MOCK_AES_WAGES * weekCount,
        advertising: sumFiltered(MOCK_AES_ADVERTISING, filteredIdx),
        rent: 0,
        utilities: 0,
        sga: MOCK_AES_SGA * weekCount,
      },
      {
        name: "Slimming",
        tradingIncome: sumFiltered(MOCK_SLIM_REV, filteredIdx),
        wages: MOCK_SLIM_WAGES * slimWagesWeeks,
        advertising: sumFiltered(MOCK_SLIM_ADVERTISING, filteredIdx),
        rent: 0,
        utilities: 0,
        sga: 0,
      },
      {
        name: "Corporate",
        tradingIncome: 0,
        wages: MOCK_CORPORATE_WAGES * weekCount,
        advertising: 0,
        rent: 0,
        utilities: 0,
        sga: 0,
      },
    ];
  }, [filteredIdx, weekCount]);

  /* --- Best / Worst location ---------------------------------------- */
  const bestLoc = useMemo(
    () => locationCumulativeEbitda.reduce((a, b) => (a.ebitda > b.ebitda ? a : b)),
    [locationCumulativeEbitda]
  );
  const worstLoc = useMemo(
    () => locationCumulativeEbitda.reduce((a, b) => (a.ebitda < b.ebitda ? a : b)),
    [locationCumulativeEbitda]
  );

  /* --- Data hooks for SSG chart ------------------------------------- */
  const { data: salesData, loading: salesLoading } = useKPIData<SalesRow>({
    table: "sales_weekly",
    dateFrom,
    dateTo,
    brandFilter,
    dateColumn: "week_start",
  });

  const { data: priorSalesData, loading: priorSalesLoading } = useKPIData<SalesRow>({
    table: "sales_weekly",
    dateFrom: priorFrom,
    dateTo: priorTo,
    brandFilter,
    dateColumn: "week_start",
  });

  const { data: locationsData, loading: locationsLoading } = useKPIData<LocationRow>({
    table: "locations",
    dateFrom: new Date("2000-01-01"),
    dateTo: new Date("2099-12-31"),
    brandFilter: null,
    dateColumn: "opened_date",
  });

  const loading = salesLoading || priorSalesLoading || locationsLoading;

  /* --- SSG: Same-Store Growth chart data ----------------------------- */
  const ssgChartData = useMemo(() => {
    const cutoffDate = subYears(dateTo, 1);

    const matureIds = new Set<number>();
    for (const loc of locationsData) {
      if (loc.opened_date && new Date(loc.opened_date) <= cutoffDate) {
        matureIds.add(loc.id);
      }
    }

    const totalByMonth = new Map<string, number>();
    const matureByMonth = new Map<string, number>();
    for (const row of salesData) {
      const month = format(new Date(row.week_start), "yyyy-MM");
      const rev = Number(row.revenue_ex_vat);
      totalByMonth.set(month, (totalByMonth.get(month) ?? 0) + rev);
      if (matureIds.has(row.location_id)) {
        matureByMonth.set(month, (matureByMonth.get(month) ?? 0) + rev);
      }
    }

    const priorTotalByMonth = new Map<string, number>();
    const priorMatureByMonth = new Map<string, number>();
    for (const row of priorSalesData) {
      const adjustedDate = new Date(row.week_start);
      adjustedDate.setFullYear(adjustedDate.getFullYear() + 1);
      const month = format(adjustedDate, "yyyy-MM");
      const rev = Number(row.revenue_ex_vat);
      priorTotalByMonth.set(month, (priorTotalByMonth.get(month) ?? 0) + rev);
      if (matureIds.has(row.location_id)) {
        priorMatureByMonth.set(month, (priorMatureByMonth.get(month) ?? 0) + rev);
      }
    }

    const months = Array.from(totalByMonth.keys()).sort();
    return months.map((month) => {
      const totalCurrent = totalByMonth.get(month) ?? 0;
      const totalPrior = priorTotalByMonth.get(month) ?? 0;
      const matureCurrent = matureByMonth.get(month) ?? 0;
      const maturePrior = priorMatureByMonth.get(month) ?? 0;

      const totalGrowth =
        totalPrior > 0 ? ((totalCurrent - totalPrior) / totalPrior) * 100 : 0;
      const ssg =
        maturePrior > 0 ? ((matureCurrent - maturePrior) / maturePrior) * 100 : 0;

      return {
        month: format(new Date(month + "-01"), "MMM yyyy"),
        totalGrowth: Math.round(totalGrowth * 10) / 10,
        ssg: Math.round(ssg * 10) / 10,
      };
    });
  }, [salesData, priorSalesData, locationsData, dateTo]);

  /* --- Mature vs New location labels -------------------------------- */
  const locationMaturityInfo = useMemo(() => {
    const cutoffDate = subYears(dateTo, 1);
    const info: { name: string; status: "Mature" | "New" }[] = [];
    for (const loc of locationsData) {
      const isMature = loc.opened_date && new Date(loc.opened_date) <= cutoffDate;
      info.push({ name: loc.name, status: isMature ? "Mature" : "New" });
    }
    return info;
  }, [locationsData, dateTo]);

  /* --- KPI cards ---------------------------------------------------- */
  const groupMargin = groupRevenueTotal > 0
    ? (groupEbitdaTotal / groupRevenueTotal) * 100
    : 0;

  const kpis: KPIData[] = [
    {
      label: `Group EBITDA (L${last4Idx.length}W)`,
      value: formatCurrency(groupEbitdaLast4),
      trend: groupEbitdaLast4 > 0 ? 1 : -1,
    },
    {
      label: "EBITDA Margin %",
      value: formatPercent(groupMargin),
      trend: groupMargin > 15 ? 1 : -1,
    },
    {
      label: "Best Location",
      value: bestLoc.name,
      trend: 1,
    },
    {
      label: "Worst Location",
      value: worstLoc.name,
      trend: -1,
    },
  ];

  /* --- P&L table helpers -------------------------------------------- */
  function toggleUnit(name: string) {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const pnlTotals = MOCK_PNL_UNITS.reduce(
    (acc, u) => ({
      tradingIncome: acc.tradingIncome + u.tradingIncome,
      wages: acc.wages + u.wages,
      advertising: acc.advertising + u.advertising,
      rent: acc.rent + u.rent,
      utilities: acc.utilities + u.utilities,
      sga: acc.sga + u.sga,
      opex: acc.opex + computeOpex(u),
      ebitda: acc.ebitda + computeEbitda(u),
    }),
    { tradingIncome: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0, opex: 0, ebitda: 0 }
  );

  const totalMargin = pnlTotals.tradingIncome > 0
    ? (pnlTotals.ebitda / pnlTotals.tradingIncome) * 100
    : 0;

  /* --- Dynamic subtitle --------------------------------------------- */
  const subtitle = weekCount > 0
    ? `Weekly EBITDA — ${formatDateRangeLabel(dateFrom, dateTo)} (${filteredCountLabel(weekCount, "week")}) | Real accounting data`
    : "No data in selected range";

  /* --- OPEX chart data (filtered) ----------------------------------- */
  const opexChartData = useMemo(
    () =>
      filteredIdx.map((i) => {
        const spaRev = MOCK_SPA_SERVICE_REV[i] + MOCK_SPA_PRODUCT_REV[i];
        const spaOpexPct = spaRev > 0 ? (MOCK_SPA_COGS[i] / spaRev) * 100 : 0;
        const aesRev = MOCK_AES_REV[i];
        const aesOpexPct = aesRev > 0 ? ((aesRev - MOCK_AES_EBITDA[i]) / aesRev) * 100 : 0;
        const slimRev = MOCK_SLIM_REV[i];
        const slimOpexPct = slimRev > 0 ? ((slimRev - MOCK_SLIM_EBITDA[i]) / slimRev) * 100 : 0;
        return {
          week: WEEKS[i],
          Spa: Math.round(spaOpexPct * 10) / 10,
          Aesthetics: Math.round(aesOpexPct * 10) / 10,
          Slimming: Math.round(slimOpexPct * 10) / 10,
        };
      }),
    [filteredIdx]
  );

  /* --- Heatmap data (filtered) -------------------------------------- */
  const heatmapUnits = useMemo(
    () => [
      ...Object.entries(MOCK_LOC_EBITDA).map(([name, arr]) => ({
        name,
        data: filterByIndices(arr, filteredIdx),
      })),
      { name: "Aesthetics", data: filterByIndices(MOCK_AES_EBITDA, filteredIdx) },
      { name: "Slimming", data: filterByIndices(MOCK_SLIM_EBITDA, filteredIdx) },
    ],
    [filteredIdx]
  );

  /* --- Render ------------------------------------------------------- */
  return (
    <>
      <h1 className="text-xl md:text-2xl font-bold text-foreground">Finance Dashboard</h1>
      <p className="text-sm text-muted-foreground -mt-2 mb-2">
        {subtitle}
      </p>

      {/* KPI Cards with sparklines */}
      <KPICardRow kpis={kpis} />

      {/* Sparkline summary row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Group EBITDA Trend</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(groupEbitdaTotal)}</p>
              <p className="text-xs text-muted-foreground">{filteredCountLabel(weekCount, "week")} total</p>
            </div>
            <Sparkline data={groupEbitdaWeekly} width={100} height={32} color="#22C55E" label="Group EBITDA weekly trend" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Spa EBITDA Trend</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(sumFiltered(MOCK_SPA_EBITDA, filteredIdx))}</p>
            </div>
            <Sparkline data={filterByIndices(MOCK_SPA_EBITDA, filteredIdx)} width={100} height={32} color={chartColors.spa} label="Spa EBITDA weekly" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Aesthetics Trend</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(sumFiltered(MOCK_AES_EBITDA, filteredIdx))}</p>
            </div>
            <Sparkline data={filterByIndices(MOCK_AES_EBITDA, filteredIdx)} width={100} height={32} color={chartColors.aesthetics} label="Aesthetics EBITDA weekly" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Slimming Trend</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(sumFiltered(MOCK_SLIM_EBITDA, filteredIdx))}</p>
            </div>
            <Sparkline data={filterByIndices(MOCK_SLIM_EBITDA, filteredIdx)} width={100} height={32} color={chartColors.slimming} label="Slimming EBITDA weekly" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* PRIMARY: EBITDA by Location — ComposedChart */}
        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">EBITDA by Business Unit</h2>
          <p className="text-xs text-muted-foreground mb-4">Cumulative {filteredCountLabel(weekCount, "week")}, sorted by performance. Green = profit, Red = loss.</p>
          <div className="h-[260px] md:h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={ebitdaByLocationData} margin={{ top: 5, right: 10, left: 10, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="location" angle={-40} textAnchor="end" height={80} tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="left"
                tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                label={{ value: "EBITDA (EUR)", angle: -90, position: "insideLeft", offset: -5, style: { fontSize: 11 } }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v: number) => `${v}%`}
                label={{ value: "Margin %", angle: 90, position: "insideRight", offset: -5, style: { fontSize: 11 } }}
              />
              <Tooltip
                formatter={(value: any, name: any) =>
                  name === "EBITDA" ? formatCurrency(Number(value)) : `${value}%`
                }
              />
              <Legend />
              <ReferenceLine yAxisId="left" y={0} stroke="#9CA3AF" strokeDasharray="3 3" />
              <Bar yAxisId="left" dataKey="ebitda" name="EBITDA">
                {ebitdaByLocationData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.location === "Corporate" ? "#9CA3AF" : entry.ebitda >= 0 ? "#22C55E" : "#EF4444"}
                  />
                ))}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="margin"
                name="Margin %"
                stroke={chartColors.target}
                strokeWidth={chartDefaults.strokeWidth}
                dot={{ r: chartDefaults.dotRadius }}
              />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </Card>

        {/* EBITDA Trend — Multi-line */}
        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Weekly EBITDA Trend</h2>
          <p className="text-xs text-muted-foreground mb-4">Top 3 spas + Aesthetics + Slimming</p>
          <div className="h-[260px] md:h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={chartDefaults.margin}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
              <Legend />
              <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="Hugos"
                stroke={chartColors.spa}
                fill={chartColors.spa}
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="Inter"
                stroke="#D4A853"
                fill="#D4A853"
                fillOpacity={0.1}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="Hyatt"
                stroke="#8B7332"
                fill="#8B7332"
                fillOpacity={0.08}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="Aesthetics"
                stroke={chartColors.aesthetics}
                fill={chartColors.aesthetics}
                fillOpacity={0.1}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="Slimming"
                stroke={chartColors.slimming}
                fill={chartColors.slimming}
                fillOpacity={0.1}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Contribution Waterfall */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Contribution Waterfall</h2>
        <p className="text-xs text-muted-foreground mb-4">How each unit contributes to Group EBITDA ({filteredCountLabel(weekCount, "week")} cumulative)</p>
        <div className="h-[260px] md:h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={waterfallData} margin={{ top: 20, right: 10, left: 10, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-40} textAnchor="end" height={80} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(value: any, name: any) => {
                if (name === "invisible") return [null, null];
                return [formatCurrency(Number(value)), "Contribution"];
              }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                const entry = waterfallData.find((d) => d.name === label);
                if (!entry) return null;
                return (
                  <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
                    <p className="font-semibold text-foreground text-sm">{entry.name}</p>
                    <p className={`text-sm ${entry.value >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {formatCurrency(entry.value)}
                    </p>
                    {!entry.isTotal && (
                      <p className="text-xs text-muted-foreground">
                        Running: {formatCurrency(entry.cumulative)}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" />
            {/* Invisible base bar */}
            <Bar dataKey="start" stackId="waterfall" fill="transparent" />
            {/* Visible bar showing the delta */}
            <Bar dataKey="value" stackId="waterfall">
              {waterfallData.map((entry, index) => (
                <Cell
                  key={`wf-${index}`}
                  fill={
                    entry.isTotal ? "#3B82F6" :
                    entry.value >= 0 ? "#22C55E" : "#EF4444"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
      </Card>

      {/* P&L Drill-Down Table */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">P&L by Business Unit</h2>
        <p className="text-xs text-muted-foreground mb-4">Cumulative {filteredCountLabel(weekCount, "week")} ({formatDateRangeLabel(dateFrom, dateTo)}). Click to expand.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Business Unit</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">Trading Income</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">OPEX</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">EBITDA</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_PNL_UNITS.map((unit) => {
                const opex = computeOpex(unit);
                const ebitda = computeEbitda(unit);
                const margin = computeMargin(unit);
                const isExpanded = expandedUnits.has(unit.name);

                return (
                  <PnLUnitRow
                    key={unit.name}
                    unit={unit}
                    opex={opex}
                    ebitda={ebitda}
                    margin={margin}
                    isExpanded={isExpanded}
                    onToggle={() => toggleUnit(unit.name)}
                  />
                );
              })}

              {/* Spa sub-locations (non-expandable summary) */}
              <tr className="border-t border-border/50">
                <td colSpan={5} className="py-2 px-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Spa Per-Location EBITDA ({filteredCountLabel(weekCount, "week")} cumulative)</p>
                </td>
              </tr>
              {locationCumulativeEbitda
                .sort((a, b) => b.ebitda - a.ebitda)
                .map((loc) => (
                  <tr key={loc.name} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="py-2 px-4 pl-8 text-foreground text-sm">{loc.name}</td>
                    <td className="text-right py-2 px-4 text-muted-foreground">—</td>
                    <td className="text-right py-2 px-4 text-muted-foreground">—</td>
                    <td className={`text-right py-2 px-4 font-medium ${loc.ebitda >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {formatCurrency(loc.ebitda)}
                    </td>
                    <td className="text-right py-2 px-4">
                      <Sparkline data={loc.trend} width={60} height={18} color={loc.ebitda >= 0 ? "#22C55E" : "#EF4444"} />
                    </td>
                  </tr>
                ))}

              {/* Total row */}
              <tr className="border-t-2 border-border font-bold bg-muted/50">
                <td className="py-3 px-4 text-foreground">Group Total</td>
                <td className="text-right py-3 px-4 text-foreground">{formatCurrency(pnlTotals.tradingIncome)}</td>
                <td className="text-right py-3 px-4 text-foreground">{formatCurrency(pnlTotals.opex)}</td>
                <td className={`text-right py-3 px-4 ${pnlTotals.ebitda >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {formatCurrency(pnlTotals.ebitda)}
                </td>
                <td className={`text-right py-3 px-4 ${totalMargin >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {formatPercent(totalMargin)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Same-Store Growth (SSG) — Real data from hooks */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Total Growth vs Same-Store Growth
        </h2>
        <p className="text-xs text-muted-foreground mb-3">YoY comparison from live sales data</p>
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading SSG data...</p>
        ) : (
          <>
            <div className="flex gap-4 mb-4 text-sm text-muted-foreground flex-wrap">
              {locationMaturityInfo.map((loc) => (
                <span key={loc.name} className="flex items-center gap-1">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      loc.status === "Mature" ? "bg-emerald-500" : "bg-amber-400"
                    }`}
                  />
                  {loc.name}{" "}
                  <span className="text-muted-foreground/60">({loc.status})</span>
                </span>
              ))}
            </div>
            <div className="h-[220px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ssgChartData} margin={chartDefaults.margin}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis tickFormatter={(v: number) => `${v}%`} />
                <Tooltip formatter={(v: any) => `${v}%`} />
                <Legend />
                <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="totalGrowth"
                  name="Total Growth"
                  stroke={chartColors.spa}
                  strokeWidth={chartDefaults.strokeWidth}
                  dot={{ r: chartDefaults.dotRadius }}
                />
                <Line
                  type="monotone"
                  dataKey="ssg"
                  name="Same-Store Growth"
                  stroke={chartColors.slimming}
                  strokeWidth={chartDefaults.strokeWidth}
                  dot={{ r: chartDefaults.dotRadius }}
                />
              </LineChart>
            </ResponsiveContainer>
            </div>
          </>
        )}
      </Card>

      {/* OPEX as % of Revenue Trend */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">OPEX as % of Revenue</h2>
        <p className="text-xs text-muted-foreground mb-4">Operating efficiency — lower is better</p>
        <div className="h-[260px] md:h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={opexChartData} margin={chartDefaults.margin}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="week" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 120]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip formatter={(v: any) => `${v}%`} />
            <Legend />
            <ReferenceLine y={70} stroke={chartColors.target} strokeDasharray="5 5" label={{ value: "Target 70%", position: "insideTopRight", fill: chartColors.target, fontSize: 11 }} />
            <Line type="monotone" dataKey="Spa" stroke={chartColors.spa} strokeWidth={chartDefaults.strokeWidth} dot={{ r: chartDefaults.dotRadius }} />
            <Line type="monotone" dataKey="Aesthetics" stroke={chartColors.aesthetics} strokeWidth={chartDefaults.strokeWidth} dot={{ r: chartDefaults.dotRadius }} />
            <Line type="monotone" dataKey="Slimming" stroke={chartColors.slimming} strokeWidth={chartDefaults.strokeWidth} dot={{ r: chartDefaults.dotRadius }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
        </div>
      </Card>

      {/* EBITDA Heatmap by Unit */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">EBITDA Heatmap by Unit</h2>
        <p className="text-xs text-muted-foreground mb-4">Green = profit, Red = loss — spot patterns at a glance</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground sticky left-0 bg-background z-10 min-w-[90px]">Unit</th>
                {filteredWeeks.map((w) => (
                  <th key={w} className="text-center py-2 px-1 font-medium text-muted-foreground whitespace-nowrap">{w}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapUnits.map((unit) => {
                const maxAbs = Math.max(...unit.data.map((v) => Math.abs(v)), 1);
                return (
                  <tr key={unit.name} className="border-b border-border/20">
                    <td className="py-2 px-2 font-medium text-foreground sticky left-0 bg-background z-10 whitespace-nowrap">{unit.name}</td>
                    {unit.data.map((val, i) => {
                      const intensity = Math.min(Math.abs(val) / maxAbs, 1);
                      const opacity = 0.15 + intensity * 0.7;
                      const bgClass = val >= 0 ? "bg-emerald-500" : "bg-red-500";
                      const textClass = intensity > 0.5 ? "text-white" : val >= 0 ? "text-emerald-900" : "text-red-900";
                      const display = Math.abs(val) >= 1000 ? `${(val / 1000).toFixed(1)}K` : `${val}`;
                      return (
                        <td key={i} className="py-2 px-1 text-center">
                          <div className={`rounded px-1 py-1 ${bgClass} ${textClass}`} style={{ opacity }}>
                            {display}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <CIChat />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  P&L Unit Row — collapsible                                         */
/* ------------------------------------------------------------------ */

function PnLUnitRow({
  unit,
  opex,
  ebitda,
  margin,
  isExpanded,
  onToggle,
}: {
  unit: PnLUnit;
  opex: number;
  ebitda: number;
  margin: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="border-b border-border hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="py-3 px-4 text-foreground font-medium">
          <span className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            {unit.name}
          </span>
        </td>
        <td className="text-right py-3 px-4 text-foreground">
          {unit.tradingIncome > 0 ? formatCurrency(unit.tradingIncome) : "—"}
        </td>
        <td className="text-right py-3 px-4 text-foreground">{formatCurrency(opex)}</td>
        <td className={`text-right py-3 px-4 font-medium ${ebitda >= 0 ? "text-emerald-600" : "text-red-500"}`}>
          {formatCurrency(ebitda)}
        </td>
        <td className={`text-right py-3 px-4 font-medium ${margin >= 0 ? "text-emerald-600" : "text-red-500"}`}>
          {unit.tradingIncome > 0 ? formatPercent(margin) : "—"}
        </td>
      </tr>

      {isExpanded && (
        <>
          <PnLDetailRow label="Trading Income" amount={unit.tradingIncome} isBold />
          <PnLDetailRow label="Wages & Salaries" amount={-unit.wages} />
          <PnLDetailRow label="Advertising & Marketing" amount={-unit.advertising} />
          {unit.rent > 0 && <PnLDetailRow label="Rent" amount={-unit.rent} />}
          {unit.utilities > 0 && <PnLDetailRow label="Utilities" amount={-unit.utilities} />}
          {unit.sga > 0 && <PnLDetailRow label="SG&A" amount={-unit.sga} />}
          <PnLDetailRow label="OPEX" amount={-opex} isBold />
          <PnLDetailRow label="EBITDA" amount={ebitda} isBold isHighlight />
          <PnLDetailRow
            label="EBITDA Margin %"
            amount={null}
            displayValue={unit.tradingIncome > 0 ? formatPercent(margin) : "—"}
            isBold
            isHighlight
          />
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  P&L Detail Row                                                     */
/* ------------------------------------------------------------------ */

function PnLDetailRow({
  label,
  amount,
  displayValue,
  isBold = false,
  isHighlight = false,
}: {
  label: string;
  amount: number | null;
  displayValue?: string;
  isBold?: boolean;
  isHighlight?: boolean;
}) {
  const formattedValue = displayValue ?? (amount !== null ? formatCurrency(amount) : "—");
  const isNegative = amount !== null && amount < 0;

  return (
    <tr className={`${isHighlight ? "bg-muted/40" : "bg-muted/20"}`}>
      <td
        className={`py-2 px-4 pl-6 md:pl-12 text-muted-foreground ${isBold ? "font-semibold" : ""}`}
        colSpan={3}
      >
        {label}
      </td>
      <td
        className={`text-right py-2 px-4 ${isBold ? "font-semibold" : ""} ${
          isHighlight
            ? amount !== null && amount >= 0
              ? "text-emerald-600"
              : "text-red-500"
            : isNegative
            ? "text-red-400"
            : "text-foreground"
        }`}
        colSpan={2}
      >
        {formattedValue}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Page export                                                        */
/* ------------------------------------------------------------------ */

export default function FinancePage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <FinanceContent dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      )}
    </DashboardShell>
  );
}
