"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ */
/* Module-level cache — survives across renders / re-mounts            */
/* ------------------------------------------------------------------ */

let cachedBrandMap: Record<string, number> | null = null;
let cachedLocationMap: Record<number, string> | null = null;
let fetchPromise: Promise<void> | null = null;

async function fetchLookups() {
  const supabase = createClient();

  const [brandsRes, locsRes] = await Promise.all([
    supabase.from("brands").select("id, slug, name"),
    supabase.from("locations").select("id, name"),
  ]);

  if (!brandsRes.error && brandsRes.data) {
    const map: Record<string, number> = {};
    for (const row of brandsRes.data) {
      map[row.slug as string] = row.id as number;
    }
    cachedBrandMap = map;
  }

  if (!locsRes.error && locsRes.data) {
    const map: Record<number, string> = {};
    for (const row of locsRes.data) {
      map[row.id as number] = row.name as string;
    }
    cachedLocationMap = map;
  }
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useLookups() {
  const [loading, setLoading] = useState(
    cachedBrandMap === null || cachedLocationMap === null,
  );
  const [brandMap, setBrandMap] = useState<Record<string, number>>(
    cachedBrandMap || {},
  );
  const [locationMap, setLocationMap] = useState<Record<number, string>>(
    cachedLocationMap || {},
  );

  useEffect(() => {
    if (cachedBrandMap && cachedLocationMap) {
      setBrandMap(cachedBrandMap);
      setLocationMap(cachedLocationMap);
      setLoading(false);
      return;
    }

    if (!fetchPromise) {
      fetchPromise = fetchLookups().finally(() => {
        fetchPromise = null;
      });
    }

    fetchPromise.then(() => {
      setBrandMap(cachedBrandMap || {});
      setLocationMap(cachedLocationMap || {});
      setLoading(false);
    });
  }, []);

  return { brandMap, locationMap, loading };
}
