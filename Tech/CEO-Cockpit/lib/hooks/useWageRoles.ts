"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Canonical role keys + display labels. Unassigned is an implicit bucket
// (NOT a stored role) for any employee with no mapping, so the dashboard's
// role sub-rows always reconcile back to the Wages & Salaries cell.
export const WAGE_ROLES = ["manager", "reception", "practitioner", "crm"] as const;
export type WageRole = (typeof WAGE_ROLES)[number];

export const WAGE_ROLE_LABEL: Record<WageRole, string> = {
  manager:      "Manager",
  reception:    "Reception",
  practitioner: "Practitioner",
  crm:          "CRM",
};

// Order used for rendering role sub-rows on the EBITDA table and the
// settings % summary. Unassigned always last.
export const WAGE_ROLE_ORDER: WageRole[] = ["manager", "reception", "practitioner", "crm"];

export interface WageRoleMapping {
  contact_key:  string;
  contact_name: string;
  role:         WageRole;
}

// MUST match the server normaliser in app/api/settings/wage-roles/route.ts:
// lowercase, trim, collapse inner whitespace runs to a single space.
export function normalizeContact(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

const QUERY_KEY = ["wage-roles"] as const;

/**
 * Loads the small wage_role_mapping table and exposes:
 *  - `roleByContact`: Map<normalizedContact, WageRole> for the EBITDA join +
 *    settings selects (purely client-side bucketing of agg.lineItems).
 *  - `setRole`: mutation to assign/clear a role for one employee. Pass
 *    role=null (or "unassigned") to clear → falls into the Unassigned bucket.
 *  - loading/error/fetching flags.
 */
export function useWageRoles() {
  const queryClient = useQueryClient();

  const query = useQuery<WageRoleMapping[]>({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch("/api/settings/wage-roles"),
    staleTime: 60_000,
  });

  const roleByContact = useMemo(() => {
    const m = new Map<string, WageRole>();
    for (const row of query.data ?? []) {
      // Defensive: re-normalise client-side in case stored key drifts.
      m.set(normalizeContact(row.contact_name) || row.contact_key, row.role);
    }
    return m;
  }, [query.data]);

  const setRole = useMutation({
    mutationFn: ({ contactName, role }: { contactName: string; role: WageRole | null }) =>
      apiFetch("/api/settings/wage-roles", {
        method: "PATCH",
        body: JSON.stringify({ contact_name: contactName, role }),
      }),
    // Optimistic-ish: just invalidate so every consumer (settings page +
    // EBITDA page) re-reads the canonical mapping after a change.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    roleByContact,
    setRole,
    isLoading:  query.isLoading,
    isFetching: query.isFetching,
    error:      query.error as Error | null,
  };
}

// Resolve an employee's role from a contact name, or null (→ Unassigned).
export function resolveRole(
  roleByContact: Map<string, WageRole>,
  contact: string,
): WageRole | null {
  return roleByContact.get(normalizeContact(contact)) ?? null;
}
