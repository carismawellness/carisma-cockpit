"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CIChat } from "@/components/ci/CIChat";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { KPICardRow, KPIData } from "@/components/dashboard/KPICardRow";
import { Card } from "@/components/ui/card";
import {
  chartColors,
  formatCurrency,
} from "@/lib/charts/config";
import {
  monthIndicesToDateObjects,
  getFilteredIndices,
  formatDateRangeLabel,
  filteredCountLabel,
} from "@/lib/utils/mock-date-filter";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

/* ------------------------------------------------------------------ */
/*  LOCATION DATA                                                      */
/* ------------------------------------------------------------------ */

type LocationType = "spa" | "clinic";

interface LocationConfig {
  id: string;
  name: string;
  type: LocationType;
  color: string;
  startIndex: number;
}

const LOCATIONS: LocationConfig[] = [
  { id: "inter",      name: "InterContinental", type: "spa",    color: "#1B3A4B", startIndex: 0 },
  { id: "hugos",      name: "Hugo's",           type: "spa",    color: "#96B2B2", startIndex: 0 },
  { id: "hyatt",      name: "Hyatt",            type: "spa",    color: "#B79E61", startIndex: 0 },
  { id: "ramla",      name: "Ramla",            type: "spa",    color: "#8EB093", startIndex: 0 },
  { id: "labranda",   name: "Labranda",         type: "spa",    color: "#E07A5F", startIndex: 0 },
  { id: "sunny",      name: "Sunny Coast",      type: "spa",    color: "#4A90D9", startIndex: 0 },
  { id: "excelsior",  name: "Excelsior",        type: "spa",    color: "#7C3AED", startIndex: 18 },
  { id: "novotel",    name: "Novotel",          type: "spa",    color: "#DC2626", startIndex: 21 },
  { id: "aesthetics", name: "Aesthetics",       type: "clinic", color: chartColors.aesthetics, startIndex: 12 },
  { id: "slimming",   name: "Slimming",         type: "clinic", color: chartColors.slimming, startIndex: 12 },
];

interface MonthlyPL {
  revenue: number;
  salaries: number;
  sga: number;
  rent: number;
  ebitda: number;
  ebitdaPct: number;
}

/* ---- PER-LOCATION MONTHLY DATA (indices 0-11 = 2024, 12-23 = 2025, 24-27 = 2026) ---- */

const MONTH_DATES = monthIndicesToDateObjects(2024, 28);

