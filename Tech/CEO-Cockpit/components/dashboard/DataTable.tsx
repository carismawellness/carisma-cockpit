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
import { ArrowUpDown } from "lucide-react";
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

  return (
    <div className="rounded-xl border border-warm-border overflow-hidden">
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-warm-white hover:bg-warm-white">
            {columns.map((col) => (
              <TableHead key={col.key} className={`text-xs font-semibold uppercase tracking-wider text-text-secondary ${col.align === "right" ? "text-right" : ""}`}>
                {col.sortable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8 text-xs uppercase tracking-wider text-text-secondary hover:text-gold"
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    <ArrowUpDown className="ml-2 h-3.5 w-3.5 text-gold/60" />
                  </Button>
                ) : (
                  col.label
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {paged.map((row, i) => (
            <TableRow key={i} className={`hover:bg-gold-bg/50 transition-colors ${onRowClick ? "cursor-pointer" : ""}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((col) => (
                <TableCell key={col.key} className={`text-charcoal ${col.align === "right" ? "text-right tabular-nums" : col.align === "center" ? "text-center" : ""}`}>
                  {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between py-3 px-4 border-t border-warm-border">
          <span className="text-sm text-text-secondary">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="border-warm-border text-text-secondary hover:text-gold hover:border-gold/30"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
              className="border-warm-border text-text-secondary hover:text-gold hover:border-gold/30"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
