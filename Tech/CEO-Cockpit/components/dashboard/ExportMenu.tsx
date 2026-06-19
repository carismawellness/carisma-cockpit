"use client";

import { useState } from "react";
import { Download, FileText, Table2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportMenuProps {
  pageTitle: string;
  kpiData?: Record<string, unknown>[];
  tableData?: Record<string, unknown>[];
}

export function ExportMenu({ pageTitle, kpiData, tableData }: ExportMenuProps) {
  const [open, setOpen] = useState(false);

  function exportPDF() {
    window.print();
    setOpen(false);
  }

  function exportCSV(data: Record<string, unknown>[], filename: string) {
    if (!data || data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(","),
      ...data.map((row) => headers.map((h) => {
        const val = row[h];
        const str = String(val ?? "");
        return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(","))
    ];

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        className="text-xs text-text-secondary hover:text-gold gap-1"
      >
        <Download className="h-3.5 w-3.5" />
        Export
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-white dark:bg-[#162535] rounded-xl shadow-lg border border-warm-border p-1.5">
            <button
              onClick={exportPDF}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-charcoal hover:bg-warm-gray transition-colors"
            >
              <Printer className="h-4 w-4 text-text-secondary" />
              Print / PDF
            </button>
            {kpiData && kpiData.length > 0 && (
              <button
                onClick={() => exportCSV(kpiData, `${pageTitle}-kpis`)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-charcoal hover:bg-warm-gray transition-colors"
              >
                <FileText className="h-4 w-4 text-text-secondary" />
                KPIs as CSV
              </button>
            )}
            {tableData && tableData.length > 0 && (
              <button
                onClick={() => exportCSV(tableData, `${pageTitle}-data`)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-charcoal hover:bg-warm-gray transition-colors"
              >
                <Table2 className="h-4 w-4 text-text-secondary" />
                Table as CSV
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
