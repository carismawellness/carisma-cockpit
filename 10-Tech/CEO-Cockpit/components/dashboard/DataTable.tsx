"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: Record<string, unknown>[];
  pageSize?: number;
  onRowClick?: (row: Record<string, unknown>) => void;
}

export function DataTable({ columns, data, pageSize = 10, onRowClick }: DataTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = sortKey
    ? [...data].sort((a, b) => {
        const aVal = a[sortKey] as number;
        const bVal = b[sortKey] as number;
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      })
    : data;

  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(data.length / pageSize);
  const rangeStart = page * pageSize + 1;
  const rangeEnd = Math.min((page + 1) * pageSize, data.length);

  return (
    <div className="rounded-xl border border-warm-border overflow-hidden bg-card">
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-warm-gray/70 hover:bg-warm-gray/70 border-b border-warm-border">
            {columns.map((col) => (
              <TableHead key={col.key} className={`h-10 text-[11px] font-bold uppercase tracking-[0.08em] text-text-secondary whitespace-nowrap ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}>
                {col.sortable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`-ml-3 h-8 text-[11px] font-bold uppercase tracking-[0.08em] hover:text-gold hover:bg-transparent ${
                      sortKey === col.key ? "text-gold" : "text-text-secondary"
                    }`}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === "asc"
                        ? <ArrowUp className="ml-1.5 h-3 w-3 text-gold" />
                        : <ArrowDown className="ml-1.5 h-3 w-3 text-gold" />
                    ) : (
                      <ArrowUpDown className="ml-1.5 h-3 w-3 text-gold/40" />
                    )}
                  </Button>
                ) : (
                  col.label
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {paged.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-20 text-center text-sm text-text-secondary">
                No data for this period.
              </TableCell>
            </TableRow>
          )}
          {paged.map((row, i) => (
            <TableRow
              key={i}
              className={`border-warm-border/60 transition-colors hover:bg-gold-bg/60 ${
                i % 2 === 1 ? "bg-warm-white/60" : ""
              } ${onRowClick ? "cursor-pointer" : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <TableCell key={col.key} className={`py-2.5 text-[13px] text-charcoal ${col.align === "right" ? "text-right tabular-nums" : col.align === "center" ? "text-center" : ""}`}>
                  {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between py-2.5 px-4 border-t border-warm-border bg-warm-white/60">
          <span className="text-xs text-text-secondary tabular-nums">
            Showing <span className="font-semibold text-charcoal">{rangeStart}–{rangeEnd}</span> of{" "}
            <span className="font-semibold text-charcoal">{data.length}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              aria-label="Previous page"
              className="h-7 w-7 p-0 border-warm-border text-text-secondary hover:text-gold hover:border-gold/30 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-text-secondary tabular-nums px-1">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
              aria-label="Next page"
              className="h-7 w-7 p-0 border-warm-border text-text-secondary hover:text-gold hover:border-gold/30 disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
