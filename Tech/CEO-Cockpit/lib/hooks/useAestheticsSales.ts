"use client";

import { useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/supabase/fetch-all";

// ── Fuzzy cash classification ─────────────────────────────────────────────────

function levDist(a: string, b: string): number {
  const m = a.length, n = b.length;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const tmp = a[i - 1] === b[j - 1] ? row[j - 1] : 1 + Math.min(prev, row[j], row[j - 1]);
      row[j - 1] = prev;
      prev = tmp;
    }
    row[n] = prev;
  }
  return row[n];
}

/**
 * Classifies a raw payment method string as "Cash" or "Non-Cash".
 * Uses word-boundary regex first, then Levenshtein (≤1 edit) for single short words
 * to catch typos ("cas", "cassh", "cahs"). Multi-word strings and "(Unspecified)"
 * are conservatively treated as "Non-Cash".
 */
export function categorizeCash(raw: string): "Cash" | "Non-Cash" {
  const clean = (raw ?? "").toLowerCase().trim();
  if (!clean || clean === "(unspecified)") return "Non-Cash";
  if (/\bcash\b/.test(clean)) return "Cash";
  // Fuzzy only for single short words — prevents "card" (dist 2) from matching
  const letters = clean.replace(/[^a-z]/g, "");
  if (!/ /.test(clean) && letters.length >= 3 && letters.length <= 6) {
    if (levDist(letters, "cash") <= 1) return "Cash";
  }
  return "Non-Cash";
}

/**
 * Maps a canonical service/product name to the Carisma Aesthetics website nav
 * category (https://www.carismaaesthetics.com). Rules are ordered from most
 * specific to most general. Body LHR is checked before Packages so that
 * "LHR - Package" stays in Body rather than being re-classified.
 *
 * Returns { group, category } where group is the top-level nav section
 * (Face | Body | Packages | Membership | Consultation | Admin | Other)
 * and category is the sub-nav item (e.g. "Wrinkle-Relaxing", "Hydrafacial").
 */
export function categorizeNavService(service: string): { group: string; category: string } {
  const s = service.toLowerCase();

  // ── Admin items (no-shows, cancellations, deposits) ───────────────────────
  if (/\bno.?show\b|\bcancel\b|\bdeposit\b|\brefund\b/i.test(s))
    return { group: "Admin", category: "Admin" };

  // ── Membership / Consultation ─────────────────────────────────────────────
  if (/\bmembership\b/i.test(s))    return { group: "Membership",   category: "Membership"   };
  if (/\bconsult\b/i.test(s))       return { group: "Consultation", category: "Consultation" };
  if (/\bgift\b|\bvoucher\b/i.test(s)) return { group: "Admin",    category: "Gift / Voucher" };

  // ── Body — LHR first so "LHR - Package" stays in Body ────────────────────
  if (/\blhr\b|\blaser.?hair\b|\bhair.?remov/i.test(s))
    return { group: "Body", category: "Laser Hair Removal" };

  // ── Body — other body treatments ─────────────────────────────────────────
  if (/\bnir\b|\bskin.?tight|\bfat.?freez|\banti.?cellu|\blymph|\bpico/i.test(s))
    return { group: "Body", category: "Body Treatment" };

  // ── Packages (named bundles, "Ultimate", "Glow Lift", etc.) ──────────────
  if (/\bpackage\b|\bultimate\b|\bglow.?lift\b|\bsnatch\b|\b4.?in.?1\b/i.test(s))
    return { group: "Packages", category: "Packages" };

  // ── Face — specific categories, most distinctive first ───────────────────
  if (/\blip\b/i.test(s))
    return { group: "Face", category: "Lip Treatments" };
  if (/\bhydra\w*fac|\bhyfra/i.test(s))
    return { group: "Face", category: "Hydrafacial" };
  if (/\bprp\b|\bplatelet\b|\bvampire\b/i.test(s))
    return { group: "Face", category: "PRP" };
  if (/\bsalmon\b|\bpolynucleotides?\b|\bpnct\b/i.test(s))
    return { group: "Face", category: "Polynucleotides" };
  if (/\bhair.?reg/i.test(s))
    return { group: "Face", category: "Hair Regrowth" };
  if (/\bprofhilo\b/i.test(s))
    return { group: "Face", category: "Profhilo" };
  if (/\bexosome\b|\bmicro/i.test(s))       // catches "Microneedling", "Micronedd" typo, "Microneeld"
    return { group: "Face", category: "Microneedling & Skin" };
  if (/\bchem\w*.peel|\bpeel\b/i.test(s))
    return { group: "Face", category: "Chemical Peel" };
  if (/\bmeso\w*/i.test(s))
    return { group: "Face", category: "Mesotherapy" };
  if (/\bthread\b/i.test(s))
    return { group: "Face", category: "Thread Lift" };
  if (/\bfat.?dis/i.test(s))
    return { group: "Face", category: "Fat Dissolving" };
  if (/\bfiller\b|\bradiess?e\b|\bsculptra\b|\bameela?\b|\bskinboost|\bjaw\s*li?n|\bcollagen\b/i.test(s))
    return { group: "Face", category: "Fillers & Contouring" };
  if (/\bbotox\b|\btoxin\b|\bwrinkle\b/i.test(s))
    return { group: "Face", category: "Wrinkle-Relaxing" };

  return { group: "Other", category: "Other" };
}

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
  service:      string;
  nav_group:    string;
  nav_category: string;
  tx_count:     number;
  revenue_ex:   number;
  pct:          number;
}

