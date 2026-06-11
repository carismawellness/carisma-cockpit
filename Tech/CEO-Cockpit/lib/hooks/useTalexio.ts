"use client";

import { useQuery } from "@tanstack/react-query";

type TalexioAction = "employees" | "headcount" | "timelogs" | "leave" | "shifts" | "shiftsToday" | "payrolls" | "payslips";

interface UseTalexioOptions {
  action: TalexioAction;
  params?: Record<string, string>;
  enabled?: boolean;
}

export function useTalexio<T = unknown>({ action, params, enabled = true }: UseTalexioOptions) {
  return useQuery({
    queryKey: ["talexio", action, params],
    queryFn: async () => {
      const searchParams = new URLSearchParams({ action, ...params });
      const res = await fetch(`/api/talexio?${searchParams.toString()}`);
      if (!res.ok) throw new Error(`Talexio API error: ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json.data as T;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled,
  });
}

// ---- Typed interfaces for Talexio data ----

export interface TalexioEmployee {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  employeeCode: string | null;
  emailAddress: string | null;
  isTerminated: boolean;
  currentPositionSimple: {
    id: string;
    isEnded: boolean;
    position: { id: string; name: string } | null;
    organisationUnit: { id: string; name: string } | null;
  } | null;
}

export interface TalexioTimeLog {
  id: string;
  from: string;
  to: string | null;
  label: string | null;
  locationLongIn: number | null;
  locationLatIn: number | null;
  locationLongOut: number | null;
  locationLatOut: number | null;
  employee: { id: string; fullName: string };
}

export interface TalexioEmployeeWithTimeLogs {
  id: string;
  fullName: string;
  isTerminated: boolean;
  timeLogs: TalexioTimeLog[];
}

export interface TalexioLeaveEntitlement {
  id: string;
  entitlement: number;
  year: number;
  leaveType: { id: string; name: string };
  businessUnit: { id: string; name: string } | null;
}

export interface TalexioEmployeeWithLeave {
  id: string;
  fullName: string;
  isTerminated: boolean;
  leaveEntitlements: TalexioLeaveEntitlement[];
}

// ---- Convenience hooks ----

export function useTalexioEmployees() {
  return useTalexio<{ employees: TalexioEmployee[] }>({ action: "employees" });
}

export function useTalexioTimeLogs() {
  return useTalexio<{ employees: TalexioEmployeeWithTimeLogs[] }>({ action: "timelogs" });
}

export function useTalexioLeave() {
  return useTalexio<{ employees: TalexioEmployeeWithLeave[] }>({ action: "leave" });
}

export function useTalexioHeadcount() {
  return useTalexio<{ employees: TalexioEmployee[] }>({ action: "headcount" });
}

// ---- Payslip types ----

export interface TalexioPayslip {
  id: string;
  gross: number;
  net: number;
  tax: number;
  periodFrom: string;
  periodTo: string;
}

export interface TalexioEmployeeWithPayslips {
  id: string;
  fullName: string;
  isTerminated: boolean;
  currentPositionSimple: {
    position: { name: string } | null;
    organisationUnit: { name: string } | null;
  } | null;
  payslips: TalexioPayslip[];
}

export function useTalexioPayslips() {
  return useTalexio<{ employees: TalexioEmployeeWithPayslips[] }>({ action: "payslips" });
}

export interface TalexioWorkShift {
  id: string;
  date: string;
  from: string; // "HH:MM" or "HH:MM:SS"
  to: string;
}

export interface TalexioEmployeeWithShifts {
  id: string;
  fullName: string;
  workShifts: TalexioWorkShift[];
}

/** Fetches published work shifts for all employees within [from, to] (YYYY-MM-DD). */
export function useTalexioShiftsRange(from: string, to: string) {
  return useTalexio<{ employees: TalexioEmployeeWithShifts[] }>({
    action: "shiftsToday",
    params: { dateFrom: from, dateTo: to },
  });
}
