"use client";

import { useState, useMemo, useEffect } from "react";
import {
  format,
  subDays,
  startOfWeek,
  endOfWeek,
  subWeeks,
  startOfMonth,
  endOfMonth,
  subMonths,
  isSameDay,
  parse,
  isValid,
} from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DATE_FMT = "dd/MM/yyyy";

function parseDmy(value: string): Date | null {
  const parsed = parse(value, DATE_FMT, new Date());
  // Reject dates outside a plausible business range (2020–2099).
  // Guards against partially-typed years like "206" being accepted as year 206 AD,
  // which causes the API to receive a 1800-year date range and return empty data.
  if (!isValid(parsed)) return null;
  const y = parsed.getFullYear();
  if (y < 2020 || y > 2099) return null;
  return parsed;
}

interface DateRangePickerProps {
  from: Date;
  to: Date;
  onChange: (from: Date, to: Date) => void;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getMonthRange(monthIndex: number): { from: Date; to: Date } {
  const now = new Date();
  const year = monthIndex <= now.getMonth() ? now.getFullYear() : now.getFullYear() - 1;
  const d = new Date(year, monthIndex, 1);
  return { from: startOfMonth(d), to: endOfMonth(d) };
}

function isMonthActive(monthIndex: number, from: Date, to: Date): boolean {
  const range = getMonthRange(monthIndex);
  return isSameDay(range.from, from) && isSameDay(range.to, to);
}

const presets = [
  {
    key: "7d",
    label: "7 days",
    fn: () => ({ from: subDays(new Date(), 7), to: new Date() }),
  },
  {
    key: "30d",
    label: "30 days",
    fn: () => ({ from: subDays(new Date(), 30), to: new Date() }),
  },
  {
    key: "90d",
    label: "90 days",
    fn: () => ({ from: subDays(new Date(), 90), to: new Date() }),
  },
  {
    key: "lw",
    label: "Last week",
    fn: () => {
      const lastWeek = subWeeks(new Date(), 1);
      return {
        from: startOfWeek(lastWeek, { weekStartsOn: 1 }),
        to: endOfWeek(lastWeek, { weekStartsOn: 1 }),
      };
    },
  },
  {
    key: "lm",
    label: "Last month",
    fn: () => {
      const lastMonth = subMonths(new Date(), 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    },
  },
] as const;

function isPresetActive(preset: (typeof presets)[number], from: Date, to: Date) {
  const range = preset.fn();
  return isSameDay(range.from, from) && isSameDay(range.to, to);
}

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [pendingFrom, setPendingFrom] = useState<Date | undefined>(from);
  const [pendingTo, setPendingTo] = useState<Date | undefined>(to);
  const [fromText, setFromText] = useState(format(from, DATE_FMT));
  const [toText, setToText] = useState(format(to, DATE_FMT));

  useEffect(() => {
    if (open) {
      // Reset pending + text to committed values each time the picker opens
      setPendingFrom(from);
      setPendingTo(to);
      setFromText(format(from, DATE_FMT));
      setToText(format(to, DATE_FMT));
    } else {
      // Sync text display when committed dates change while picker is closed
      setFromText(format(from, DATE_FMT));
      setToText(format(to, DATE_FMT));
    }
  }, [from, to, open]);

  const fromValid = parseDmy(fromText);
  const toValid = parseDmy(toText);

  const activeKey = useMemo(
    () => presets.find((p) => isPresetActive(p, from, to))?.key ?? null,
    [from, to]
  );

  const applyPreset = (preset: (typeof presets)[number]) => {
    const range = preset.fn();
    onChange(range.from, range.to);
  };

  // Commit whatever is staged (typed text takes priority; falls back to calendar pending)
  const commitOK = () => {
    const a = fromValid ?? pendingFrom;
    const b = toValid ?? pendingTo;
    if (!a || !b) return;
    const [start, end] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
    onChange(start, end);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Preset chips (desktop) */}
      <div className="hidden md:inline-flex items-center bg-muted/50 rounded-full p-1 gap-1 border border-border/60">
        {presets.map((preset) => {
          const active = activeKey === preset.key;
          return (
            <button
              key={preset.key}
              onClick={() => applyPreset(preset)}
              aria-pressed={active}
              className={cn(
                "px-3 py-1 rounded-full text-[12px] font-medium transition-all duration-150",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40",
                active
                  ? "bg-white text-gold-dark shadow-sm ring-1 ring-gold/30"
                  : "text-text-secondary hover:text-foreground hover:bg-white/70"
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Calendar trigger */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            /* min-h-[44px] on mobile satisfies Apple/Google 44px touch-target minimum */
            "inline-flex items-center justify-start gap-2 rounded-full px-3 min-h-[44px] md:min-h-0 md:py-1.5",
            "text-left text-xs md:text-sm font-medium transition-all duration-150",
            "bg-white border border-border shadow-sm hover:shadow hover:border-gold/40",
            "text-foreground min-w-0 max-w-[180px] sm:max-w-none",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 text-gold shrink-0" />
          <span className="truncate tabular-nums min-w-0">
            {format(from, "MMM d")} – {format(to, "MMM d, yyyy")}
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-[calc(100vw-2rem)] max-w-[580px] sm:w-auto p-0 rounded-xl shadow-lg border-border/80" align="end">
          {/* Preset list inside popover (mobile + desktop quick-pick) */}
          <div className="flex flex-col gap-1 p-2 border-b border-border bg-muted/30 rounded-t-xl">
            <div className="grid grid-cols-3 md:grid-cols-5 gap-1">
              {presets.map((preset) => {
                const active = activeKey === preset.key;
                return (
                  <button
                    key={preset.key}
                    onClick={() => {
                      applyPreset(preset);
                      setOpen(false);
                    }}
                    className={cn(
                      /* min-h-[44px] on mobile for Apple/Google touch-target guidelines */
                      "px-2 py-2 min-h-[44px] md:min-h-0 md:py-1.5 rounded-md text-[11px] font-medium transition-all duration-150 whitespace-nowrap",
                      active
                        ? "bg-white text-gold-dark shadow-sm ring-1 ring-gold/30"
                        : "text-text-secondary hover:text-foreground hover:bg-white/70"
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-6 md:grid-cols-12 gap-1">
              {MONTH_ABBR.map((label, i) => {
                const active = isMonthActive(i, from, to);
                return (
                  <button
                    key={label}
                    onClick={() => {
                      const range = getMonthRange(i);
                      onChange(range.from, range.to);
                      setOpen(false);
                    }}
                    className={cn(
                      /* min-h-[44px] on mobile for Apple/Google touch-target guidelines */
                      "px-1 py-2 min-h-[44px] md:min-h-0 md:py-1.5 rounded-md text-[11px] font-medium transition-all duration-150",
                      active
                        ? "bg-white text-gold-dark shadow-sm ring-1 ring-gold/30"
                        : "text-text-secondary hover:text-foreground hover:bg-white/70"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-white">
            <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
              From
              {/* font-size 16px on mobile prevents iOS auto-zoom on input focus */}
              <Input
                value={fromText}
                onChange={(e) => setFromText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitOK(); }}
                placeholder="DD/MM/YYYY"
                aria-invalid={!fromValid}
                className="h-8 w-[7.5rem] text-base md:h-7 md:text-xs tabular-nums"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
              To
              {/* font-size 16px on mobile prevents iOS auto-zoom on input focus */}
              <Input
                value={toText}
                onChange={(e) => setToText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitOK(); }}
                placeholder="DD/MM/YYYY"
                aria-invalid={!toValid}
                className="h-8 w-[7.5rem] text-base md:h-7 md:text-xs tabular-nums"
              />
            </label>
            <Button
              size="xs"
              onClick={commitOK}
              disabled={!fromValid && !pendingFrom}
              className="ml-1"
            >
              OK
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Calendar
              mode="range"
              selected={{ from: pendingFrom, to: pendingTo }}
              onSelect={(range) => {
                const pf = range?.from;
                const pt = range?.to;
                setPendingFrom(pf);
                setPendingTo(pt);
                if (pf) setFromText(format(pf, DATE_FMT));
                if (pt) setToText(format(pt, DATE_FMT));
              }}
              numberOfMonths={2}
              className="hidden sm:block"
            />
            <Calendar
              mode="range"
              selected={{ from: pendingFrom, to: pendingTo }}
              onSelect={(range) => {
                const pf = range?.from;
                const pt = range?.to;
                setPendingFrom(pf);
                setPendingTo(pt);
                if (pf) setFromText(format(pf, DATE_FMT));
                if (pt) setToText(format(pt, DATE_FMT));
              }}
              numberOfMonths={1}
              className="sm:hidden"
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
