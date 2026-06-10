"use client";

import { useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "./DateRangePicker";
import { SyncStatusWidget } from "./SyncStatusWidget";
import { cn } from "@/lib/utils";

interface TopBarProps {
  dateFrom: Date;
  dateTo: Date;
  onDateChange: (from: Date, to: Date) => void;
  onMobileMenuOpen?: () => void;
  sidebarCollapsed?: boolean;
  hideDatePicker?: boolean;
}

export function TopBar({
  dateFrom,
  dateTo,
  onDateChange,
  onMobileMenuOpen,
  sidebarCollapsed = false,
  hideDatePicker = false,
}: TopBarProps) {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header
      className={cn(
        "h-14 bg-card/80 backdrop-blur-md border-b border-border flex items-center justify-between px-3 md:px-6 fixed top-0 right-0 z-30 transition-all duration-200",
        "left-0",
        sidebarCollapsed ? "lg:left-[4.5rem]" : "lg:left-60"
      )}
    >
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0 min-h-[44px] min-w-[44px]"
          onClick={onMobileMenuOpen}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5 text-muted-foreground" />
        </Button>
        {!hideDatePicker && (
          <div className="min-w-0 overflow-hidden">
            <DateRangePicker from={dateFrom} to={dateTo} onChange={onDateChange} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 md:gap-3 shrink-0">
        {/* Sync status widget — shows last sync + sync trigger */}
        <SyncStatusWidget />
        {/* min 44px touch target on mobile, reset to 36px on md+ */}
        <Button
          variant="ghost"
          size="icon"
          className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 md:h-9 md:w-9"
          onClick={handleLogout}
          aria-label="Log out"
        >
          <LogOut className="h-[18px] w-[18px] text-muted-foreground" />
        </Button>
      </div>
    </header>
  );
}
