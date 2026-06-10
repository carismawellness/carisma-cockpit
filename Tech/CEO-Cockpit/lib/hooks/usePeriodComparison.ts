"use client";

import { useState, useMemo } from "react";

export function usePeriodComparison(dateFrom: Date, dateTo: Date) {
  const [enabled, setEnabled] = useState(false);

  const previousPeriod = useMemo(() => {
    // Inclusive day count: from..to spans (to - from) + 1 calendar days.
    // Using the exclusive duration (to - from) made a 30-day period compare
    // against a 29-day previous window.
    const MS_PER_DAY = 86_400_000;
    const fromDay = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), dateFrom.getDate());
    const toDay   = new Date(dateTo.getFullYear(),   dateTo.getMonth(),   dateTo.getDate());
    const inclusiveDays = Math.round((toDay.getTime() - fromDay.getTime()) / MS_PER_DAY) + 1;
    const prevTo   = new Date(fromDay.getFullYear(), fromDay.getMonth(), fromDay.getDate() - 1); // day before current period starts
    const prevFrom = new Date(prevTo.getFullYear(),  prevTo.getMonth(),  prevTo.getDate() - (inclusiveDays - 1));
    return { from: prevFrom, to: prevTo };
  }, [dateFrom, dateTo]);

  return {
    comparisonEnabled: enabled,
    toggleComparison: () => setEnabled(!enabled),
    previousFrom: previousPeriod.from,
    previousTo: previousPeriod.to,
  };
}
