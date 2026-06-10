"use client";

import { ReactNode, Suspense, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useDateRange } from "@/lib/hooks/useDateRange";
import { cn } from "@/lib/utils";

interface DashboardShellProps {
  children: (props: {
    dateFrom: Date;
    dateTo: Date;
    brandFilter: string | null;
  }) => ReactNode;
  hideDatePicker?: boolean;
}

function DashboardShellInner({ children, hideDatePicker }: DashboardShellProps) {
  const { from, to, setRange } = useDateRange();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <TopBar
        dateFrom={from}
        dateTo={to}
        onDateChange={setRange}
        onMobileMenuOpen={() => setMobileOpen(true)}
        sidebarCollapsed={collapsed}
        hideDatePicker={hideDatePicker}
      />
      <main
        className={cn(
          /* pb-safe ensures content is never hidden behind iPhone home indicator bar */
          "pt-[4.25rem] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pt-[4.25rem] md:px-6 md:pb-6 space-y-4 md:space-y-6 transition-all duration-200",
          "ml-0",
          collapsed ? "lg:ml-[4.5rem]" : "lg:ml-60"
        )}
      >
        {/* A render error in any chart/section degrades to a card instead of white-screening the page */}
        <ErrorBoundary>
          {children({ dateFrom: from, dateTo: to, brandFilter: null })}
        </ErrorBoundary>
      </main>
    </div>
  );
}

export function DashboardShell(props: DashboardShellProps) {
  // useDateRange (via useSearchParams) and Sidebar nav links require a
  // Suspense boundary in Next.js App Router — without it the build fails.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <DashboardShellInner {...props} />
    </Suspense>
  );
}
