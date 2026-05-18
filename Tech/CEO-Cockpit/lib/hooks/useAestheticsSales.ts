"use client";

import { useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AestheticsSaleRow {
  id:              number;
  sheet_tab:       string;
  month:           string;
  date_of_service: string | null;
  invoice:         string | null;
  customer:        string | null;
  service_product: string | null;
  price_inc_vat:   number | null;
  vat_rate:        number | null;
  price_ex_vat:    number | null;
  payment_method:  string | null;
  sales_staff:     string | null;
  note_person:     string | null;
  synced_at:       string;
}

export interface PersonBreakdown {
  person:        string;
  vat_rate:      number;       // 0.12 or 0.18
  tx_count:      number;
  revenue_ex:    number;       // ex-VAT
  revenue_inc:   number;       // inc-VAT
  vat_amount:    number;
}

export interface ServiceBreakdown {
  service:    string;
  tx_count:   number;
  revenue_ex: number;
  pct:        number;
}

export interface AestheticsSalesTotals {
  revenue_ex:    number;
  revenue_inc:   number;
  vat_amount:    number;
  tx_count:      number;
  last_synced:   string | null;
}

export interface UseAestheticsSalesResult {
  rows:          AestheticsSaleRow[];
  byPerson:      PersonBreakdown[];
  byService:     ServiceBreakdown[];
  totals:        AestheticsSalesTotals;
  isFetching:    boolean;
  isSyncing:     boolean;
  syncError:     string | null;
  missingMonths: string[];
  triggerSync:   () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toMonthStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthsInRange(dateFrom: Date, dateTo: Date): string[] {
  const months: string[] = [];
  const d = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1);
  const end = new Date(dateTo.getFullYear(), dateTo.getMonth(), 1);
  while (d <= end) {
    months.push(toMonthStr(d));
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useAestheticsSales(dateFrom: Date, dateTo: Date): UseAestheticsSalesResult {
  const supabase      = createClient();
  const queryClient   = useQueryClient();
  const lastFiredRef  = useRef("");

  const fromMonth   = toMonthStr(new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1));
  const toMonth     = toMonthStr(new Date(dateTo.getFullYear(),   dateTo.getMonth(),   1));
  const fromDateStr = toDateStr(dateFrom);
  const toDateStr_  = toDateStr(dateTo);

  // ── 1. Fetch rows ────────────────────────────────────────────────────────────
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["aesthetics-sales", fromDateStr, toDateStr_],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("aesthetics_sales_daily")
        .select("*")
        .gte("month", fromMonth)
        .lte("month", toMonth)
        .order("date_of_service", { ascending: true });
      if (error) throw error;
      const all = (data ?? []) as AestheticsSaleRow[];
      return all.filter(r =>
        !r.date_of_service ||
        (r.date_of_service >= fromDateStr && r.date_of_service <= toDateStr_)
      );
    },
    staleTime: 0,
  });

  // ── 2. Sync mutation ─────────────────────────────────────────────────────────
  const syncMutation = useMutation({
    mutationFn: async ({
      syncFrom,
      syncTo,
    }: {
      syncFrom?: Date;
      syncTo?: Date;
    } = {}) => {
      const res = await fetch("/api/etl/aesthetics-sales", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          date_from: toDateStr(syncFrom ?? dateFrom),
          date_to:   toDateStr(syncTo   ?? dateTo),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      return json;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["aesthetics-sales", fromDateStr, toDateStr_] });
      return data;
    },
  });

  // ── 3. Missing months + auto-refresh logic ────────────────────────────────
  const allMonths     = monthsInRange(dateFrom, dateTo);
  const presentMonths = new Set(rows.map((r: AestheticsSaleRow) => r.month));
  const missingMonths = allMonths.filter(m => !presentMonths.has(m));

  const autoRefreshFiredRef = useRef(false);
  const today          = new Date();
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const curMonthEnd    = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const curMonthStr    = toMonthStr(new Date(today.getFullYear(), today.getMonth(), 1));
  const prevMonthStr   = toMonthStr(prevMonthStart);
  const recentInRange  = !isFetching && (
    (curMonthStr  >= fromMonth && curMonthStr  <= toMonth) ||
    (prevMonthStr >= fromMonth && prevMonthStr <= toMonth)
  );

  const missingKey = missingMonths.join(",");
  if (!isFetching && !syncMutation.isPending) {
    if (missingMonths.length > 0 && missingKey !== lastFiredRef.current) {
      lastFiredRef.current = missingKey;
      setTimeout(() => syncMutation.mutate({}), 0);
    } else if (recentInRange && !autoRefreshFiredRef.current) {
      autoRefreshFiredRef.current = true;
      setTimeout(() => syncMutation.mutate({ syncFrom: prevMonthStart, syncTo: curMonthEnd }), 0);
    }
  }

  // ── 3. Aggregations ──────────────────────────────────────────────────────────

  const byPerson = useMemo<PersonBreakdown[]>(() => {
    const map = new Map<string, PersonBreakdown>();
    for (const r of rows) {
      const raw    = r.note_person?.trim() ?? "(Unassigned)";
      const key    = raw.toLowerCase();
      const label  = raw === "(Unassigned)" ? raw : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      const rate   = r.vat_rate ?? 0.18;
      const ex     = r.price_ex_vat  ?? 0;
      const inc    = r.price_inc_vat ?? 0;
      if (!map.has(key)) {
        map.set(key, { person: label, vat_rate: rate, tx_count: 0, revenue_ex: 0, revenue_inc: 0, vat_amount: 0 });
      }
      const agg = map.get(key)!;
      agg.tx_count++;
      agg.revenue_ex  += ex;
      agg.revenue_inc += inc;
      agg.vat_amount  += inc - ex;
    }
    return Array.from(map.values())
      .map(p => ({ ...p, revenue_ex: Math.round(p.revenue_ex), revenue_inc: Math.round(p.revenue_inc), vat_amount: Math.round(p.vat_amount) }))
      .sort((a, b) => b.revenue_ex - a.revenue_ex);
  }, [rows]);

  const byService = useMemo<ServiceBreakdown[]>(() => {
    // Ordered longest-match first so "lip filler" beats "filler", etc.
    const CANONICAL: [RegExp, string][] = [
      [/fat\s*dissolv/i,             "Fat Dissolving"],
      [/hair\s*reg/i,                "Hair Regrowth"],
      [/chem\w*\s*peel/i,            "Chemical Peel"],
      [/lip\s*fill/i,                "Lip Filler"],
      [/lip\s*fl[io]p/i,             "Lip Flip"],
      [/lip[s]?\s*(?:and\s*)?glow/i, "Lip Glow"],
      [/glow\s*lift/i,               "Glow Lift"],
      [/salmon/i,                    "Salmon DNA"],
      [/no[\s-]*show/i,              "No Show"],
      [/cancel/i,                    "Cancellation Fee"],
      [/consult/i,                   "Consultation"],
      [/skin\s*boost/i,              "Skinbooster"],
      [/exosome/i,                   "Exosomes"],
      [/micro\s*need|microneeld/i,   "Microneedling"],
      [/hydra\w*fac|hyfra\w*fac/i,   "Hydrafacial"],
      [/\bthread/i,                  "Thread"],
      [/\blhr\b/i,                   "LHR"],
      [/\bfill/i,                    "Filler"],
      [/\bbotox\b/i,                 "Botox"],
      [/prp/i,                       "PRP"],
      [/radiess?e/i,                 "Radiesse"],
      [/jaw\s*li?n/i,                "Jawline"],
      [/\bmeso\b|mesotherapy/i,      "Mesotherapy"],
      [/profhilo/i,                  "Profhilo"],
      [/\bameela\b/i,                "Ameela"],
      [/sculptra/i,                  "Sculptra"],
      [/\bnir\b/i,                   "NIR"],
      [/\blaser\b/i,                 "Laser"],
      [/membership/i,                "Membership"],
      [/facelift/i,                  "Facelift"],
      [/collagen/i,                  "Collagen"],
      [/ultimate/i,                  "Ultimate"],
    ];

    function matchCanonical(s: string): string | null {
      for (const [re, name] of CANONICAL) if (re.test(s)) return name;
      return null;
    }

    function canonicalize(raw: string): string {
      if (raw === "(Unspecified)") return "(Unspecified)";
      const cleaned = raw
        .replace(/\s*[-–]?\s*order[:\s]+[\w]+/gi, "") // strip order refs
        .replace(/\([^)]*\)/g, "")                     // strip parentheticals
        .replace(/\s+/g, " ")
        .trim();
      if (!cleaned) return "(Unspecified)";
      const isPackage = /pack/i.test(cleaned);
      const parts = cleaned.split(/\s*\+\s*/).flatMap(part => {
        const p = part.trim().replace(/^\d+\s*/, "");  // strip leading "2prp" → "prp"
        const m1 = matchCanonical(p);
        if (m1) return [m1];
        // Fallback: strip discount/staff modifiers after " - " and retry
        const base = p.split(/\s+-\s+/)[0].trim();
        const m2 = matchCanonical(base);
        if (m2) return [m2];
        return p.length > 1 ? [p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()] : [];
      });
      if (parts.length === 0) return "(Unspecified)";
      const base = [...new Set(parts)].sort().join(" + "); // sort so "A+B" === "B+A"
      return isPackage && !base.toLowerCase().includes("package")
        ? `${base} - Package`
        : base;
    }

    // Levenshtein distance for fuzzy post-merge
    function lev(a: string, b: string): number {
      const m = a.length, n = b.length;
      const row = Array.from({length: n + 1}, (_, i) => i);
      for (let i = 1; i <= m; i++) {
        let prev = i;
        for (let j = 1; j <= n; j++) {
          const tmp = a[i-1] === b[j-1] ? row[j-1] : 1 + Math.min(prev, row[j], row[j-1]);
          row[j-1] = prev;
          prev = tmp;
        }
        row[n] = prev;
      }
      return row[n];
    }

    const map      = new Map<string, { tx_count: number; revenue_ex: number }>();
    const labelMap = new Map<string, string>();
    for (const r of rows) {
      const raw   = r.service_product?.trim() || "(Unspecified)";
      const label = canonicalize(raw);
      const key   = label.toLowerCase();
      if (!labelMap.has(key)) labelMap.set(key, label);
      if (!map.has(key)) map.set(key, { tx_count: 0, revenue_ex: 0 });
      const agg = map.get(key)!;
      agg.tx_count++;
      agg.revenue_ex += r.price_ex_vat ?? 0;
    }

    // Fuzzy post-merge: collapse near-identical canonical names
    // (catches anything the pattern map missed)
    const keys = [...map.keys()];
    for (let i = 0; i < keys.length; i++) {
      if (!map.has(keys[i])) continue;
      for (let j = i + 1; j < keys.length; j++) {
        if (!map.has(keys[j])) continue;
        const a = keys[i], b = keys[j];
        // Skip if length difference alone rules out a match
        if (Math.abs(a.length - b.length) > 3) continue;
        const threshold = Math.min(2, Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.2)));
        if (lev(a, b) <= threshold) {
          const va = map.get(a)!, vb = map.get(b)!;
          const [keep, drop] = va.revenue_ex >= vb.revenue_ex ? [a, b] : [b, a];
          map.get(keep)!.tx_count   += map.get(drop)!.tx_count;
          map.get(keep)!.revenue_ex += map.get(drop)!.revenue_ex;
          map.delete(drop);
          labelMap.delete(drop);
        }
      }
    }
    const totalEx = Array.from(map.values()).reduce((s, v) => s + v.revenue_ex, 0) || 1;
    return Array.from(map.entries())
      .map(([key, v]) => ({
        service:    labelMap.get(key) ?? key,
        tx_count:   v.tx_count,
        revenue_ex: Math.round(v.revenue_ex),
        pct:        Math.round((v.revenue_ex / totalEx) * 1000) / 10,
      }))
      .sort((a, b) => b.revenue_ex - a.revenue_ex);
  }, [rows]);

  const totals = useMemo<AestheticsSalesTotals>(() => {
    const ex  = rows.reduce((s, r) => s + (r.price_ex_vat  ?? 0), 0);
    const inc = rows.reduce((s, r) => s + (r.price_inc_vat ?? 0), 0);
    const last = rows.reduce((best, r) => {
      if (!r.synced_at) return best;
      return (!best || r.synced_at > best) ? r.synced_at : best;
    }, null as string | null);
    return {
      revenue_ex:  Math.round(ex),
      revenue_inc: Math.round(inc),
      vat_amount:  Math.round(inc - ex),
      tx_count:    rows.length,
      last_synced: last,
    };
  }, [rows]);

  return {
    rows,
    byPerson,
    byService,
    totals,
    isFetching,
    isSyncing:     syncMutation.isPending,
    syncError:     syncMutation.error ? (syncMutation.error as Error).message : null,
    syncLog:       (syncMutation.data as { log?: string[] } | undefined)?.log ?? null,
    missingMonths,
    triggerSync:   () => syncMutation.mutate({}),
  };
}