export interface PaymentMethodBreakdown {
  method:     string;
  category:   "Cash" | "Non-Cash";
  tx_count:   number;
  revenue_ex: number;
  pct:        number;
}

export interface CashTypeBreakdown {
  category:   "Cash" | "Non-Cash";
  tx_count:   number;
  revenue_ex: number;
  pct:        number;
  methods:    string[];  // raw method labels that mapped to this category
}

export interface AestheticsSalesTotals {
  revenue_ex:    number;
  revenue_inc:   number;
  vat_amount:    number;
  tx_count:      number;
  last_synced:   string | null;
}

export interface UseAestheticsSalesResult {
  rows:             AestheticsSaleRow[];
  byPerson:         PersonBreakdown[];
  byService:        ServiceBreakdown[];
  byPaymentMethod:  PaymentMethodBreakdown[];
  byCashType:       CashTypeBreakdown[];
  totals:           AestheticsSalesTotals;
  isFetching:       boolean;
  isSyncing:        boolean;
  syncError:        string | null;
  syncLog:          string[] | null;
  missingMonths:    string[];
  triggerSync:      () => void;
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

export function useAestheticsSales(dateFrom: Date, dateTo: Date, { skipSync = false } = {}): UseAestheticsSalesResult {
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
      const all = await fetchAll(
        (off, lim) =>
          supabase
            .from("aesthetics_sales_daily")
            .select("*")
            .gte("month", fromMonth)
            .lte("month", toMonth)
            .order("date_of_service", { ascending: true })
            .range(off, off + lim - 1),
        "aesthetics_sales_daily",
      ) as AestheticsSaleRow[];
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
  if (!skipSync && !isFetching && !syncMutation.isPending) {
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

    const map      = new Map<string, PersonBreakdown>();
    const labelMap = new Map<string, string>();
    for (const r of rows) {
      const raw   = r.note_person?.trim() ?? "(Unassigned)";
      const label = raw === "(Unassigned)" ? raw : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      const key   = raw.toLowerCase();
      const rate  = r.vat_rate ?? 0.18;
      const ex    = r.price_ex_vat  ?? 0;
      const inc   = r.price_inc_vat ?? 0;
      if (!labelMap.has(key)) labelMap.set(key, label);
      if (!map.has(key)) {
        map.set(key, { person: label, vat_rate: rate, tx_count: 0, revenue_ex: 0, revenue_inc: 0, vat_amount: 0 });
      }
      const agg = map.get(key)!;
      agg.tx_count++;
      agg.revenue_ex  += ex;
      agg.revenue_inc += inc;
      agg.vat_amount  += inc - ex;
    }

    // Fuzzy post-merge: collapse near-identical names (e.g. "giovani" vs "giovanni")
    const keys = [...map.keys()];
    for (let i = 0; i < keys.length; i++) {
      if (!map.has(keys[i])) continue;
      if (keys[i] === "(unassigned)") continue;
      for (let j = i + 1; j < keys.length; j++) {
        if (!map.has(keys[j])) continue;
        if (keys[j] === "(unassigned)") continue;
        const a = keys[i], b = keys[j];
        const minLen = Math.min(a.length, b.length);
        if (minLen < 5) continue;
        if (Math.abs(a.length - b.length) > 3) continue;
        const threshold = Math.min(2, Math.max(1, Math.floor(minLen * 0.2)));
        if (lev(a, b) <= threshold) {
          // Canonical = longer name; VAT rate = lower of the two
          const [keep, drop] = a.length >= b.length ? [a, b] : [b, a];
          const kv = map.get(keep)!, dv = map.get(drop)!;
          kv.tx_count   += dv.tx_count;
          kv.revenue_ex  += dv.revenue_ex;
          kv.revenue_inc += dv.revenue_inc;
          kv.vat_amount  += dv.vat_amount;
          kv.vat_rate     = Math.min(kv.vat_rate, dv.vat_rate);
          map.delete(drop);
          labelMap.delete(drop);
        }
      }
    }

    return Array.from(map.entries())
      .map(([key, p]) => ({
        ...p,
        person:      labelMap.get(key) ?? p.person,
        revenue_ex:  Math.round(p.revenue_ex),
        revenue_inc: Math.round(p.revenue_inc),
        vat_amount:  Math.round(p.vat_amount),
      }))
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
      const revEx = r.price_ex_vat ?? 0;
      // Split combo services (e.g. "Botox + Filler") into individual components
      // and distribute revenue equally. Package bundles (suffix "- Package") are kept whole.
      const isPackage  = /- package/i.test(label);
      const components = (!isPackage && label.includes(" + ")) ? label.split(" + ") : [label];
      const n          = components.length;
      for (const comp of components) {
        const cLabel = comp.trim();
        const key    = cLabel.toLowerCase();
        if (!labelMap.has(key)) labelMap.set(key, cLabel);
        if (!map.has(key)) map.set(key, { tx_count: 0, revenue_ex: 0 });
        const agg = map.get(key)!;
        agg.tx_count++;
        agg.revenue_ex += revEx / n;
      }
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
      .map(([key, v]) => {
        const service = labelMap.get(key) ?? key;
        const { group, category } = categorizeNavService(service);
        return {
          service,
          nav_group:    group,
          nav_category: category,
          tx_count:     v.tx_count,
          revenue_ex:   Math.round(v.revenue_ex),
          pct:          Math.round((v.revenue_ex / totalEx) * 1000) / 10,
        };
      })
      .sort((a, b) => b.revenue_ex - a.revenue_ex);
  }, [rows]);