function buildLocationData(): Record<string, (MonthlyPL | null)[]> {
  function buildSpa(
    rev: number[], sal: number[], sga: number[], rent: number[], ebitda: number[],
    startIdx = 0,
  ): (MonthlyPL | null)[] {
    return Array.from({ length: 28 }, (_, i) => {
      if (i < startIdx || i - startIdx >= rev.length) return null;
      const idx = i - startIdx;
      const r = rev[idx]; const e = ebitda[idx];
      return { revenue: r, salaries: sal[idx], sga: sga[idx], rent: rent[idx], ebitda: e, ebitdaPct: r > 0 ? Math.round((e / r) * 100) : 0 };
    });
  }

  return {
    inter: buildSpa(
      [38806,46282,52520,51826,48362,47792,49712,54569,53577,52550,46854,35540, 36040,45313,49185,48561,49080,42226,50103,60745,55492,59595,53433,43700, 37200,46800,50900,49800],
      [18214,15252,17674,15803,13796,13936,13845,15315,11190,13384,13901,11687, 13151,12099,23048,18814,19153,22455,22736,22120,20955,23982,25689,19000, 14200,13500,24100,19500],
      [4690,3295,416,495,143,484,556,586,487,533,1246,2548, 2914,1965,1453,1735,1792,1603,1586,1536,1630,1654,1995,1800, 2100,1850,1500,1680],
      [4400,4400,4400,4400,4400,4400,5100,5100,5100,5100,5100,5100, 5100,5100,5100,5100,5100,5100,5100,5100,5100,5100,5100,5100, 5100,5100,5100,5100],
      [11502,23335,30030,31128,30023,28972,30211,33568,36800,33533,26606,16205, 14875,26149,19584,22912,23035,13068,20681,31989,27807,28859,20649,17800, 15800,26350,20200,23520],
    ),
    hugos: buildSpa(
      [39581,42237,47242,44581,41316,27918,28886,35135,44014,46741,51718,39818, 43373,48550,61182,57333,49058,43157,40712,45157,47571,60531,47660,36500, 44500,49800,62500,58200],
      [11971,12210,13883,12319,11346,11769,11716,11145,11405,10809,10855,10913, 13708,27739,28752,21535,20266,18415,18104,19822,17528,21600,19583,15000, 14200,28500,29200,22000],
      [753,0,0,1669,1494,3038,3503,979,1249,1592,35,1245, 1618,1648,1731,1993,1993,1993,1052,1353,1482,1679,1365,1200, 1550,1700,1800,1950],
      [0,0,0,0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0,0,0,0, 0,0,0,0],
      [26527,29796,32916,30120,28352,12856,13424,22149,30539,33235,39344,28101, 27397,18518,30054,33210,26242,22788,21036,23378,28019,36729,26192,14961, 28750,19600,31500,34250],
    ),
    hyatt: buildSpa(
      [18623,28490,34882,25968,23240,24483,28983,25934,27200,26186,24628,20627, 23517,30813,29519,24622,25531,22240,23569,24503,24445,24688,22335,20700, 24100,31200,30100,25300],
      [7444,7314,9763,7749,8877,10833,9429,6198,8772,9134,5597,6527, 10837,7808,9973,10404,10787,11182,10403,11771,13491,8678,10078,9000, 11200,8100,10500,10800],
      [0,0,0,0,0,0,0,0,0,0,0,33, 39,25,25,25,165,258,47,134,81,397,66,100, 50,30,35,30],
      [0,0,0,0,0,0,0,0,0,0,0,0, 1366,1366,1366,1366,1366,1366,1407,1407,1407,1407,1407,1407, 1407,1407,1407,1407],
      [13716,20835,24556,17623,13925,13359,19189,19076,17668,16247,18168,14572, 10791,21130,17671,12437,12785,9366,11322,10801,9076,13816,10366,6221, 11443,21663,18158,13063],
    ),
    ramla: buildSpa(
      [13911,23373,23672,23883,24343,22418,20569,20430,23952,22530,21930,17767, 21261,24740,29739,27299,32358,25052,27269,33298,33907,49210,34970,29800, 22500,25800,30500,28200],
      [3477,3145,2910,2945,5306,6069,5066,5047,7602,7806,9216,8603, 10117,6209,5272,11526,13114,15310,13630,8946,16985,11914,13566,12000, 10800,6800,5900,12200],
      [0,0,0,603,0,0,0,0,0,0,0,279, 238,320,348,448,448,448,331,252,310,399,264,300, 260,340,370,420],
      [0,0,0,0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0,0,0,0, 0,0,0,0],
      [10263,20004,20403,19939,18855,16230,15272,15070,15973,14385,12202,7633, 10407,17767,23700,14455,17732,7317,11889,22280,15308,35409,19594,12511, 11440,18660,24230,15580],
    ),
    labranda: buildSpa(
      [8939,9049,12329,13659,20261,16006,16652,15518,13717,18301,18949,13188, 12637,13483,16739,17967,19812,20423,23015,27132,28589,23819,20133,15100, 13200,14100,17500,18800],
      [5304,5536,8568,4928,5528,1637,6051,3677,6252,4099,7060,7565, 2714,2920,7425,8115,9745,5567,4438,8406,13328,10903,7313,6000, 3100,3400,8000,8600],
      [1582,1115,823,1100,866,689,731,724,698,851,702,730, 705,697,766,741,715,715,819,881,722,775,777,700, 720,710,750,730],
      [1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000, 1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000, 1000,1000,1000,1000],
      [898,1291,1690,6324,12494,12359,8553,9835,5527,11868,9620,4094, 8111,8759,7441,8024,8238,13411,16672,16745,13452,11055,10957,4389, 8380,8990,7750,8470],
    ),
    sunny: buildSpa(
      [8488,10958,11558,17890,17408,17000,20711,19279,19624,20456,19926,15877, 10154,12312,12923,15724,19948,17615,21755,24891,28589,27076,20775,11600, 10800,13100,13500,16400],
      [11587,8572,8210,8156,8422,10126,8745,7522,6490,5871,6013,8621, 6804,9089,4550,6495,7610,8146,8481,7188,12232,17011,12836,8500, 7200,9400,5000,6800],
      [621,399,155,157,361,384,157,168,185,119,119,413, 535,483,603,495,526,372,380,461,439,676,451,400, 500,470,580,480],
      [2833,2833,2833,2833,2833,2833,2833,2833,2833,2833,2833,2833, 1097,2833,2833,2833,2833,2833,2833,2833,2833,2833,2833,2833, 2833,2833,2833,2833],
      [-6617,-959,192,6418,5525,3454,8553,8328,9659,11158,10477,4033, 1584,-228,4802,5793,8871,6367,9922,14301,12965,6448,4535,350, 267,397,5087,6287],
    ),
    excelsior: buildSpa(
      [21495,22574,25634,24960,24192,20000, 21800,23400,26200,25500],
      [2708,10663,15772,12780,13038,11000, 12200,11500,16000,13200],
      [0,0,0,0,0,0, 0,0,0,0],
      [0,0,0,0,0,0, 0,0,0,0],
      [18787,11911,9862,12180,11154,-872, 9600,11900,10200,12300],
      18,
    ),
    novotel: buildSpa(
      [3325,14194,10700, 5200,15800,12400,11500],
      [0,1447,1200, 800,1600,1400,1300],
      [392,205,200, 350,220,210,190],
      [0,0,0, 0,0,0,0],
      [2933,12542,12536, 4050,13980,10790,10010],
      21,
    ),
    aesthetics: (() => {
      const rev =    [15377,16340,19589,18326,22212,20187,19635,19023,30000,24000,68000,63000, 22000,25500,28000,26800];
      const ebitda = [4225,2544,4940,4883,8059,7062,5065,9102,13805,6549,8836,10674, 6380,8160,9520,8308];
      const ebitdaPct=[27,16,25,27,36,35,26,48,46,27,13,17, 29,32,34,31];
      const wages =  [4918,4980,5531,4189,3323,4510,6025,4162,5500,4500,9000,8000, 5200,5800,6200,5900];
      const sga =    [1614,3068,3127,4191,4761,2212,2940,610,2000,2500,4000,3500, 2200,2800,3100,2700];
      return Array.from({ length: 28 }, (_, i) => {
        if (i < 12) return null;
        const idx = i - 12;
        return { revenue: rev[idx], salaries: wages[idx], sga: sga[idx], rent: 0, ebitda: ebitda[idx], ebitdaPct: ebitdaPct[idx] };
      });
    })(),
    slimming: (() => {
      const rev =    [0,0,0,0,3803,0,6502,7418,8957,1894,5000,4000, 3200,6800,7900,8500];
      const wages =  [0,0,0,0,360,360,360,360,360,360,360,360, 360,360,360,360];
      const ads =    [0,0,0,0,0,1037,769,710,513,505,500,400, 450,550,600,520];
      const ebitda = [0,0,0,0,3443,-1397,5373,6348,8084,1029,4140,3240, 2390,5890,6940,7620];
      return Array.from({ length: 28 }, (_, i) => {
        if (i < 12) return null;
        const idx = i - 12;
        const r = rev[idx]; const e = ebitda[idx];
        return { revenue: r, salaries: wages[idx], sga: ads[idx], rent: 0, ebitda: e, ebitdaPct: r > 0 ? Math.round((e / r) * 100) : 0 };
      });
    })(),
  };
}

