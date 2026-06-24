"use client";

/**
 * HR financial hooks — payroll × revenue cross-references that don't come
 * directly from Talexio. These hit Supabase-backed routes which may not exist
 * yet; callers are expected to fall back to sample data on error.
 */

import { useQuery } from "@tanstack/react-query";

// ── HC% (payroll / revenue) by location + business unit ─────────────────────

export interface HRLocationFinancial {
  name: string;
  hcPct: number;
  payroll: number;
  revenue: number;
  headcount: number;
}

export interface HRBusinessUnitFinancial {
  name: string;
  hcPct: number;
  payroll: number;
  revenue: number;
}

export interface HRFinancialsResponse {
  month: string;
  totalRevenue: number;
  totalPayroll: number;
  totalHeadcount: number;
  /** false when per-employee payroll < €500 — likely Zoho wages not yet synced */
  payrollComplete: boolean;
  /** true when any venue's wages were extrapolated from the prior month */
  payrollExtrapolated: boolean;
  extrapolatedLocations: string[];
  /** true when headcount comes from a snapshot within the queried month range */
  headcountIsHistorical: boolean;
  headcountSnapshotDate: string | null;
  groupHcPct: number;
  byLocation: HRLocationFinancial[];
  byBusinessUnit: HRBusinessUnitFinancial[];
}

export function useHRFinancials(month: string) {
  return useQuery<HRFinancialsResponse>({
    queryKey: ["hr-financials", month],
    queryFn: async () => {
      const res = await fetch(`/api/hr/financials?month=${month}`);
      if (!res.ok) throw new Error(`Failed to fetch HR financials: ${res.status}`);
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
}

// ── RevPAH (revenue per available hour) by location ─────────────────────────

export interface RevPAHRow {
  location: string;
  revpah: number;
  revenue: number;
  headcount?: number;
  availableHours?: number;
  brand?: string;
  denomSource?: string;
}

export interface RevPAHBrandSection {
  locations: RevPAHRow[];
  avgRevPAH: number;
  target: number;
}

export interface HRRevPAHResponse {
  month: string;
  avgRevPAH: number;
  byLocation: RevPAHRow[];
  byBrand?: {
    Spa:        RevPAHBrandSection;
    Aesthetics: RevPAHBrandSection;
    Slimming:   RevPAHBrandSection;
  };
  /** True when queried month is still in progress — hours scaled to elapsed days */
  isPartialMonth?: boolean;
  elapsedDays?: number;
  totalDays?: number;
}

export function useHRRevPAH(month: string) {
  return useQuery<HRRevPAHResponse>({
    queryKey: ["hr-revpah", month],
    queryFn: async () => {
      const res = await fetch(`/api/hr/revpah?month=${month}`);
      if (!res.ok) throw new Error(`Failed to fetch RevPAH: ${res.status}`);
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
}

// ── Employee movement (weekly joiners/leavers) ───────────────────────────────

export interface EmployeeMovementWeek {
  weekStart:    string;
  weekEnd:      string;
  label:        string;
  joiners:      number;
  leavers:      number;
  net:          number;
  total:        number;
  joinerNames:  string[];
  leaverNames:  string[];
  dateSource:   string;
}

export interface EmployeeMovementSummary {
  currentTotal:  number;
  totalJoiners:  number;
  totalLeavers:  number;
  netMovement:   number;
}

export interface HREmployeeMovementResponse {
  weeks:    EmployeeMovementWeek[];
  summary:  EmployeeMovementSummary;
  rowCount: number;
}

export function useHREmployeeMovement(numWeeks = 26) {
  return useQuery<HREmployeeMovementResponse>({
    queryKey: ["hr-employee-movement", numWeeks],
    queryFn: async () => {
      const res = await fetch(`/api/hr/employee-movement?weeks=${numWeeks}`);
      if (!res.ok) throw new Error(`Failed to fetch employee movement: ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
    gcTime:    2 * 60 * 60 * 1000,
    retry: false,
  });
}

// ── We360 productivity leaderboard (per-employee, date range) ───────────────

export interface We360ProductivityRow {
  name: string;
  Productive: number;
  Neutral: number;
  Unproductive: number;
  Idle: number;
  productivePct: number;
  totalHrs: string;
  barLabel: string;
  days: number;
}

export interface We360ProductivityResponse {
  from: string;
  to: string;
  employees: We360ProductivityRow[];
  count: number;
}

export function useWe360Productivity(from: string, to: string) {
  return useQuery<We360ProductivityResponse>({
    queryKey: ["we360-productivity", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/hr/we360-productivity?from=${from}&to=${to}`);
      if (!res.ok) throw new Error(`Failed to fetch We360 productivity: ${res.status}`);
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
}

// ── Talexio location splits (payroll attribution by work location) ────────────

export interface EmployeeLocationSplit {
  id: number;
  talexioId: number;
  employeeName: string;
  homeLocation: string;
  homeLocationSlug: string;
  grossWage: number;
  totalEvents: number;
  locationSplits: Record<string, number>;
  wageAttribution: Record<string, number>;
  shiftBreakdown: Record<string, number> | null;
  attributionSource: "gps_timelogs" | "org_unit_static" | "no_position";
  computedAt: string;
}

export interface LocationSplitsData {
  month: string;
  employees: EmployeeLocationSplit[];
  locationTotals: Record<string, number>;
  totalPayroll: number;
  employeeCount: number;
  crossLocationCount: number;
  lastComputed: string | null;
}

export function useLocationSplits(month: string, location?: string) {
  return useQuery<LocationSplitsData>({
    queryKey: ["location-splits", month, location ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams({ month });
      if (location) params.set("location", location);
      const res = await fetch(`/api/hr/location-splits?${params}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!month,
    staleTime: 5 * 60 * 1000,
  });
}
