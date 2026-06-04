"use client";

import { useQuery } from "@tanstack/react-query";

// Mirrors the /api/finance/contact-breakdown response.
export interface ContactBreakdownRow {
  contact_name: string;
  amount:       number;
  pct:          number;
}

export interface ContactBreakdownData {
  org:             string;
  ebitda_line:     string;
  ebitda_sub_line: string | null;
  venue:           string | null;
  date_from:       string;
  date_to:         string;
  total:           number;
  rows:            ContactBreakdownRow[];
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function useContactBreakdown(
  org:           string | null,
  ebitdaLine:    string | null,
  dateFrom:      Date,
  dateTo:        Date,
  enabled:       boolean,
  ebitdaSubLine?: string | null,
  venue?:        string | null,   // venue slug for venue-specific breakdown
) {
  const df = toIso(dateFrom);
  const dt = toIso(dateTo);

  return useQuery<ContactBreakdownData>({
    queryKey: ["contact-breakdown", org, ebitdaLine, df, dt, ebitdaSubLine ?? null, venue ?? null],
    enabled:  enabled && org !== null && ebitdaLine !== null,
    staleTime: 60_000,
    queryFn: async () => {
      let url = `/api/finance/contact-breakdown?org=${org}&ebitda_line=${ebitdaLine}&date_from=${df}&date_to=${dt}`;
      if (ebitdaSubLine) url += `&ebitda_sub_line=${ebitdaSubLine}`;
      if (venue)         url += `&venue=${encodeURIComponent(venue)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body || `HTTP ${res.status}`);
      }
      return res.json();
    },
  });
}
