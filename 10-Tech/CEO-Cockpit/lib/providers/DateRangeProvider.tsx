"use client";

import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { startOfMonth, endOfMonth, subMonths, format, isValid } from "date-fns";

const STORAGE_KEY = "cockpit-date-range";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseISODate(v: string | null): Date | null {
  if (!v || !ISO_DATE.test(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  return isValid(d) ? d : null;
}

function toISO(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function defaultRange(): { from: Date; to: Date } {
  return {
    from: startOfMonth(subMonths(new Date(), 1)),
    to:   endOfMonth(subMonths(new Date(), 1)),
  };
}

function readStored(): { from: Date; to: Date } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { from?: string; to?: string };
    const from = parseISODate(parsed.from ?? null);
    const to = parseISODate(parsed.to ?? null);
    if (from && to && from <= to) return { from, to };
  } catch { /* corrupt — fall through */ }
  return null;
}

function readUrl(): { from: Date; to: Date } | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  const from = parseISODate(p.get("from"));
  const to = parseISODate(p.get("to"));
  if (from && to && from <= to) return { from, to };
  return null;
}

type Ctx = {
  from: Date;
  to: Date;
  setRange: (from: Date, to: Date) => void;
};

export const DateRangeContext = createContext<Ctx | null>(null);

/**
 * Holds the selected date range as React state at a layout level above all
 * routes. Mounted once at root layout, the provider's useState survives every
 * page navigation in Next.js App Router — so changing the filter on one page
 * and clicking to another never loses the range, regardless of URL params or
 * localStorage edge cases.
 *
 * On mount, initialises from URL (?from=&to=) → localStorage → default.
 * On change, writes to localStorage AND the URL (router.replace) so deep
 * links remain shareable.
 */
export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  // SSR-safe initial state: defaultRange. Real value arrives in the
  // hydration effect below so server HTML and first client paint match.
  const [range, setRange] = useState<{ from: Date; to: Date }>(() => defaultRange());
  const hydratedRef = useRef(false);

  // After hydration, prefer URL → localStorage → already-default.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const url = readUrl();
    if (url) {
      setRange(url);
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ from: toISO(url.from), to: toISO(url.to) }),
        );
      } catch { /* storage unavailable */ }
      return;
    }
    const stored = readStored();
    if (stored) setRange(stored);
  }, []);

  const apply = useCallback((newFrom: Date, newTo: Date) => {
    setRange({ from: newFrom, to: newTo });
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ from: toISO(newFrom), to: toISO(newTo) }),
      );
    } catch { /* storage unavailable */ }
    // Reflect to URL so the address bar matches what the user picked and
    // the range survives a hard refresh. Use history.replaceState directly
    // — no router import needed and it doesn't trigger Next.js navigation.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("from", toISO(newFrom));
      url.searchParams.set("to",   toISO(newTo));
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  return (
    <DateRangeContext.Provider value={{ from: range.from, to: range.to, setRange: apply }}>
      {children}
    </DateRangeContext.Provider>
  );
}
