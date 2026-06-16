"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, X, Database, CheckCircle2, AlertCircle } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { TableSkeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/charts/config";
import { BRAND } from "@/lib/constants/design-tokens";
import { EbitdaSummaryHeader, SummaryData, SppyData } from "@/components/finance/EbitdaSummaryHeader";
import { PractitionerProductivityTable } from "@/components/finance/PractitionerProductivityTable";

// ── Venue config (matches the API) ───────────────────────────────────────────

const VENUE_CONFIG = [
  { slug: "intercontinental", label: "inter",     brand: "SPA"  },
  { slug: "hugos",            label: "hugos",     brand: "SPA"  },
  { slug: "hyatt",            label: "hyatt",     brand: "SPA"  },
  { slug: "ramla",            label: "ramla",     brand: "SPA"  },
  { slug: "labranda",         label: "Riviera",  brand: "SPA"  },
  { slug: "sunny_coast",      label: "Sunny Coast", brand: "SPA"  },
  { slug: "excelsior",        label: "excelsior", brand: "SPA"  },
  { slug: "novotel",          label: "novotel",   brand: "SPA"  },
  { slug: "aesthetics",       label: "Aesthetics",brand: "AES"  },
  { slug: "slimming",         label: "Slimming",  brand: "SLIM" },
  { slug: "hq",               label: "HQ",        brand: "HQ"   },
] as const;

