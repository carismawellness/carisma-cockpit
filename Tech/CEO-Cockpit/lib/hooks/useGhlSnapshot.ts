"use client";

import { useQuery } from "@tanstack/react-query";

export interface GhlSnapshotBrand {
  newLeads: number;
  todoCount: number;
}

export interface GhlSnapshot {
  spa:        GhlSnapshotBrand;
  aesthetics: GhlSnapshotBrand;
  slimming:   GhlSnapshotBrand;
}

const EMPTY_BRAND: GhlSnapshotBrand = { newLeads: 0, todoCount: 0 };
const EMPTY_SNAPSHOT: GhlSnapshot = {
  spa:        EMPTY_BRAND,
  aesthetics: EMPTY_BRAND,
  slimming:   EMPTY_BRAND,
};

export function useGhlSnapshot() {
  const { data, isLoading } = useQuery<GhlSnapshot>({
    queryKey: ["ghl-snapshot"],
    queryFn: async () => {
      const res = await fetch("/api/crm/ghl-snapshot");
      if (!res.ok) throw new Error(`GHL snapshot ${res.status}`);
      return res.json() as Promise<GhlSnapshot>;
    },
    staleTime:        5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  return {
    snapshot:  data ?? EMPTY_SNAPSHOT,
    isLoading,
  };
}