const LOCATION_DATA = buildLocationData();

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function sumRangeIndices(locId: string, indices: number[]) {
  const data = LOCATION_DATA[locId];
  let revenue = 0, salaries = 0, sga = 0, rent = 0, ebitda = 0;
  for (const i of indices) {
    const d = data[i];
    if (d) {
      revenue += d.revenue;
      salaries += d.salaries;
      sga += d.sga;
      rent += d.rent;
      ebitda += d.ebitda;
    }
  }
  return { revenue, salaries, sga, rent, ebitda, ebitdaPct: revenue > 0 ? Math.round((ebitda / revenue) * 100) : 0 };
}

/* ------------------------------------------------------------------ */
/*  WATERFALL BUILDER                                                  */
/* ------------------------------------------------------------------ */

function buildWaterfall(indices: number[]) {
  const entries: { name: string; value: number; cumulative: number; start: number; end: number; isTotal?: boolean }[] = [];
  let running = 0;

  // Spa locations sorted by EBITDA desc
  const spaLocs = LOCATIONS.filter(l => l.type === "spa")
    .map(l => ({ name: l.name, ebitda: sumRangeIndices(l.id, indices).ebitda }))
    .sort((a, b) => b.ebitda - a.ebitda);

  for (const loc of spaLocs) {
    const s = running;
    running += loc.ebitda;
    entries.push({ name: loc.name, value: loc.ebitda, cumulative: running, start: s, end: running });
  }

  // Clinics
  for (const loc of LOCATIONS.filter(l => l.type === "clinic")) {
    const totals = sumRangeIndices(loc.id, indices);
    const s = running;
    running += totals.ebitda;
    entries.push({ name: loc.name, value: totals.ebitda, cumulative: running, start: s, end: running });
  }

  // Corporate / HQ expenses (estimated)
  const corpExpenses = -85000;
  const sBeforeCorp = running;
  running += corpExpenses;
  entries.push({ name: "Corporate / HQ", value: corpExpenses, cumulative: running, start: sBeforeCorp, end: running });

  // Group Total
  entries.push({ name: "Group EBITDA", value: running, cumulative: running, start: 0, end: running, isTotal: true });

  return entries;
}

