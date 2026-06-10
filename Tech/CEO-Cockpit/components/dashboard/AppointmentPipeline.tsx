"use client";

import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { chartColors } from "@/lib/charts/config";
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
} from "recharts";

interface DayData {
  day: string;
  [location: string]: string | number;
}

const locationColors = [
  chartColors.spa,
  chartColors.aesthetics,
  chartColors.slimming,
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

        const chartData: DayData[] = Object.entries(dayMap).map(
          ([day, locCounts]) => {
            const entry: DayData = { day };
            for (const loc of locs) {
              entry[loc] = locCounts[loc] || 0;
            }
            return entry;
          }
        );

        setData(chartData);
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

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Appointment Pipeline (Next 7 Days)
      </h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <XAxis dataKey="day" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          {locations.map((loc, i) => (
            <Bar
              key={loc}
              dataKey={loc}
              name={loc}
              stackId="a"
              fill={locationColors[i % locationColors.length]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
