"use client";

import { cn } from "@/lib/utils";

interface LocationFilterProps {
  selected: string | null;
  onChange: (location: string | null) => void;
  availableLocations?: string[];
}

const DEFAULT_LOCATIONS = [
  "Inter",
  "Hugos",
  "Hyatt",
  "Ramla",
  "Riviera",
  "Sunny",
  "Excelsior",
  "Novotel",
  "Riviera",
  "Odycy",
];

export function LocationFilter({
  selected,
  onChange,
  availableLocations,
}: LocationFilterProps) {
  const locations = availableLocations ?? DEFAULT_LOCATIONS;

  return (
    <div className="flex flex-wrap items-center gap-1 bg-warm-gray rounded-lg p-1">
      <button
        onClick={() => onChange(null)}
        className={cn(
          "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
          selected === null
            ? "bg-gold text-white shadow-sm"
            : "text-text-secondary hover:text-charcoal"
        )}
      >
        All
      </button>
      {locations.map((location) => (
        <button
          key={location}
          onClick={() => onChange(location)}
          className={cn(
            "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
            selected === location
              ? "bg-gold text-white shadow-sm"
              : "text-text-secondary hover:text-charcoal"
          )}
        >
          {location}
        </button>
      ))}
    </div>
  );
}