/* ------------------------------------------------------------------ */
/*  STACKED BAR CHART DATA BUILDER                                     */
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

const BRAND_ORDER: Record<Brand, number> = { Spa: 0, Aesthetics: 1, Slimming: 2 };

function venueBrand(locId: string): { brand: Brand; color: string } {
  if (locId === "aesthetics") return { brand: "Aesthetics", color: chartColors.aesthetics };
  if (locId === "slimming") return { brand: "Slimming", color: chartColors.slimming };
  return { brand: "Spa", color: chartColors.spa };
}

function buildVenueRows(indices: number[]): VenueRow[] {
  return LOCATIONS.map(loc => {
    const totals = sumRangeIndices(loc.id, indices);
    const rev = totals.revenue;
    const { brand, color } = venueBrand(loc.id);
    if (rev <= 0) {
      return {
        id: loc.id, name: loc.name, brand, brandColor: color,
        wages: 0, advertising: 0, rent: 0, utilities: 0,
        cogs: 0, sga: 0, ebitda: 0, revenue: 0,
      };
    }

    // Redistribute existing costs into 7 cost centers
    const newWages = Math.round(totals.salaries * 0.89);
    const cogsVal = Math.round(totals.salaries * 0.08);
    const utilitiesVal = Math.round(totals.salaries * 0.03);
    const newSga = Math.round(totals.sga * 0.60);
    const advertisingVal = Math.round(totals.sga * 0.40);
    const rentVal = totals.rent;
    const ebitdaVal = rev - newWages - cogsVal - utilitiesVal - newSga - advertisingVal - rentVal;

    return {
      id: loc.id,
      name: loc.name,
      brand,
      brandColor: color,
      wages: newWages,
      advertising: advertisingVal,
      rent: rentVal,
      utilities: utilitiesVal,
      cogs: cogsVal,
      sga: newSga,
      ebitda: ebitdaVal,
      revenue: rev,
    };
  })
    .filter(r => r.revenue > 0)
    .sort((a, b) => {
      const bd = BRAND_ORDER[a.brand] - BRAND_ORDER[b.brand];
      return bd !== 0 ? bd : b.revenue - a.revenue;
    });
}

