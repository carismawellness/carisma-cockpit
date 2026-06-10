// lib/analytics/retention.ts
//
// Pure computation helpers for client-retention analytics (no I/O).
// Shared by /api/sales/aesthetics-retention and /api/sales/slimming-retention.
//
// Client identity in the sales tables is a free-text name column, so all
// client-level metrics here are NAME-MATCHED: we normalize aggressively,
// exclude placeholder names, and the API routes report the excluded share
// so the numbers stay honest.

// ── Client-name normalization ─────────────────────────────────────────────────

/**
 * Names that are clearly not a person — counter labels, payment types, blanks.
 * Compared against the NORMALIZED form (lowercase, trimmed, diacritics stripped).
 */
const PLACEHOLDER_NAMES = new Set([
  "", "-", "--", "—", ".", "..", "n/a", "na", "none", "null", "unknown",
  "cash", "card", "revolut", "voucher", "gift voucher", "gift",
  "walk in", "walkin", "walk-in", "client", "customer", "guest",
  "no name", "noname", "anon", "anonymous", "tbc", "tbd",
  "test", "various", "misc", "staff", "total", "totals",
]);

/**
 * Normalizes a raw client name for cross-transaction matching:
 * trim, collapse internal whitespace, casefold, strip diacritics.
 * Returns "" for null/empty input.
 */
export function normalizeClientName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when a normalized name cannot identify a person: blank, a known
 * placeholder, a single character, or containing no letters at all.
 * Such rows are excluded from client-level metrics (and counted separately).
 */
export function isUnmatchableClientName(normalized: string): boolean {
  if (normalized.length < 2) return true;
  if (!/[a-z]/.test(normalized)) return true;
  return PLACEHOLDER_NAMES.has(normalized);
}

/** Title-cases a normalized name for display ("maria farrugia" → "Maria Farrugia"). */
export function displayClientName(normalized: string): string {
  return normalized.replace(/(^|[\s\-'])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

// ── Aesthetics service classification ─────────────────────────────────────────
//
// The aesthetics table has no stored category column — categories are derived
// from `service_product` at read time (see categorizeNavService / the CANONICAL
// map in lib/hooks/useAestheticsSales.ts). The patterns below mirror that
// categorizer against the values actually present in aesthetics_sales_daily.

/**
 * Consultation detector. Mirrors the hook's CANONICAL rule [/consult/i →
 * "Consultation"]. Real table values: "consultation" (195 rows as of Jun 2026).
 */
export function isConsultationService(service: string | null | undefined): boolean {
  return !!service && /consult/i.test(service);
}

/**
 * Wrinkle-relaxer (tox) detector — the 90-day-recall treatment family.
 * Mirrors the categorizer's Wrinkle-Relaxing rule (/\bbotox\b|\btoxin\b|\bwrinkle\b/)
 * but uses a bare `botox` substring because the table contains unspaced variants
 * ("botox50u") that defeat the \b boundary, plus brand names seen in the data
 * ("botox - alluzience") and common EU toxin brands.
 * Real table values: "botox", "botox 50u", "botox one area", "botox + lip filler", …
 */
export function isToxService(service: string | null | undefined): boolean {
  if (!service) return false;
  if (isConsultationService(service)) return false;
  return /botox|alluzience|dysport|xeomin|bocouture|\btoxin\b|anti[\s-]*wrinkle|wrinkle[\s-]*relax/i.test(service);
}

// ── Date helpers (all dates are "YYYY-MM-DD" strings) ─────────────────────────

/** Whole days from `a` to `b` (positive when b is after a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Adds `days` to a YYYY-MM-DD string. */
export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Median of a numeric array (null for empty). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── New vs Returning ───────────────────────────────────────────────────────────

export interface ClientTx {
  /** Normalized client name (already matched / non-placeholder). */
  client: string;
  date:   string;        // YYYY-MM-DD
  amount: number;        // gross revenue for the row
}

export interface NewReturningPeriod {
  newClients:        number;
  returningClients:  number;
  returningSharePct: number;   // returning / (new+returning) × 100, 1dp
  newRevenue:        number;
  returningRevenue:  number;
}

export interface NewReturningMonth {
  month:            string;   // YYYY-MM-01
  newClients:       number;
  returningClients: number;
  newRevenue:       number;
  returningRevenue: number;
}

/**
 * Splits clients transacting in [fromDate, toDate] into NEW (first-ever
 * transaction falls inside the window — full-history lookback) vs RETURNING
 * (appeared in any earlier transaction). Revenue attributed is each client's
 * in-window revenue. Also returns a trailing-N-months trend (month = calendar
 * month of the transactions; "new" = the client's first-ever tx is in that month).
 */
export function computeNewReturning(
  txs: ClientTx[],
  fromDate: string,
  toDate: string,
  trailingMonths: { month: string; start: string; end: string }[],
): { period: NewReturningPeriod; monthly: NewReturningMonth[] } {
  const firstSeen = new Map<string, string>();
  for (const t of txs) {
    const cur = firstSeen.get(t.client);
    if (!cur || t.date < cur) firstSeen.set(t.client, t.date);
  }

  // Selected period
  const inPeriod = new Map<string, number>(); // client → in-window revenue
  for (const t of txs) {
    if (t.date >= fromDate && t.date <= toDate) {
      inPeriod.set(t.client, (inPeriod.get(t.client) ?? 0) + t.amount);
    }
  }
  let newClients = 0, returningClients = 0, newRevenue = 0, returningRevenue = 0;
  for (const [client, revenue] of inPeriod) {
    if ((firstSeen.get(client) ?? "") < fromDate) {
      returningClients++; returningRevenue += revenue;
    } else {
      newClients++; newRevenue += revenue;
    }
  }
  const denom = newClients + returningClients;
  const period: NewReturningPeriod = {
    newClients,
    returningClients,
    returningSharePct: denom > 0 ? Math.round((returningClients / denom) * 1000) / 10 : 0,
    newRevenue:        Math.round(newRevenue),
    returningRevenue:  Math.round(returningRevenue),
  };

  // Monthly trend
  const monthly: NewReturningMonth[] = trailingMonths.map(({ month, start, end }) => {
    const m = new Map<string, number>();
    for (const t of txs) {
      if (t.date >= start && t.date <= end) m.set(t.client, (m.get(t.client) ?? 0) + t.amount);
    }
    let nC = 0, rC = 0, nR = 0, rR = 0;
    for (const [client, revenue] of m) {
      if ((firstSeen.get(client) ?? "") < start) { rC++; rR += revenue; }
      else                                       { nC++; nR += revenue; }
    }
    return {
      month,
      newClients: nC,
      returningClients: rC,
      newRevenue: Math.round(nR),
      returningRevenue: Math.round(rR),
    };
  });

  return { period, monthly };
}

/** Trailing-N calendar months ending at `asOf`'s month, with start/end day strings. */
export function trailingMonthWindows(asOf: string, n: number): { month: string; start: string; end: string }[] {
  const [y, m] = [Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7))];
  const out: { month: string; start: string; end: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const yy = d.getUTCFullYear(), mm = d.getUTCMonth();
    const lastDay = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    const prefix = `${yy}-${String(mm + 1).padStart(2, "0")}`;
    out.push({ month: `${prefix}-01`, start: `${prefix}-01`, end: `${prefix}-${String(lastDay).padStart(2, "0")}` });
  }
  return out;
}
