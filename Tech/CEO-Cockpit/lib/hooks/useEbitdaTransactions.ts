"use client";

import { useQuery } from "@tanstack/react-query";

// Mirrors the /api/finance/ebitda-transactions response.
export interface DrillTransaction {
  account_code:      string;
  account_name:      string;
  date:              string;
  transaction_type:  string;
  transaction_id:    string;
  reference:         string;
  payee:             string;
  description:       string;
  amount:            number;          // literal Zoho GL amount (signed, EUR)
  venue:             string;
  allocation_factor: number;
  allocated_amount:  number;          // amount × factor — reconciles to the cell
  is_split:          boolean;
  used_fallback:     boolean;
}

export interface DrillSyntheticRow {
  account_code: string;
  account_name: string;
  venue:        string;
  period_value: number;
  reason:       string;
}

export interface EbitdaTransactionsResponse {
  date_from:           string;
  date_to:             string;
  brand:               string | null;
  venue:               string;
  category:            string;
  channel:             string | null;
  cell_total:          number;
  literal_total:       number;
  txn_count:           number;
  txn_allocated_total: number;
  reconciles:          boolean;
  transactions:        DrillTransaction[];
  synthetic_rows:      DrillSyntheticRow[];
  notes:               string[];
}

// What the page passes when a cell is double-clicked / activated. `venue` is the
// venueRow.id-derived display name (or the special "spa-aggregate" / "group" /
// "hq" sentinels the route understands). `brand` scopes the aggregated fetch.
export interface DrillTarget {
  brand:    "SPA" | "AES" | "SLIM" | "HQ" | null;
  venue:    string;                 // display name | "spa-aggregate" | "group" | "hq"
  category: string;                 // ebitda category | "rent_plus" | "sga_*" | "advertising" | "revenue"
  channel?: string | null;          // advertising channel sub-row
  wageRole?: string | null;         // wage role sub-row (client-side only — not sent to API)
  label:    string;                 // human label for the dialog title (row × column)
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function useEbitdaTransactions(
  dateFrom: Date,
  dateTo: Date,
  target: DrillTarget | null,
) {
  const df = toIso(dateFrom);
  const dt = toIso(dateTo);

  return useQuery<EbitdaTransactionsResponse>({
    queryKey: [
      "ebitda-transactions", df, dt,
      target?.brand, target?.venue, target?.category, target?.channel ?? null,
    ],
    enabled: target !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const qs = new URLSearchParams({
        date_from: df,
        date_to:   dt,
        venue:     target!.venue,
        category:  target!.category,
      });
      if (target!.brand) qs.set("brand", target!.brand);
      if (target!.channel) qs.set("channel", target!.channel);
      const res = await fetch(`/api/finance/ebitda-transactions?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body || `HTTP ${res.status}`);
      }
      return res.json();
    },
  });
}