function pctOf(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

function fmtPct(val: number): string {
  return `${Math.round(val)}%`;
}

function fmtCurrencyShort(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `\u20AC${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000)     return `\u20AC${Math.round(value / 1_000)}K`;
  return `\u20AC${value}`;
}

/* ------------------------------------------------------------------ */
/*  SG&A CATEGORY BREAKDOWN                                            */
/*  Total SG&A comes from Zoho. We allocate it across these categories */
/*  using fixed weights until Zoho line-item CoA mapping is wired up. */
/*  See: 09-Miscellaneous/Workflows/sga-categorization.md              */
/* ------------------------------------------------------------------ */

const SGA_CATEGORIES: { label: string; weight: number }[] = [
  { label: "Prof services", weight: 20000 },
  { label: "Fuel",          weight: 5000 },
  { label: "Laundry",       weight: 50 },
  { label: "Software",      weight: 10 },
  { label: "Cleaning",      weight: 10 },
  { label: "Travel",        weight: 10 },
  { label: "Misc",          weight: 10 },
  { label: "Insurance",     weight: 8 },
  { label: "Events",        weight: 5 },
  { label: "Maintenance",   weight: 5 },
  { label: "Telecom",       weight: 2 },
];
const SGA_WEIGHT_TOTAL = SGA_CATEGORIES.reduce((a, c) => a + c.weight, 0);

function sgaShare(sgaTotal: number, weight: number): number {
  return Math.round(sgaTotal * (weight / SGA_WEIGHT_TOTAL));
}

/* ------------------------------------------------------------------ */
/*  INNER COMPONENT                                                    */
/* ------------------------------------------------------------------ */

function EBITDAOverviewContent({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
}) {
  /* --- Filtered indices from date range ------------------------------ */
  const filteredIdx = useMemo(
    () => getFilteredIndices(MONTH_DATES, dateFrom, dateTo),
    [dateFrom, dateTo]
  );

  const monthCount = filteredIdx.length;
  const rangeLabel = useMemo(() => formatDateRangeLabel(dateFrom, dateTo), [dateFrom, dateTo]);

  /* --- Compute totals per location --------------------------------- */
  const locationTotals = useMemo(
    () =>
      LOCATIONS.map(loc => ({
        ...loc,
        ...sumRangeIndices(loc.id, filteredIdx),
      })).filter(l => l.revenue > 0 || l.ebitda !== 0),
    [filteredIdx]
  );

  /* --- Brand aggregates -------------------------------------------- */
  const { spaTotals, aesSummary, slimSummary, groupRevenue, groupEbitda, groupMargin } = useMemo(() => {
    const spa = locationTotals.filter(l => l.type === "spa").reduce(
      (acc, l) => ({ revenue: acc.revenue + l.revenue, ebitda: acc.ebitda + l.ebitda }),
      { revenue: 0, ebitda: 0 },
    );
    const aes = sumRangeIndices("aesthetics", filteredIdx);
    const slim = sumRangeIndices("slimming", filteredIdx);

    const gRev = spa.revenue + aes.revenue + slim.revenue;
    const gEbitda = spa.ebitda + aes.ebitda + slim.ebitda;
    const gMargin = gRev > 0 ? Math.round((gEbitda / gRev) * 100) : 0;

    return { spaTotals: spa, aesSummary: aes, slimSummary: slim, groupRevenue: gRev, groupEbitda: gEbitda, groupMargin: gMargin };
  }, [locationTotals, filteredIdx]);

  /* --- KPI cards --------------------------------------------------- */
  const kpis: KPIData[] = useMemo(() => [
    { label: "Group Revenue", value: formatCurrency(groupRevenue) },
    { label: `Group EBITDA (${filteredCountLabel(monthCount, "month")})`, value: formatCurrency(groupEbitda) },
    { label: "EBITDA Margin", value: `${groupMargin}%`, target: "30%", targetValue: 30, currentValue: groupMargin },
  ], [groupRevenue, groupEbitda, groupMargin, monthCount]);

  /* --- Waterfall --------------------------------------------------- */
  const waterfallData = useMemo(() => buildWaterfall(filteredIdx), [filteredIdx]);

  /* --- Per-venue rows for the P&L by Venue table -------------------- */
  const venueRows = useMemo(() => buildVenueRows(filteredIdx), [filteredIdx]);
  const venueTotals = useMemo(() => venueRows.reduce(
    (acc, v) => ({
      revenue:     acc.revenue + v.revenue,
      wages:       acc.wages + v.wages,
      advertising: acc.advertising + v.advertising,
      rent:        acc.rent + v.rent,
      utilities:   acc.utilities + v.utilities,
      cogs:        acc.cogs + v.cogs,
      sga:         acc.sga + v.sga,
      ebitda:      acc.ebitda + v.ebitda,
    }),
    { revenue: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, cogs: 0, sga: 0, ebitda: 0 },
  ), [venueRows]);

  const [rentExpanded, setRentExpanded] = useState(false);
  const [adsExpanded, setAdsExpanded] = useState(false);
  const [sgaExpanded, setSgaExpanded] = useState(false);

  /* --- Brand cards data -------------------------------------------- */
  const brands = useMemo(() => [
    {
      name: "Spa",
      color: chartColors.spa,
      ebitda: spaTotals.ebitda,
      revenue: spaTotals.revenue,
      margin: spaTotals.revenue > 0 ? Math.round((spaTotals.ebitda / spaTotals.revenue) * 100) : 0,
      locations: LOCATIONS.filter(l => l.type === "spa").length,
    },
    {
      name: "Aesthetics",
      color: chartColors.aesthetics,
      ebitda: aesSummary.ebitda,
      revenue: aesSummary.revenue,
      margin: aesSummary.ebitdaPct,
      locations: 1,
    },
    {
      name: "Slimming",
      color: chartColors.slimming,
      ebitda: slimSummary.ebitda,
      revenue: slimSummary.revenue,
      margin: slimSummary.ebitdaPct,
      locations: 1,
    },
  ], [spaTotals, aesSummary, slimSummary]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">EBITDA Overview</h1>
          <p className="text-sm text-muted-foreground">
            Group-wide EBITDA performance — {rangeLabel} ({filteredCountLabel(monthCount, "month")})
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <KPICardRow kpis={kpis} />

      {/* Brand Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
        {brands.map(brand => (
          <Card key={brand.name} className="p-3 md:p-6 border-l-4" style={{ borderLeftColor: brand.color }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground">{brand.name}</h3>
            </div>
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
                <span className={`text-sm font-semibold ${
                  brand.margin >= 30 ? "text-emerald-600" : brand.margin >= 15 ? "text-amber-500" : "text-red-600"
                }`}>
                  {brand.margin}%
                </span>
              </div>
              {brand.name === "Spa" && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Locations</span>
                  <span className="text-sm text-foreground">{brand.locations}</span>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* P&L by Venue */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">P&amp;L by Venue</h2>
        <p className="text-sm text-muted-foreground mb-4">
          All {venueRows.length} active venues side-by-side. Color dots indicate brand.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr>
                <th className="text-left py-2 px-3 font-semibold text-muted-foreground sticky left-0 bg-background z-10 min-w-[140px]">
                  Line Item
                </th>
                {venueRows.map((v) => (
                  <th key={v.id} className="text-right py-2 px-3 font-semibold text-foreground min-w-[110px]">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: v.brandColor }}
                        title={v.brand}
                      />
                      {v.name}
                    </span>
                  </th>
                ))}
                <th className="text-right py-2 px-3 font-semibold text-foreground bg-muted/20 border-l border-border min-w-[110px]">
                  Group
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Net Revenue */}
              <tr className="border-b border-border">
                <td className="py-1.5 px-3 font-bold text-foreground sticky left-0 bg-background z-10">Net Revenue</td>
                {venueRows.map((v) => (
                  <td key={v.id} className="py-1.5 px-3 text-right font-bold text-foreground">
                    {fmtCurrencyShort(v.revenue)}
                  </td>
                ))}
                <td className="py-1.5 px-3 text-right font-bold text-foreground bg-muted/20 border-l border-border">
                  {fmtCurrencyShort(venueTotals.revenue)}
                </td>
              </tr>
              {/* Wages & Salaries */}
              <tr className="border-b border-border">
                <td className="py-1.5 px-3 text-foreground sticky left-0 bg-background z-10">Wages &amp; Salaries</td>
                {venueRows.map((v) => (
                  <td key={v.id} className="py-1.5 px-3 text-right text-foreground">
                    ({fmtCurrencyShort(v.wages)}) <span className="text-muted-foreground">{fmtPct(pctOf(v.wages, v.revenue))}</span>
                  </td>
                ))}
                <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                  ({fmtCurrencyShort(venueTotals.wages)}) <span className="text-muted-foreground">{fmtPct(pctOf(venueTotals.wages, venueTotals.revenue))}</span>
                </td>
              </tr>
              {/* Advertising Plus (collapsible: Meta / Google / Klaviyo) */}
              <tr className="border-b border-border">
                <td className="py-1.5 px-3 text-foreground sticky left-0 bg-background z-10">
                  <button
                    type="button"
                    onClick={() => setAdsExpanded((x) => !x)}
                    className="flex items-center gap-1.5 hover:text-foreground/70 transition-colors"
                    aria-expanded={adsExpanded}
                  >
                    {adsExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    <span>Advertising</span>
                  </button>
                </td>
                {venueRows.map((v) => (
                  <td key={v.id} className="py-1.5 px-3 text-right text-foreground">
                    ({fmtCurrencyShort(v.advertising)}) <span className="text-muted-foreground">{fmtPct(pctOf(v.advertising, v.revenue))}</span>
                  </td>
                ))}
                <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                  ({fmtCurrencyShort(venueTotals.advertising)}) <span className="text-muted-foreground">{fmtPct(pctOf(venueTotals.advertising, venueTotals.revenue))}</span>
                </td>
              </tr>
              {adsExpanded && (
                <>
                  {/* TODO(api): replace placeholder splits with live Meta / Google / Klaviyo spend.
                      SPA venues currently share one Meta/Google account — distribute spend across
                      SPA venues by revenue share. Aesthetics and Slimming have their own ad accounts. */}
                  {(() => {
                    const META_PCT = 0.60;
                    const GOOGLE_PCT = 0.30;
                    const KLAVIYO_PCT = 0.10;
                    const channels: { label: string; pct: number }[] = [
                      { label: "Meta",    pct: META_PCT },
                      { label: "Google",  pct: GOOGLE_PCT },
                      { label: "Klaviyo", pct: KLAVIYO_PCT },
                    ];
                    return channels.map(({ label, pct }) => (
                      <tr key={label} className="border-b border-border">
                        <td className="py-1.5 px-3 pl-9 text-muted-foreground sticky left-0 bg-background z-10">
                          {label} <span className="text-[10px] uppercase tracking-wider opacity-60">(api pending)</span>
                        </td>
                        {venueRows.map((v) => {
                          const part = Math.round(v.advertising * pct);
                          return (
                            <td key={v.id} className="py-1.5 px-3 text-right text-foreground">
                              ({fmtCurrencyShort(part)}) <span className="text-muted-foreground">{fmtPct(pctOf(part, v.revenue))}</span>
                            </td>
                          );
                        })}
                        <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                          {(() => {
                            const part = Math.round(venueTotals.advertising * pct);
                            return <>({fmtCurrencyShort(part)}) <span className="text-muted-foreground">{fmtPct(pctOf(part, venueTotals.revenue))}</span></>;
                          })()}
                        </td>
                      </tr>
                    ));
                  })()}
                </>
              )}
              {/* Rent Plus (collapsible: Rent + Utilities) */}
              <tr className="border-b border-border">
                <td className="py-1.5 px-3 text-foreground sticky left-0 bg-background z-10">
                  <button
                    type="button"
                    onClick={() => setRentExpanded((x) => !x)}
                    className="flex items-center gap-1.5 hover:text-foreground/70 transition-colors"
                    aria-expanded={rentExpanded}
                  >
                    {rentExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    <span>Rent Plus</span>
                  </button>
                </td>
                {venueRows.map((v) => {
                  const sum = v.rent + v.utilities;
                  return (
                    <td key={v.id} className="py-1.5 px-3 text-right text-foreground">
                      ({fmtCurrencyShort(sum)}) <span className="text-muted-foreground">{fmtPct(pctOf(sum, v.revenue))}</span>
                    </td>
                  );
                })}
                <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                  {(() => {
                    const sum = venueTotals.rent + venueTotals.utilities;
                    return <>({fmtCurrencyShort(sum)}) <span className="text-muted-foreground">{fmtPct(pctOf(sum, venueTotals.revenue))}</span></>;
                  })()}
                </td>
              </tr>
              {rentExpanded && (
                <>
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 pl-9 text-muted-foreground sticky left-0 bg-background z-10">Rent</td>
                    {venueRows.map((v) => (
                      <td key={v.id} className="py-1.5 px-3 text-right text-foreground">
                        {v.rent > 0
                          ? <>({fmtCurrencyShort(v.rent)}) <span className="text-muted-foreground">{fmtPct(pctOf(v.rent, v.revenue))}</span></>
                          : <span className="text-muted-foreground">&mdash;</span>
                        }
                      </td>
                    ))}
                    <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                      {venueTotals.rent > 0
                        ? <>({fmtCurrencyShort(venueTotals.rent)}) <span className="text-muted-foreground">{fmtPct(pctOf(venueTotals.rent, venueTotals.revenue))}</span></>
                        : <span className="text-muted-foreground">&mdash;</span>
                      }
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 pl-9 text-muted-foreground sticky left-0 bg-background z-10">Utilities</td>
                    {venueRows.map((v) => (
                      <td key={v.id} className="py-1.5 px-3 text-right text-foreground">
                        ({fmtCurrencyShort(v.utilities)}) <span className="text-muted-foreground">{fmtPct(pctOf(v.utilities, v.revenue))}</span>
                      </td>
                    ))}
                    <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                      ({fmtCurrencyShort(venueTotals.utilities)}) <span className="text-muted-foreground">{fmtPct(pctOf(venueTotals.utilities, venueTotals.revenue))}</span>
                    </td>
                  </tr>
                </>
              )}
              {/* COGS */}
              <tr className="border-b border-border">
                <td className="py-1.5 px-3 text-foreground sticky left-0 bg-background z-10">COGS</td>
                {venueRows.map((v) => (
                  <td key={v.id} className="py-1.5 px-3 text-right text-foreground">
                    ({fmtCurrencyShort(v.cogs)}) <span className="text-muted-foreground">{fmtPct(pctOf(v.cogs, v.revenue))}</span>
                  </td>
                ))}
                <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                  ({fmtCurrencyShort(venueTotals.cogs)}) <span className="text-muted-foreground">{fmtPct(pctOf(venueTotals.cogs, venueTotals.revenue))}</span>
                </td>
              </tr>
              {/* SG&A (collapsible: category breakdown) */}
              <tr className="border-b border-border">
                <td className="py-1.5 px-3 text-foreground sticky left-0 bg-background z-10">
                  <button
                    type="button"
                    onClick={() => setSgaExpanded((x) => !x)}
                    className="flex items-center gap-1.5 hover:text-foreground/70 transition-colors"
                    aria-expanded={sgaExpanded}
                  >
                    {sgaExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    <span>SG&amp;A</span>
                  </button>
                </td>
                {venueRows.map((v) => (
                  <td key={v.id} className="py-1.5 px-3 text-right text-foreground">
                    ({fmtCurrencyShort(v.sga)}) <span className="text-muted-foreground">{fmtPct(pctOf(v.sga, v.revenue))}</span>
                  </td>
                ))}
                <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                  ({fmtCurrencyShort(venueTotals.sga)}) <span className="text-muted-foreground">{fmtPct(pctOf(venueTotals.sga, venueTotals.revenue))}</span>
                </td>
              </tr>
              {sgaExpanded && SGA_CATEGORIES.map(({ label, weight }) => (
                <tr key={label} className="border-b border-border">
                  <td className="py-1.5 px-3 pl-9 text-muted-foreground sticky left-0 bg-background z-10">
                    {label} <span className="text-[10px] uppercase tracking-wider opacity-60">(allocated)</span>
                  </td>
                  {venueRows.map((v) => {
                    const part = sgaShare(v.sga, weight);
                    return (
                      <td key={v.id} className="py-1.5 px-3 text-right text-foreground">
                        ({fmtCurrencyShort(part)}) <span className="text-muted-foreground">{fmtPct(pctOf(part, v.revenue))}</span>
                      </td>
                    );
                  })}
                  <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                    {(() => {
                      const part = sgaShare(venueTotals.sga, weight);
                      return <>({fmtCurrencyShort(part)}) <span className="text-muted-foreground">{fmtPct(pctOf(part, venueTotals.revenue))}</span></>;
                    })()}
                  </td>
                </tr>
              ))}
              {/* EBITDA */}
              <tr className="border-t-2 border-border">
                <td className="py-1.5 px-3 font-bold text-foreground sticky left-0 bg-background z-10">EBITDA</td>
                {venueRows.map((v) => (
                  <td key={v.id} className={`py-1.5 px-3 text-right font-bold ${v.ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtCurrencyShort(v.ebitda)}
                  </td>
                ))}
                <td className={`py-1.5 px-3 text-right font-bold bg-muted/20 border-l border-border ${venueTotals.ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {fmtCurrencyShort(venueTotals.ebitda)}
                </td>
              </tr>
              {/* EBITDA % */}
              <tr>
                <td className="py-1.5 px-3 font-bold text-foreground sticky left-0 bg-background z-10">EBITDA %</td>
                {venueRows.map((v) => {
                  const m = pctOf(v.ebitda, v.revenue);
                  const badge = m >= 50 ? "bg-emerald-100 text-emerald-800"
                              : m >= 30 ? "bg-amber-100 text-amber-800"
                              : "bg-red-100 text-red-800";
                  return (
                    <td key={v.id} className="py-1.5 px-3 text-right">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>
                        {fmtPct(m)}
                      </span>
                    </td>
                  );
                })}
                <td className="py-1.5 px-3 text-right bg-muted/20 border-l border-border">
                  {(() => {
                    const m = pctOf(venueTotals.ebitda, venueTotals.revenue);
                    const badge = m >= 50 ? "bg-emerald-100 text-emerald-800"
                                : m >= 30 ? "bg-amber-100 text-amber-800"
                                : "bg-red-100 text-red-800";
                    return (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>
                        {fmtPct(m)}
                      </span>
                    );
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Brand legend */}
        <div className="flex flex-wrap gap-4 mt-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: chartColors.spa }} /> Spa
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: chartColors.aesthetics }} /> Aesthetics
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: chartColors.slimming }} /> Slimming
          </span>
        </div>
      </Card>

      {/* Contribution Waterfall */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Contribution Waterfall</h2>
        <p className="text-xs text-muted-foreground mb-4">How each location contributes to Group EBITDA ({filteredCountLabel(monthCount, "month")})</p>
        <div className="h-[280px] md:h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={waterfallData} margin={{ top: 20, right: 10, left: 10, bottom: 70 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-40} textAnchor="end" height={80} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v: number) => `\u20AC${Math.round(v / 1000)}k`} />
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
              {waterfallData.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.isTotal ? "#3B82F6" : entry.value >= 0 ? "#22C55E" : "#EF4444"}
                />
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
