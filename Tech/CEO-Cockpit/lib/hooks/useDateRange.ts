"use client";

import { useState } from "react";
import { startOfMonth, endOfMonth, subMonths } from "date-fns";

export function useDateRange() {
  const [from, setFrom] = useState(() => startOfMonth(subMonths(new Date(), 1)));
  const [to, setTo] = useState(() => endOfMonth(subMonths(new Date(), 1)));

  function setRange(newFrom: Date, newTo: Date) {
    setFrom(newFrom);
    setTo(newTo);
  }

  return { from, to, setRange };
}
