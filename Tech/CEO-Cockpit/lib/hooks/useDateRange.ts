"use client";

import { useContext } from "react";
import { DateRangeContext } from "@/lib/providers/DateRangeProvider";

/**
 * Selected date range, sourced from the DateRangeProvider mounted at the
 * root layout. Because the provider lives above the routing layer, the
 * range persists across every page navigation in Next.js App Router —
 * picking "Last week" on the funnel and clicking through to Sales > Spa
 * keeps the same range. URL params and localStorage are still kept in
 * sync inside the provider so deep links and refreshes also work.
 */
export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) {
    throw new Error("useDateRange must be used inside <DateRangeProvider>");
  }
  return { from: ctx.from, to: ctx.to, setRange: ctx.setRange };
}
