"use client";

import { useState } from "react";
import {
  format,
  addMonths,
  subMonths,
  addYears,
  subYears,
  isSameMonth,
  isAfter,
  startOfMonth,
} from "date-fns";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface MonthPickerProps {
  value: Date;
  onChange: (month: Date) => void;
  availableMonths?: Date[];
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function MonthPicker({
  value,
  onChange,
  availableMonths,
}: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [popoverYear, setPopoverYear] = useState(value.getFullYear());

  const now = startOfMonth(new Date());

  const canGoNext = !isAfter(startOfMonth(addMonths(value, 1)), now);

  function isMonthAvailable(month: Date): boolean {
    if (isAfter(startOfMonth(month), now)) return false;
    if (!availableMonths) return true;
    return availableMonths.some((m) => isSameMonth(m, month));
  }

  function handlePrev() {
    const prev = subMonths(value, 1);
    if (isMonthAvailable(prev)) {
      onChange(startOfMonth(prev));
    }
  }

  function handleNext() {
    if (!canGoNext) return;
    const next = addMonths(value, 1);
    if (isMonthAvailable(next)) {
      onChange(startOfMonth(next));
    }
  }

  function handleMonthSelect(monthIndex: number) {
    const selected = startOfMonth(new Date(popoverYear, monthIndex, 1));
    if (isMonthAvailable(selected)) {
      onChange(selected);
      setOpen(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setPopoverYear(value.getFullYear());
    }
    setOpen(nextOpen);
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-text-secondary hover:text-gold hover:bg-gold-bg"
        onClick={handlePrev}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-lg border border-warm-border bg-white px-3 py-1.5 text-sm font-medium text-charcoal hover:border-gold/30 transition-colors"
          )}
        >
          <CalendarDays className="h-4 w-4 text-gold" />
          {format(value, "MMMM yyyy")}
        </PopoverTrigger>

        <PopoverContent className="w-64 p-3" align="center">
          {/* Year selector */}
          <div className="flex items-center justify-between mb-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-secondary hover:text-gold hover:bg-gold-bg"
              onClick={() => setPopoverYear((y) => y - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold text-charcoal">
              {popoverYear}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-secondary hover:text-gold hover:bg-gold-bg"
              onClick={() => {
                if (popoverYear < now.getFullYear()) {
                  setPopoverYear((y) => y + 1);
                }
              }}
              disabled={popoverYear >= now.getFullYear()}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* 3x4 month grid */}
          <div className="grid grid-cols-3 gap-1">
            {MONTH_LABELS.map((label, index) => {
              const monthDate = startOfMonth(
                new Date(popoverYear, index, 1)
              );
              const available = isMonthAvailable(monthDate);
              const isActive = isSameMonth(monthDate, value);

              return (
                <button
                  key={label}
                  onClick={() => handleMonthSelect(index)}
                  disabled={!available}
                  className={cn(
                    "px-2 py-1.5 rounded-md text-sm font-medium transition-all",
                    isActive
                      ? "bg-gold text-white shadow-sm"
                      : available
                        ? "text-text-secondary hover:text-charcoal hover:bg-gold-bg"
                        : "text-text-secondary/40 cursor-not-allowed"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-text-secondary hover:text-gold hover:bg-gold-bg"
        onClick={handleNext}
        disabled={!canGoNext}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
