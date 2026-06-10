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
}

export interface HRRevPAHResponse {
  month: string;
  avgRevPAH: number;
  byLocation: RevPAHRow[];
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

// ── We360 productivity leaderboard (per-employee, date range) ───────────────

export interface We360ProductivityRow {
  name: string;
  Productive: number;
  Neutral: number;
  Unproductive: number;
  Idle: number;
  productivePct: number;
  totalHrs: string;
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
