"use client";

import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/constants/design-tokens";
import { CalendarDays } from "lucide-react";
import { format, addDays, startOfDay } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LabelList,
} from "recharts";

interface DayData {
  day: string;
  total: number;
  conversionPct: number;
  [location: string]: string | number;
}

// Non-brand categorical palette for location slices (locations are NOT brands).
// Kept consistent for repeatable reads. Brand bars (Spa/Aes/Slim) get explicit BRAND.* dark.
const LOCATION_PALETTE = [
  BRAND.spa.dark,
  BRAND.aesthetics.dark,
  BRAND.slimming.dark,
  "#8B5CF6",
  "#EF4444",
  "#6B7280",
];

export function AppointmentPipeline() {
  const [data, setData] = useState<DayData[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [hasData, setHasData] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAppointments() {
      setLoading(true);
      try {
        const supabase = createClient();
        const today = startOfDay(new Date());
        const nextWeek = addDays(today, 7);

        const { data: rows, error } = await supabase
          .from("appointments")
          .select("scheduled_at, location")
          .gte("scheduled_at", format(today, "yyyy-MM-dd"))
          .lt("scheduled_at", format(nextWeek, "yyyy-MM-dd"));

        if (error || !rows || rows.length === 0) {
          setHasData(false);
          setLoading(false);
          return;
        }

        // Group by day and location
        const uniqueLocations = new Set<string>();
        const dayMap: Record<string, Record<string, number>> = {};

        for (let i = 0; i < 7; i++) {
          const dayKey = format(addDays(today, i), "EEE");
          dayMap[dayKey] = {};
        }

        for (const row of rows) {
          const dayKey = format(new Date(row.scheduled_at), "EEE");
          const loc = (row.location as string) || "Other";
          uniqueLocations.add(loc);
          if (!dayMap[dayKey]) dayMap[dayKey] = {};
          dayMap[dayKey][loc] = (dayMap[dayKey][loc] || 0) + 1;
        }

        const locs = Array.from(uniqueLocations);
        setLocations(locs);

        const rawData: DayData[] = Object.entries(dayMap).map(
          ([day, locCounts]) => {
            const entry: DayData = { day, total: 0, conversionPct: 0 };
            let total = 0;
            for (const loc of locs) {
              const count = locCounts[loc] || 0;
              entry[loc] = count;
              total += count;
            }
            entry.total = total;
            return entry;
          },
        );

        // Conversion % vs first day (pipeline baseline)
        const baseline = rawData[0]?.total ?? 0;
        const withConversion = rawData.map((d) => ({
          ...d,
          conversionPct:
            baseline > 0 ? Math.round((d.total / baseline) * 100) : 0,
        }));

        setData(withConversion);
        setHasData(true);
      } catch {
        setHasData(false);
      }
      setLoading(false);
    }

    fetchAppointments();
  }, []);

  if (loading) {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Appointment Pipeline (Next 7 Days)
        </h2>
        <div className="flex items-center justify-center h-48 text-gray-400">
          Loading...
        </div>
      </Card>
    );
  }

  if (!hasData) {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Appointment Pipeline (Next 7 Days)
        </h2>
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-3">
          <CalendarDays className="h-12 w-12" />
          <p className="text-sm text-center">
            Connect Fresha/Cockpit to see your booking pipeline
          </p>
        </div>
      </Card>
    );
  }

  // Use the LAST stacked series to attach the total + conversion label on top.
  const lastLocation = locations[locations.length - 1];

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        Appointment Pipeline (Next 7 Days)
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Daily booking volume — labels show total + conversion vs day 1
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 28, right: 30, left: 20, bottom: 5 }}>
          <XAxis dataKey="day" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v: unknown, name) => [String(Number(v)), String(name ?? "")]}
            labelFormatter={(label) => {
              const row = data.find((d) => d.day === label);
              return row
                ? `${label} — ${row.total} appts · ${row.conversionPct}% of baseline`
                : String(label);
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {locations.map((loc, i) => (
            <Bar
              key={loc}
              dataKey={loc}
              name={loc}
              stackId="a"
              fill={LOCATION_PALETTE[i % LOCATION_PALETTE.length]}
            >
              {loc === lastLocation && (
                <LabelList
                  dataKey="total"
                  content={(props) => {
                    const { x, y, width, index } = props as Record<
                      string,
                      unknown
                    >;
                    const idx = Number(index);
                    const row = data[idx];
                    if (!row) return <></>;
                    return (
                      <g>
                        <text
                          x={Number(x) + Number(width) / 2}
                          y={Number(y) - 14}
                          textAnchor="middle"
                          fontSize={11}
                          fontWeight={700}
                          fill="#374151"
                        >
                          {row.total}
                        </text>
                        <text
                          x={Number(x) + Number(width) / 2}
                          y={Number(y) - 2}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight={600}
                          fill="#9CA3AF"
                        >
                          {row.conversionPct}%
                        </text>
                      </g>
                    );
                  }}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
