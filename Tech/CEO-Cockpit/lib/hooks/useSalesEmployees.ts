"use client";

// React-query hooks for the sales employee registry:
//   useSalesEmployees(brand?)        — list with current_rates + rate_history
//   useSalesEmployeeMutations()      — create / update / delete employees,
//                                      upsert / delete rate revisions
//   useUnmappedNames(brand, from, to) — revenue names with no employee mapping
//
// All hooks invalidate the ["sales-employees"] key family on mutation success.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BrandSlug,
  CommissionBasis,
  CommissionRate,
  SalesEmployeeWithRates,
  UnmappedName,
} from "@/lib/sales-employees/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((json as { error?: string }).error ?? `HTTP ${res.status}`) as Error & {
      status?: number;
      migrationMissing?: boolean;
    };
    err.status = res.status;
    err.migrationMissing = (json as { migration_missing?: boolean }).migration_missing === true;
    throw err;
  }
  return json as T;
}

// ── Payload types (mirror the API contract) ───────────────────────────────────

export interface CreateEmployeePayload {
  display_name: string;
  brand_slug: BrandSlug;
  slug?: string;
  role?: string | null;
  location_name?: string | null;
  user_email?: string | null;
  aliases?: string[];
  commission_basis?: CommissionBasis;
  is_active?: boolean;
  notes?: string | null;
  service_rate?: number;
  retail_rate?: number;
  effective_from?: string;
}

export interface UpdateEmployeePayload {
  id: number;
  slug?: string;
  display_name?: string;
  brand_slug?: BrandSlug;
  role?: string | null;
  location_name?: string | null;
  user_email?: string | null;
  aliases?: string[];
  commission_basis?: CommissionBasis;
  is_active?: boolean;
  notes?: string | null;
}

export interface UpsertRatePayload {
  employee_id: number;
  service_rate: number;
  retail_rate: number;
  effective_from: string; // YYYY-MM-DD
}

// ── List hook ─────────────────────────────────────────────────────────────────

export interface UseSalesEmployeesResult {
  employees: SalesEmployeeWithRates[];
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  /** true when the API reports migration 073 hasn't been applied yet */
  migrationMissing: boolean;
  refetch: () => void;
}

export function useSalesEmployees(brand?: BrandSlug): UseSalesEmployeesResult {
  const { data, isLoading, isError, error, refetch } = useQuery<{ employees: SalesEmployeeWithRates[] }>({
    queryKey: ["sales-employees", brand ?? "all"],
    queryFn: async () => {
      const qs = brand ? `?brand=${brand}` : "";
      return jsonOrThrow(await fetch(`/api/sales/employees${qs}`));
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    employees: data?.employees ?? [],
    isLoading,
    isError,
    error: error ? (error as Error).message : null,
    migrationMissing: Boolean((error as { migrationMissing?: boolean } | null)?.migrationMissing),
    refetch,
  };
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useSalesEmployeeMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["sales-employees"] });

  const createEmployee = useMutation({
    mutationFn: async (payload: CreateEmployeePayload) =>
      jsonOrThrow<{ employee: SalesEmployeeWithRates }>(
        await fetch("/api/sales/employees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: invalidate,
  });

  const updateEmployee = useMutation({
    mutationFn: async (payload: UpdateEmployeePayload) =>
      jsonOrThrow<{ employee: SalesEmployeeWithRates }>(
        await fetch("/api/sales/employees", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: invalidate,
  });

  const deleteEmployee = useMutation({
    mutationFn: async (id: number) =>
      jsonOrThrow<{ ok: boolean }>(
        await fetch(`/api/sales/employees?id=${id}`, { method: "DELETE" }),
      ),
    onSuccess: invalidate,
  });

  const upsertRate = useMutation({
    mutationFn: async (payload: UpsertRatePayload) =>
      jsonOrThrow<{ rate: CommissionRate }>(
        await fetch("/api/sales/employees/rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: invalidate,
  });

  const deleteRate = useMutation({
    mutationFn: async (id: number) =>
      jsonOrThrow<{ ok: boolean }>(
        await fetch(`/api/sales/employees/rates?id=${id}`, { method: "DELETE" }),
      ),
    onSuccess: invalidate,
  });

  return { createEmployee, updateEmployee, deleteEmployee, upsertRate, deleteRate };
}

// ── Unmapped names ────────────────────────────────────────────────────────────

export interface UseUnmappedNamesResult {
  unmapped: UnmappedName[];
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUnmappedNames(
  brand: BrandSlug,
  dateFrom?: Date,
  dateTo?: Date,
  enabled = true,
): UseUnmappedNamesResult {
  const fromStr = dateFrom ? toDateStr(dateFrom) : undefined;
  const toStr = dateTo ? toDateStr(dateTo) : undefined;

  const { data, isLoading, isError, error, refetch } = useQuery<{ unmapped: UnmappedName[] }>({
    queryKey: ["sales-employees", "unmapped", brand, fromStr ?? "default", toStr ?? "default"],
    queryFn: async () => {
      const qs = new URLSearchParams({ brand });
      if (fromStr) qs.set("from", fromStr);
      if (toStr) qs.set("to", toStr);
      return jsonOrThrow(await fetch(`/api/sales/employees/unmapped?${qs}`));
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    unmapped: data?.unmapped ?? [],
    isLoading,
    isError,
    error: error ? (error as Error).message : null,
    refetch,
  };
}
