// Shared types for the Sales Employee Dashboards + Commission Mapping system.
// See docs/plans/2026-06-10-sales-employee-dashboards-design.md

export type BrandSlug = "spa" | "aesthetics" | "slimming";
export type CommissionBasis = "ex_vat" | "inc_vat";
export type RevenueKind = "service" | "retail";
export type EmployeeType = "therapist" | "advisor" | "management";

// ── DB rows ───────────────────────────────────────────────────────────────────

export interface SalesEmployee {
  id: number;
  slug: string;
  display_name: string;
  brand_slug: BrandSlug;
  role: string | null;
  location_id: number | null;
  location_name: string | null;
  user_email: string | null;
  is_active: boolean;
  aliases: string[];
  commission_basis: CommissionBasis;
  employee_type: EmployeeType;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CommissionRate {
  id: number;
  employee_id?: number;
  service_rate: number; // 0.06 = 6%
  retail_rate: number;  // 0.10 = 10%
  effective_from: string; // YYYY-MM-DD
}

export interface SalesEmployeeWithRates extends SalesEmployee {
  /** Rate row applicable today (greatest effective_from <= today), null if none. */
  current_rates: CommissionRate | null;
  /** All rate revisions, most recent first. */
  rate_history: CommissionRate[];
}

// ── Commission engine inputs ──────────────────────────────────────────────────

/** One revenue transaction attributed to an employee. */
export interface CommissionRow {
  date: string;   // YYYY-MM-DD transaction date
  amount: number; // revenue in the employee's commission basis
  kind: RevenueKind;
}

export interface CommissionTotals {
  commission_service: number;
  commission_retail: number;
  commission_total: number;
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface UnmappedName {
  name: string;        // normalized name as seen in revenue data
  kind: RevenueKind;   // dominant kind by revenue
  revenue: number;
  tx_count: number;
  last_seen: string;   // YYYY-MM-DD
}

export interface EmployeeStatsTotals {
  service_revenue: number;
  retail_revenue: number;
  total_revenue: number;
  service_tx: number;
  retail_tx: number;
  total_tx: number;
  commission_service: number;
  commission_retail: number;
  commission_total: number;
  avg_ticket: number;
  active_days: number;
}

export interface EmployeeDailyStat {
  date: string;
  service_revenue: number;
  retail_revenue: number;
  commission: number;
}

export interface BreakdownRow {
  name: string;
  revenue: number;
  tx_count: number;
}

export interface EmployeeStatsResponse {
  employee: {
    slug: string;
    display_name: string;
    brand_slug: BrandSlug;
    role: string | null;
    location_id: number | null;
    is_active: boolean;
    commission_basis: CommissionBasis;
    rates_set: boolean;
    employee_type: EmployeeType;
  };
  rates: { service_rate: number; retail_rate: number; effective_from: string } | null;
  totals: EmployeeStatsTotals;
  daily: EmployeeDailyStat[];
  service_breakdown: BreakdownRow[];
  retail_breakdown: BreakdownRow[];
  brand_extras: Record<string, unknown>;
}