type VenueSlug = typeof VENUE_CONFIG[number]["slug"];
const SPA_VENUES   = VENUE_CONFIG.filter(v => v.brand === "SPA").map(v => v.slug);
const WAGE_ROLES   = ["manager","reception","therapist","practitioner","crm","unassigned"] as const;
const AD_CHANNELS  = ["meta","google","klaviyo","misc"] as const;
const SGA_SUBS     = [
  "prof_services","fuel","laundry","software","cleaning",
  "travel","misc","insurance","events","maintenance","telecom",
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type VenueData = {
  revenue:        number;
  cockpit_revenue?: number;  // pure daily Cockpit sales (Spa only); used for revenue QC
  wages:          number;
  wage_by_role:   Record<string, number>;
  advertising:    number;
  ad_by_channel:  Record<string, number>;
  sga:            number;
  sga_by_sub:     Record<string, number>;
  cogs:           number;
  rent:           number;
  utilities:      number;
  ebitda:         number;
};

type V2Data = {
  date_from:         string;
  date_to:           string;
  days_in_period:    number;
  venues:            Record<string, VenueData>;
  group:             VenueData;
  fallback_applied:  Array<{ venue: string; ebitda_line: string; rule_type: string; value: number }>;
  warnings:          string[];
  zoho_raw_expenses: number;
};

type DrillContact = {
  contact: string; amount: number; share: number;
  role?: string; source: string; basis?: string;
  zoho_amount: number; supplement_amount: number;
};
type DrillTxn     = {
  txn_id: string; date: string; contact: string; account_code: string;
  account_name: string; txn_type: string; sub_line: string; amount: number; source: string;
};
type DrillRole    = { role: string; amount: number; share: number };
type DrillChannel = { channel: string; amount: number; share: number };
type FallbackBreakdownItem = {
  account_code:  string;
  account_name:  string;
  rule_type:     string;
  ttm_total:     number;
  ttm_months:    number;
  annualized:    number;
  monthly_avg:   number;
  days_in_period: number;
  value:         number;
  formula:       string;
};
type DrillData = {
  is_fallback:        boolean;
  fallback_note?:     string;
  fallback_breakdown?: FallbackBreakdownItem[];
  total:              number;
  contacts:           DrillContact[];
  transactions:       DrillTxn[];
  wage_roles:         DrillRole[];
  ad_channels:        DrillChannel[];
};

type DrillTarget = {
  venue:      string;
  venueLabel: string;
  line:       string;
  subLine?:   string;
  wageRole?:  string;   // filters contacts/transactions to this wage role
  adChannel?: string;   // filters contacts/transactions to this ad channel
  label:      string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtC(v: number): string {
  if (v === 0) return "—";
  const abs = Math.abs(v);
  if (abs >= 1000) return `€${(v / 1000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function pctOf(part: number, whole: number): string {
  if (whole === 0) return "";
  return ` · ${Math.round((part / whole) * 100)}%`;
}

function ebitdaBadge(ep: number) {
  const cls = ep >= 20 ? "bg-emerald-100 text-emerald-800"
            : ep >= 10 ? "bg-amber-100 text-amber-800"
            : "bg-red-100 text-red-800";
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{Math.round(ep)}%</span>;
}

function sourceTag(source: string) {
  const map: Record<string, { label: string; cls: string }> = {
    zoho:         { label: "Zoho",         cls: "bg-blue-100 text-blue-700" },
    google_sheet: { label: "Sheet",        cls: "bg-green-100 text-green-700" },
    fallback:     { label: "Fallback",     cls: "bg-amber-100 text-amber-700" },
    hardwired:    { label: "Hardwired",    cls: "bg-purple-100 text-purple-700" },
  };
  const { label, cls } = map[source] ?? { label: source, cls: "bg-muted text-muted-foreground" };
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

function emptyVenue(): VenueData {
  return {
    revenue: 0, wages: 0, wage_by_role: {}, advertising: 0, ad_by_channel: {},
    sga: 0, sga_by_sub: {}, cogs: 0, rent: 0, utilities: 0, ebitda: 0,
  };
}

// ── Drill-down dialog ─────────────────────────────────────────────────────────

function DrillDialog({
  target, dateFrom, dateTo, onClose,
}: {
  target:   DrillTarget;
  dateFrom: string;
  dateTo:   string;
  onClose:  () => void;
}) {
  const [tab, setTab]         = useState<"contact" | "transactions">("contact");
  const [data, setData]       = useState<DrillData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null); setData(null);
    const controller = new AbortController();
    const qs = new URLSearchParams({ venue: target.venue, ebitda_line: target.line, date_from: dateFrom, date_to: dateTo });
    if (target.subLine)   qs.set("ebitda_sub_line", target.subLine);
    if (target.wageRole)  qs.set("wage_role",        target.wageRole);
    if (target.adChannel) qs.set("ad_channel",       target.adChannel);
    fetch(`/api/finance/ebitda-v2/drill?${qs}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { if (e.name !== "AbortError") { setError(String(e)); setLoading(false); } });
    return () => controller.abort();
  }, [target, dateFrom, dateTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isWages = target.line === "wages";
  const isAdv   = target.line === "advertising";

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl h-full bg-background shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b shrink-0">
          <div>
            <p className="text-xs text-muted-foreground capitalize">{target.venueLabel}</p>
            <h2 className="font-semibold text-sm">{target.label}</h2>
            <p className="text-xs text-muted-foreground">{dateFrom} → {dateTo}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted mt-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        {!data?.is_fallback && (
          <div className="flex border-b shrink-0">
            {(["contact", "transactions"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
                  ${tab === t
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t === "contact" ? (isWages ? "By Employee" : "By Contact") : "Transactions"}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
          {loading && <TableSkeleton rows={8} columns={4} />}
          {error   && <p className="text-destructive text-sm">{error}</p>}

          {/* Hardwired rule — no employee breakdown possible */}
          {data?.is_fallback && data.fallback_note && !data.fallback_breakdown && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              <p className="font-medium mb-1">No breakdown available</p>
              <p>{data.fallback_note}</p>
            </div>
          )}

          {/* Fallback estimate — show calculation basis */}
          {data?.is_fallback && (data.fallback_breakdown?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-3">
                Estimated total:{" "}
                <span className="font-semibold text-foreground">{formatCurrency(data.total)}</span>
                <span className="ml-2">{dateFrom} – {dateTo} ({data.fallback_breakdown![0].days_in_period} days)</span>
              </p>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Calculation Basis
              </p>
              <div className="rounded-lg border overflow-hidden text-xs">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Account</th>
                      <th className="text-left px-3 py-2 font-medium">Method</th>
                      <th className="text-right px-3 py-2 font-medium">Basis</th>
                      <th className="text-right px-3 py-2 font-medium">Monthly</th>
                      <th className="text-right px-3 py-2 font-medium text-foreground">Estimated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.fallback_breakdown!.map(row => (
                      <tr key={row.account_code} className="border-t">
                        <td className="px-3 py-2">
                          <span className="font-medium">{row.account_name}</span>
                          <span className="ml-1.5 text-muted-foreground">{row.account_code}</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground capitalize">
                          {row.rule_type.replace(/_/g, " ")}
                          {row.rule_type === "ttm_spread" && (
                            <span className="ml-1">({row.ttm_months}mo)</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.ttm_total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCurrency(row.monthly_avg)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t bg-muted/30">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 font-medium">Total estimate</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(data.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="mt-3 space-y-1">
                {data.fallback_breakdown!.map(row => (
                  <p key={row.account_code} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{row.account_name}:</span>{" "}
                    {row.formula}
                  </p>
                ))}
              </div>
            </div>
          )}

          {data && !data.is_fallback && (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Total: <span className="font-semibold text-foreground">{formatCurrency(data.total)}</span>
                <span className="ml-2 text-xs">{dateFrom} – {dateTo}</span>
              </p>

              {/* By Contact / By Employee */}
              {tab === "contact" && (
                <div className="space-y-5">
                  {isWages && (data.wage_roles?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">By Role</p>
                      <table className="w-full text-sm">
                        <tbody>
                          {data.wage_roles.map(r => (
                            <tr key={r.role} className="border-b last:border-0">
                              <td className="py-1.5 pr-3 capitalize font-medium">{r.role}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(r.amount)}</td>
                              <td className="py-1.5 text-right text-xs text-muted-foreground">{r.share}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {isAdv && (data.ad_channels?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">By Channel</p>
                      <table className="w-full text-sm">
                        <tbody>
                          {data.ad_channels.map(c => (
                            <tr key={c.channel} className="border-b last:border-0">
                              <td className="py-1.5 pr-3 capitalize font-medium">{c.channel}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(c.amount)}</td>
                              <td className="py-1.5 text-right text-xs text-muted-foreground">{c.share}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      By {isWages ? "Employee" : "Contact"}
                    </p>
                    {data.contacts.length === 0
                      ? <p className="text-xs text-muted-foreground">No data.</p>
                      : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b">
                              <th className="text-left py-1.5 pr-2">{isWages ? "Employee" : "Contact"}</th>
                              {isWages && <th className="text-left py-1.5 pr-2">Role</th>}
                              <th className="text-left py-1.5 pr-2">Source</th>
                              <th className="text-left py-1.5 pr-2">Basis</th>
                              <th className="text-right py-1.5 pr-2">Amount</th>
                              <th className="text-right py-1.5">%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.contacts.map(c => {
                              const srcCls =
                                c.source === "salary_supplement" ? "bg-purple-100 text-purple-700" :
                                c.source === "both"              ? "bg-indigo-100 text-indigo-700" :
                                "bg-blue-100 text-blue-700";
                              const srcLabel =
                                c.source === "salary_supplement" ? "Supplement" :
                                c.source === "both"              ? "Zoho + Suppl." :
                                "Zoho";
                              const basisCls =
                                (c.basis ?? "").includes("split") || (c.basis ?? "").includes("Split")
                                  ? "bg-amber-100 text-amber-700"
                                  : (c.basis ?? "") === "Tag"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-muted text-muted-foreground";
                              return (
                                <tr key={c.contact} className="border-b last:border-0 hover:bg-muted/20">
                                  <td className="py-1.5 pr-2 font-medium">{c.contact}</td>
                                  {isWages && (
                                    <td className="py-1.5 pr-2 capitalize text-muted-foreground">
                                      {c.role ?? "—"}
                                    </td>
                                  )}
                                  <td className="py-1.5 pr-2">
                                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${srcCls}`}>
                                      {srcLabel}
                                    </span>
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${basisCls}`}>
                                      {c.basis ?? "—"}
                                    </span>
                                  </td>
                                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatCurrency(c.amount)}</td>
                                  <td className="py-1.5 text-right text-muted-foreground">{c.share}%</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                  </div>
                </div>
              )}

              {/* Transactions */}
              {tab === "transactions" && (
                data.transactions.length === 0
                  ? <p className="text-xs text-muted-foreground">No transactions found.</p>
                  : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b">
                          <th className="text-left py-1.5 pr-2 whitespace-nowrap">Date</th>
                          <th className="text-left py-1.5 pr-2">Contact</th>
                          <th className="text-left py-1.5 pr-2">Account</th>
                          <th className="text-right py-1.5 pr-2">Amount</th>
                          <th className="text-center py-1.5">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.transactions.map((t, i) => (
                          <tr key={`${t.txn_id}-${i}`} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="py-1.5 pr-2 text-muted-foreground whitespace-nowrap">{t.date}</td>
                            <td className="py-1.5 pr-2 max-w-[110px] truncate font-medium" title={t.contact}>{t.contact}</td>
                            <td className="py-1.5 pr-2 text-muted-foreground max-w-[110px] truncate" title={t.account_name}>
                              {t.account_code} {t.account_name}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{formatCurrency(t.amount)}</td>
                            <td className="py-1.5 text-center">{sourceTag(t.source)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Period label from ISO date strings ────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtPeriodLabel(fromStr: string, toStr: string): string {
  const [fy, fm] = fromStr.split("-").map(Number);
  const [ty, tm] = toStr.split("-").map(Number);
  const f = `${MONTHS[fm-1]} '${String(fy).slice(2)}`;
  const t = `${MONTHS[tm-1]} '${String(ty).slice(2)}`;
  return fy === ty && fm === tm ? f : `${f} – ${t}`;
}

// ── Inner content (receives dateFrom/dateTo from DashboardShell) ──────────────

function EbitdaV2Content({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const dfStr = toIso(dateFrom);
  const dtStr = toIso(dateTo);

  const [data, setData]         = useState<V2Data | null>(null);
  const [sppyData, setSppyData] = useState<V2Data | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [spaCollapsed, setSpaCollapsed] = useState(false);
  const [wagesOpen, setWagesOpen]       = useState(true);
  const [advOpen, setAdvOpen]           = useState(true);
  const [sgaOpen, setSgaOpen]           = useState(false);
  const [rentOpen, setRentOpen]         = useState(false);
  const [drill, setDrill]               = useState<DrillTarget | null>(null);

  useEffect(() => {
    setLoading(true); setError(null); setData(null); setSppyData(null);
    const controller = new AbortController();
    const qs     = new URLSearchParams({ date_from: dfStr,                       date_to: dtStr });
    const sppyQs = new URLSearchParams({ date_from: dfStr.slice(0,4-0).replace(/^(\d{4})/, y => String(+y-1)),
                                         date_to:   dtStr.replace(/^(\d{4})/, y => String(+y-1)) });
    Promise.all([
      fetch(`/api/finance/ebitda-v2?${qs}`,     { signal: controller.signal }).then(r => r.json()),
      fetch(`/api/finance/ebitda-v2?${sppyQs}`, { signal: controller.signal }).then(r => r.json()).catch(() => null),
    ])
      .then(([d, s]) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        setSppyData(s?.error ? null : (s ?? null));
        setLoading(false);
      })
      .catch(e => { if (e.name !== "AbortError") { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => controller.abort();
  }, [dfStr, dtStr]);

  const displayedVenues = useMemo(() => {
    if (spaCollapsed) {
      return [
        { slug: "__spa__",     label: "Spa",        brand: "SPA"  },
        { slug: "aesthetics",  label: "Aesthetics", brand: "AES"  },
        { slug: "slimming",    label: "Slimming",   brand: "SLIM" },
        { slug: "hq",          label: "HQ",         brand: "HQ"   },
      ];
    }
    return VENUE_CONFIG.map(v => ({ ...v }));
  }, [spaCollapsed]);

  const spaAggregate = useMemo((): VenueData => {
    if (!data) return emptyVenue();
    const acc = emptyVenue();
    for (const slug of SPA_VENUES) {
      const v = data.venues[slug] ?? emptyVenue();
      acc.revenue                  += v.revenue;
      acc.cockpit_revenue             = (acc.cockpit_revenue ?? 0) + (v.cockpit_revenue ?? 0);
      acc.wages                    += v.wages;
      acc.advertising              += v.advertising;
      acc.sga                      += v.sga;
      acc.cogs                     += v.cogs;
      acc.rent                     += v.rent;
      acc.utilities                += v.utilities;
      acc.ebitda                   += v.ebitda;
      for (const r of WAGE_ROLES)  acc.wage_by_role[r]  = (acc.wage_by_role[r]  ?? 0) + (v.wage_by_role[r]  ?? 0);
      for (const c of AD_CHANNELS) acc.ad_by_channel[c] = (acc.ad_by_channel[c] ?? 0) + (v.ad_by_channel[c] ?? 0);
      for (const s of SGA_SUBS)    acc.sga_by_sub[s]    = (acc.sga_by_sub[s]    ?? 0) + (v.sga_by_sub[s]    ?? 0);
    }
    return acc;
  }, [data]);

  const summaryData: SummaryData | null = useMemo(() => {
    if (!data) return null;
    const spa   = spaAggregate;
    const aes   = data.venues["aesthetics"] ?? emptyVenue();
    const slim  = data.venues["slimming"]   ?? emptyVenue();
    const group = data.group;
    const periodLabel = fmtPeriodLabel(dfStr, dtStr);

    let sppy: SppyData | null = null;
    if (sppyData) {
      const sppySpa = SPA_VENUES.reduce((acc, slug) => {
        const v = sppyData.venues[slug] ?? emptyVenue();
        acc.revenue += v.revenue; acc.ebitda += v.ebitda; return acc;
      }, { revenue: 0, ebitda: 0 });
      sppy = {
        groupRevenue: sppyData.group.revenue,
        groupEbitda:  sppyData.group.ebitda,
        spaRevenue:   sppySpa.revenue,
        spaEbitda:    sppySpa.ebitda,
        aesRevenue:   (sppyData.venues["aesthetics"] ?? emptyVenue()).revenue,
        aesEbitda:    (sppyData.venues["aesthetics"] ?? emptyVenue()).ebitda,
        slimRevenue:  (sppyData.venues["slimming"]   ?? emptyVenue()).revenue,
        slimEbitda:   (sppyData.venues["slimming"]   ?? emptyVenue()).ebitda,
      };
    }

    return {
      groupRevenue:    group.revenue,
      groupEbitda:     group.ebitda,
      spaRevenue:      spa.revenue,
      spaEbitda:       spa.ebitda,
      spaCockpitRevenue: spa.cockpit_revenue ?? 0,
      aesRevenue:      aes.revenue,
      aesEbitda:       aes.ebitda,
      slimRevenue:     slim.revenue,
      slimEbitda:      slim.ebitda,
      periodLabel,
      sppy,
    };
  }, [data, spaAggregate, sppyData]);

  function vd(slug: string): VenueData {
    if (!data) return emptyVenue();
    if (slug === "__spa__") return spaAggregate;
    return data.venues[slug] ?? emptyVenue();
  }

  type DrillOpts = { subLine?: string; wageRole?: string; adChannel?: string };

  function openDrill(slug: string, label: string, line: string, displayLabel: string, opts: DrillOpts = {}) {
    if (slug === "__spa__") return;
    setDrill({ venue: slug, venueLabel: label, line, label: displayLabel, ...opts });
  }

  function cellCls(slug: string, extra = ""): string {
    const drillable = slug !== "__spa__";
    return `text-right tabular-nums px-2 py-1.5 text-xs
      ${drillable ? "cursor-pointer hover:bg-amber-50 hover:ring-1 hover:ring-inset hover:ring-amber-300 rounded transition-colors" : ""}
      ${extra}`;
  }

  function cellClick(slug: string, label: string, line: string, display: string, opts: DrillOpts = {}) {
    return slug !== "__spa__" ? () => openDrill(slug, label, line, display, opts) : undefined;
  }

  const cols = displayedVenues;

  return (
    <div className="space-y-4">
      <EbitdaSummaryHeader data={summaryData} loading={loading} />

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={() => setSpaCollapsed(v => !v)}
          className="text-xs border rounded px-2 py-1 flex items-center gap-1 hover:bg-muted transition-colors">
          {spaCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {spaCollapsed ? "Expand Spa (8)" : "Collapse Spa (8)"}
        </button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
          <Database className="h-3 w-3" />Supabase · 2026
        </span>
      </div>

      {loading && <TableSkeleton rows={12} columns={8} className="py-2" />}
      {error   && <p className="text-sm text-destructive py-4">{error}</p>}

      {data && (
        <>
          {/* Cost Reconciliation QC — compares EBITDA-mapped costs vs raw Zoho Books total */}
          {(() => {
            const ebitdaCosts = data.group.wages + data.group.advertising + data.group.sga
              + data.group.cogs + data.group.rent + data.group.utilities;
            const zohoCosts = data.zoho_raw_expenses ?? 0;
            const delta = ebitdaCosts - zohoCosts;
            const matched = delta >= -100; // ±€100 rounding tolerance
            return (
              <div className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${matched ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="flex items-center gap-2 shrink-0">
                  {matched
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    : <AlertCircle  className="h-4 w-4 text-amber-600" />}
                  <span className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Cost QC</span>
                </div>
                <div className="h-4 w-px bg-border hidden sm:block" />
                <div className="flex flex-wrap gap-4 text-xs">
                  <span>
                    <span className="text-muted-foreground">EBITDA Total Costs:</span>{" "}
                    <span className="font-mono font-bold">{fmtC(ebitdaCosts)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Zoho Books Raw:</span>{" "}
                    <span className="font-mono font-bold">{fmtC(zohoCosts)}</span>
                  </span>
                  <span className={`font-semibold ${matched ? "text-emerald-700" : "text-amber-700"}`}>
                    Δ {delta >= 0 ? "+" : ""}{fmtC(delta)}
                    {matched ? " · Reconciled ✓" : " · Costs may be missing ⚠"}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* P&L Table */}
          <div className="overflow-x-auto rounded border bg-card">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground sticky left-0 bg-muted/40 min-w-[130px]">
                    LINE ITEM
                  </th>
                  {cols.map(vc => {
                    // Brand column headers use the canonical Carisma brand colors.
                    const brandColor =
                      vc.brand === "SPA"  ? BRAND.spa.dark
                      : vc.brand === "AES"  ? BRAND.aesthetics.dark
                      : vc.brand === "SLIM" ? BRAND.slimming.dark
                      : undefined; // HQ / group → neutral (not a brand)
                    return (
                      <th key={vc.slug}
                        style={brandColor ? { color: brandColor } : undefined}
                        className={`px-2 py-2 text-right font-semibold uppercase tracking-wide whitespace-nowrap
                          ${vc.brand === "HQ" ? "text-blue-700" : !brandColor ? "text-foreground" : ""}`}>
                        {vc.label}
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Group</th>
                </tr>
              </thead>
              <tbody>
                {/* Net Revenue */}
                <tr className="border-b font-semibold bg-muted/10">
                  <td className="px-3 py-2 sticky left-0 bg-muted/10">Net Revenue</td>
                  {cols.map(vc => (
                    <td key={vc.slug} className={cellCls(vc.slug)} onClick={cellClick(vc.slug, vc.label, "revenue", "Net Revenue")}>
                      {fmtC(vd(vc.slug).revenue)}
                    </td>
                  ))}
                  <td className="text-right tabular-nums px-2 py-1.5 font-semibold">{fmtC(data.group.revenue)}</td>
                </tr>

                {/* Wages */}
                <tr className="border-b font-semibold cursor-pointer hover:bg-muted/10"
                  onClick={() => setWagesOpen(v => !v)}>
                  <td className="px-3 py-2 sticky left-0 flex items-center gap-1">
                    {wagesOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    Wages &amp; Salaries
                  </td>
                  {cols.map(vc => {
                    const v = vd(vc.slug);
                    return (
                      <td key={vc.slug} className={cellCls(vc.slug)} onClick={cellClick(vc.slug, vc.label, "wages", "Wages & Salaries")}>
                        {fmtC(v.wages)}<span className="text-muted-foreground">{pctOf(v.wages, v.revenue)}</span>
                      </td>
                    );
                  })}
                  <td className="text-right tabular-nums px-2 py-1.5 font-semibold">{fmtC(data.group.wages)}</td>
                </tr>
                {wagesOpen && WAGE_ROLES.map(role => (
                  <tr key={role} className="border-b text-muted-foreground hover:bg-muted/10">
                    <td className="px-3 py-1 pl-8 sticky left-0 capitalize">{role}</td>
                    {cols.map(vc => {
                      const amt = vd(vc.slug).wage_by_role[role] ?? 0;
                      return (
                        <td key={vc.slug} className={cellCls(vc.slug)}
                          onClick={cellClick(vc.slug, vc.label, "wages", `Wages – ${role}`, { wageRole: role })}>
                          {fmtC(amt)}
                        </td>
                      );
                    })}
                    <td className="text-right tabular-nums px-2 py-1">{fmtC(data.group.wage_by_role[role] ?? 0)}</td>
                  </tr>
                ))}

                {/* Marketing */}
                <tr className="border-b font-semibold cursor-pointer hover:bg-muted/10"
                  onClick={() => setAdvOpen(v => !v)}>
                  <td className="px-3 py-2 sticky left-0 flex items-center gap-1">
                    {advOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    Marketing
                  </td>
                  {cols.map(vc => {
                    const v = vd(vc.slug);
                    return (
                      <td key={vc.slug} className={cellCls(vc.slug)} onClick={cellClick(vc.slug, vc.label, "advertising", "Marketing")}>
                        {fmtC(v.advertising)}<span className="text-muted-foreground">{pctOf(v.advertising, v.revenue)}</span>
                      </td>
                    );
                  })}
                  <td className="text-right tabular-nums px-2 py-1.5 font-semibold">{fmtC(data.group.advertising)}</td>
                </tr>
                {advOpen && AD_CHANNELS.map(ch => (
                  <tr key={ch} className="border-b text-muted-foreground hover:bg-muted/10">
                    <td className="px-3 py-1 pl-8 sticky left-0 capitalize">{ch}</td>
                    {cols.map(vc => (
                      <td key={vc.slug} className={cellCls(vc.slug)}
                        onClick={cellClick(vc.slug, vc.label, "advertising", `Marketing – ${ch}`, { adChannel: ch })}>
                        {fmtC(vd(vc.slug).ad_by_channel[ch] ?? 0)}
                      </td>
                    ))}
                    <td className="text-right tabular-nums px-2 py-1">{fmtC(data.group.ad_by_channel[ch] ?? 0)}</td>
                  </tr>
                ))}

                {/* SG&A */}
                <tr className="border-b font-semibold cursor-pointer hover:bg-muted/10"
                  onClick={() => setSgaOpen(v => !v)}>
                  <td className="px-3 py-2 sticky left-0 flex items-center gap-1">
                    {sgaOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    SG&amp;A
                  </td>
                  {cols.map(vc => {
                    const v = vd(vc.slug);
                    return (
                      <td key={vc.slug} className={cellCls(vc.slug)} onClick={cellClick(vc.slug, vc.label, "sga", "SG&A")}>
                        {fmtC(v.sga)}<span className="text-muted-foreground">{pctOf(v.sga, v.revenue)}</span>
                      </td>
                    );
                  })}
                  <td className="text-right tabular-nums px-2 py-1.5 font-semibold">{fmtC(data.group.sga)}</td>
                </tr>
                {sgaOpen && SGA_SUBS.map(sub => {
                  const lbl = { prof_services: "Prof services", fuel: "Fuel", laundry: "Laundry",
                    software: "Software", cleaning: "Cleaning", travel: "Travel", misc: "Misc",
                    insurance: "Insurance", events: "Events", maintenance: "Maintenance", telecom: "Telecom" }[sub] ?? sub;
                  return (
                    <tr key={sub} className="border-b text-muted-foreground hover:bg-muted/10">
                      <td className="px-3 py-1 pl-8 sticky left-0">{lbl}</td>
                      {cols.map(vc => (
                        <td key={vc.slug} className={cellCls(vc.slug)}
                          onClick={cellClick(vc.slug, vc.label, "sga", `SG&A – ${lbl}`, { subLine: sub })}>
                          {fmtC(vd(vc.slug).sga_by_sub[sub] ?? 0)}
                        </td>
                      ))}
                      <td className="text-right tabular-nums px-2 py-1">{fmtC(data.group.sga_by_sub[sub] ?? 0)}</td>
                    </tr>
                  );
                })}

                {/* COGS */}
                <tr className="border-b hover:bg-muted/10">
                  <td className="px-3 py-2 sticky left-0 font-semibold">COGS</td>
                  {cols.map(vc => {
                    const v = vd(vc.slug);
                    return (
                      <td key={vc.slug} className={cellCls(vc.slug)} onClick={cellClick(vc.slug, vc.label, "cogs", "COGS")}>
                        {fmtC(v.cogs)}<span className="text-muted-foreground">{pctOf(v.cogs, v.revenue)}</span>
                      </td>
                    );
                  })}
                  <td className="text-right tabular-nums px-2 py-1.5 font-semibold">{fmtC(data.group.cogs)}</td>
                </tr>

                {/* Rent Plus */}
                <tr className="border-b font-semibold cursor-pointer hover:bg-muted/10"
                  onClick={() => setRentOpen(v => !v)}>
                  <td className="px-3 py-2 sticky left-0 flex items-center gap-1">
                    {rentOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    Rent Plus
                  </td>
                  {cols.map(vc => {
                    const v   = vd(vc.slug);
                    const tot = v.rent + v.utilities;
                    return (
                      <td key={vc.slug} className="text-right tabular-nums px-2 py-1.5 text-xs">
                        {fmtC(tot)}<span className="text-muted-foreground">{pctOf(tot, v.revenue)}</span>
                      </td>
                    );
                  })}
                  <td className="text-right tabular-nums px-2 py-1.5 font-semibold">
                    {fmtC(data.group.rent + data.group.utilities)}
                  </td>
                </tr>
                {rentOpen && (["rent", "utilities"] as const).map(line => (
                  <tr key={line} className="border-b text-muted-foreground hover:bg-muted/10">
                    <td className="px-3 py-1 pl-8 sticky left-0 capitalize">{line}</td>
                    {cols.map(vc => {
                      const v   = vd(vc.slug);
                      const amt = line === "rent" ? v.rent : v.utilities;
                      return (
                        <td key={vc.slug} className={cellCls(vc.slug)}
                          onClick={cellClick(vc.slug, vc.label, line, line === "rent" ? "Rent" : "Utilities")}>
                          {fmtC(amt)}
                        </td>
                      );
                    })}
                    <td className="text-right tabular-nums px-2 py-1">
                      {fmtC(line === "rent" ? data.group.rent : data.group.utilities)}
                    </td>
                  </tr>
                ))}

                {/* EBITDA */}
                <tr className="border-b border-t-2 font-bold bg-muted/10">
                  <td className="px-3 py-2 sticky left-0 bg-muted/10">EBITDA</td>
                  {cols.map(vc => {
                    const e = vd(vc.slug).ebitda;
                    return (
                      <td key={vc.slug}
                        className={`text-right tabular-nums px-2 py-2 font-bold ${e < 0 ? "text-red-600" : "text-emerald-700"}`}>
                        {fmtC(e)}
                      </td>
                    );
                  })}
                  <td className={`text-right tabular-nums px-2 py-2 font-bold ${data.group.ebitda < 0 ? "text-red-600" : "text-emerald-700"}`}>
                    {fmtC(data.group.ebitda)}
                  </td>
                </tr>

                {/* EBITDA % */}
                <tr>
                  <td className="px-3 py-2 sticky left-0 text-muted-foreground font-medium">EBITDA %</td>
                  {cols.map(vc => {
                    const v  = vd(vc.slug);
                    const ep = v.revenue > 0 ? (v.ebitda / v.revenue) * 100 : 0;
                    return (
                      <td key={vc.slug} className="text-right px-2 py-2">
                        {v.revenue ? ebitdaBadge(ep) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                    );
                  })}
                  <td className="text-right px-2 py-2">
                    {data.group.revenue
                      ? ebitdaBadge((data.group.ebitda / data.group.revenue) * 100)
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <PractitionerProductivityTable dateFrom={dfStr} dateTo={dtStr} />

          {/* Fallback / hardwired summary */}
          {data.fallback_applied.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 space-y-0.5">
              <p className="font-medium">Hardwired rules applied ({data.fallback_applied.length}):</p>
              {data.fallback_applied.map((f, i) => (
                <p key={i} className="text-muted-foreground">
                  {f.venue} · {f.ebitda_line}: {f.rule_type} → {formatCurrency(f.value)}
                </p>
              ))}
            </div>
          )}
        </>
      )}

      {/* Drill dialog */}
      {drill && (
        <DrillDialog
          target={drill}
          dateFrom={dfStr}
          dateTo={dtStr}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

// ── Page entry point ──────────────────────────────────────────────────────────

export default function EbitdaV2Page() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <EbitdaV2Content dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
