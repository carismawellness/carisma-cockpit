// components/sales/GroupForecastSummary.tsx
"use client";

import { Card } from "@/components/ui/card";
import type { GroupForecast } from "@/lib/analytics/revenue-forecast";

function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function fmtPct(curr: number, ly: number): string | null {
  if (!ly) return null;
  const pct = ((curr - ly) / ly) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function YoYBadge({ curr, ly }: { curr: number; ly: number }) {
  const pct = fmtPct(curr, ly);
  if (!pct) return null;
  const positive = curr - ly >= 0;
  return (
    <span
      className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${
        positive ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
      }`}
    >
      {pct} vs LY
    </span>
  );
}

function monthName(m: string) {
  const [yearStr, monthStr] = m.split("-");
  const d = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

interface Props {
  forecast:   GroupForecast | null;
  isFetching: boolean;
}

/**
 * Additive forecast strip for the group sales page: projected current month
 * + projected full year. Renders nothing while loading or when no forecast
 * can be computed (no LY data), so it never blocks the actuals view.
 */
export function GroupForecastSummary({ forecast, isFetching }: Props) {
  if (isFetching || !forecast) return null;

  const cur = forecast.months.find((m) => m.isCurrentMonth) ?? null;
  const { fy } = forecast;
  const gPct = `${forecast.g >= 0 ? "+" : ""}${(forecast.g * 100).toFixed(1)}%`;
  const growthBasis = forecast.gMethod === "ytd" ? "YTD YoY growth" : "trailing 3-mo YoY growth";

  return (
    <Card className="p-4 md:p-5 border-dashed space-y-3">
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        {cur && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">
              Projected {monthName(cur.month)} <span className="italic font-semibold">ƒ</span>
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground tabular-nums">
                {fmtK(cur.forecastTotal)}
              </span>
              {cur.lyTotal != null && (
                <>
                  <span className="text-xs text-muted-foreground">vs LY {fmtK(cur.lyTotal)}</span>
                  <YoYBadge curr={cur.forecastTotal} ly={cur.lyTotal} />
                </>
              )}
            </div>
          </div>
        )}
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            Projected FY {fy.year} <span className="italic font-semibold">ƒ</span>
          </p>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-bold text-foreground tabular-nums">
              {fmtK(fy.projectedTotal)}
            </span>
            {fy.confidence && (
              <span
                className="text-xs text-muted-foreground tabular-nums"
                title={`80% confidence interval — actuals to date are known (€${fy.actualsToDate.toLocaleString()}), the band reflects ±${Math.round(fy.confidence.spread * 100)}% uncertainty on the forecast remainder. Wider when LY data is missing for future months.`}
              >
                (80% CI: {fmtK(fy.confidence.lower)} – {fmtK(fy.confidence.upper)})
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {fmtK(fy.actualsToDate)} actuals to date + {fmtK(fy.forecastRemainder)} forecast
            </span>
            {fy.lyTotal > 0 && (
              <>
                <span className="text-xs text-muted-foreground">· vs FY {fy.year - 1} {fmtK(fy.lyTotal)}</span>
                <YoYBadge curr={fy.projectedTotal} ly={fy.lyTotal} />
              </>
            )}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground italic">
        ƒ Forecast — based on {growthBasis} {gPct} applied to last year&apos;s seasonality;
        current month blends month-to-date run-rate. Not actuals.
        {fy.lyMonthsMissing > 0 && (
          <span className="text-amber-700 not-italic">
            {" "}· LY data missing for {fy.lyMonthsMissing} month{fy.lyMonthsMissing === 1 ? "" : "s"} of {fy.year - 1} — FY comparison understated.
          </span>
        )}
      </p>
    </Card>
  );
}
