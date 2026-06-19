// Commission engine — effective-dated rate resolution + commission totals.
//
// ACCURACY INVARIANT: the rate applied to a transaction is resolved PER
// TRANSACTION DATE — the rate row with the greatest effective_from <= tx
// date. No applicable row => rate 0 (UI flags "rates not set"). This keeps
// historical commission accurate when rates change mid-period.

import type { CommissionRate, CommissionRow, CommissionTotals, RevenueKind } from "./types";

/**
 * Pick the rate row applicable on `date` (YYYY-MM-DD): the row with the
 * greatest effective_from <= date. Returns null when no row applies.
 */
export function pickRate(
  rateRows: CommissionRate[],
  date: string,
): CommissionRate | null {
  let best: CommissionRate | null = null;
  for (const row of rateRows) {
    if (row.effective_from > date) continue;
    if (!best || row.effective_from > best.effective_from) best = row;
  }
  return best;
}

/** Commission for a single transaction (0 when no rate row applies). */
export function commissionForRow(
  rateRows: CommissionRate[],
  date: string,
  kind: RevenueKind,
  amount: number,
): number {
  const rate = pickRate(rateRows, date);
  if (!rate) return 0;
  const pct = kind === "retail" ? Number(rate.retail_rate) : Number(rate.service_rate);
  return amount * (pct || 0);
}

/**
 * Sum commission across transactions, resolving the rate per row per date.
 * Returns service / retail / total commission (rounded to cents).
 */
export function computeCommission(
  rows: CommissionRow[],
  rateRows: CommissionRate[],
): CommissionTotals {
  let service = 0;
  let retail = 0;
  for (const row of rows) {
    const c = commissionForRow(rateRows, row.date, row.kind, row.amount);
    if (row.kind === "retail") retail += c;
    else service += c;
  }
  return {
    commission_service: +service.toFixed(2),
    commission_retail: +retail.toFixed(2),
    commission_total: +(service + retail).toFixed(2),
  };
}