  const byPaymentMethod = useMemo<PaymentMethodBreakdown[]>(() => {
    const map      = new Map<string, { tx_count: number; revenue_ex: number }>();
    const labelMap = new Map<string, string>();
    for (const r of rows) {
      const raw   = r.payment_method?.trim() || "(Unspecified)";
      const key   = raw.toLowerCase();
      if (!labelMap.has(key)) labelMap.set(key, raw);
      if (!map.has(key)) map.set(key, { tx_count: 0, revenue_ex: 0 });
      const agg = map.get(key)!;
      agg.tx_count++;
      agg.revenue_ex += r.price_ex_vat ?? 0;
    }
    const totalEx = Array.from(map.values()).reduce((s, v) => s + v.revenue_ex, 0) || 1;
    return Array.from(map.entries())
      .map(([key, v]) => {
        const method = labelMap.get(key) ?? key;
        return {
          method,
          category:   categorizeCash(method),
          tx_count:   v.tx_count,
          revenue_ex: Math.round(v.revenue_ex),
          pct:        Math.round((v.revenue_ex / totalEx) * 1000) / 10,
        };
      })
      .sort((a, b) => b.revenue_ex - a.revenue_ex);
  }, [rows]);

  const byCashType = useMemo<CashTypeBreakdown[]>(() => {
    const cashMap = new Map<"Cash" | "Non-Cash", { tx_count: number; revenue_ex: number; methods: Set<string> }>([
      ["Cash",     { tx_count: 0, revenue_ex: 0, methods: new Set() }],
      ["Non-Cash", { tx_count: 0, revenue_ex: 0, methods: new Set() }],
    ]);
    for (const r of rows) {
      const raw = r.payment_method?.trim() || "(Unspecified)";
      const cat = categorizeCash(raw);
      const agg = cashMap.get(cat)!;
      agg.tx_count++;
      agg.revenue_ex += r.price_ex_vat ?? 0;
      agg.methods.add(raw);
    }
    const totalEx = Array.from(cashMap.values()).reduce((s, v) => s + v.revenue_ex, 0) || 1;
    return (["Cash", "Non-Cash"] as const).map(cat => {
      const v = cashMap.get(cat)!;
      return {
        category:   cat,
        tx_count:   v.tx_count,
        revenue_ex: Math.round(v.revenue_ex),
        pct:        Math.round((v.revenue_ex / totalEx) * 1000) / 10,
        methods:    [...v.methods].sort(),
      };
    });
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
    byPaymentMethod,
    byCashType,
    totals,
    isFetching,
    isSyncing:     syncMutation.isPending,
    syncError:     syncMutation.error ? (syncMutation.error as Error).message : null,
    syncLog:       (syncMutation.data as { log?: string[] } | undefined)?.log ?? null,
    missingMonths,
    triggerSync:   () => syncMutation.mutate({}),
  };
}
