"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startOfMonth, endOfMonth, subMonths, format, isValid } from "date-fns";

const STORAGE_KEY = "cockpit-date-range";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseISODate(value: string | null): Date | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00`);
  return isValid(d) ? d : null;
}

function toISO(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function defaultRange(): { from: Date; to: Date } {
  return {
    from: startOfMonth(subMonths(new Date(), 1)),
    to: endOfMonth(subMonths(new Date(), 1)),
  };
}

function readStoredRange(): { from: Date; to: Date } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { from?: string; to?: string };
    const from = parseISODate(parsed.from ?? null);
    const to = parseISODate(parsed.to ?? null);
    if (from && to && from <= to) return { from, to };
  } catch {
    /* corrupt storage — fall through to default */
  }
  return null;
}

function writeStoredRange(from: Date, to: Date) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ from: toISO(from), to: toISO(to) })
    );
  } catch {
    /* storage unavailable — URL still carries the range */
  }
}

/**
 * Selected date range, persisted so it survives page navigation:
 *   1. URL searchParams (?from=YYYY-MM-DD&to=YYYY-MM-DD) — authoritative, shareable
 *   2. localStorage — fallback when the URL has no range
 *   3. previous full month — default
 *
 * Changes are written to BOTH the URL (router.replace, preserving other
 * params) and localStorage.
 *
 * NOTE: uses useSearchParams — any component calling this must render under
 * a <Suspense> boundary (handled by DashboardShell).
 */
export function useDateRange() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlFromStr = searchParams.get("from");
  const urlToStr = searchParams.get("to");
  const urlFrom = parseISODate(urlFromStr);
  const urlTo = parseISODate(urlToStr);
  const hasUrlRange = !!(urlFrom && urlTo && urlFrom <= urlTo);

  // Fallback state (used until/unless the URL carries a valid range).
  const [fallback, setFallback] = useState<{ from: Date; to: Date }>(
    () => readStoredRange() ?? defaultRange()
  );

  const from = hasUrlRange ? (urlFrom as Date) : fallback.from;
  const to = hasUrlRange ? (urlTo as Date) : fallback.to;

  // Keep localStorage in sync with shared/incoming URLs, and reflect the
  // active range into the URL when arriving on a page without params.
  useEffect(() => {
    if (hasUrlRange) {
      writeStoredRange(urlFrom as Date, urlTo as Date);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", toISO(from));
    params.set("to", toISO(to));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUrlRange, urlFromStr, urlToStr, pathname]);

  const setRange = useCallback(
    (newFrom: Date, newTo: Date) => {
      setFallback({ from: newFrom, to: newTo });
      writeStoredRange(newFrom, newTo);
      const params = new URLSearchParams(searchParams.toString());
      params.set("from", toISO(newFrom));
      params.set("to", toISO(newTo));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return { from, to, setRange };
}
