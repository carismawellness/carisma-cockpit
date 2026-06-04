"use client";

import { useRouter } from "next/navigation";
import { Bell, LogOut, Menu } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "./DateRangePicker";
import { cn } from "@/lib/utils";

interface TopBarProps {
  dateFrom: Date;
  dateTo: Date;
  onDateChange: (from: Date, to: Date) => void;
  alertCount?: number;
  onMobileMenuOpen?: () => void;
  sidebarCollapsed?: boolean;
  hideDatePicker?: boolean;
}

export function TopBar({
  dateFrom,
  dateTo,
  onDateChange,
  alertCount = 0,
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
      <div className="flex items-center gap-2 shrink min-w-0">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={onMobileMenuOpen}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5 text-muted-foreground" />
        </Button>
        {!hideDatePicker && <DateRangePicker from={dateFrom} to={dateTo} onChange={onDateChange} />}
      </div>
      <div className="flex items-center gap-1 md:gap-3">
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-[18px] w-[18px] text-muted-foreground" />
          {alertCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center">
              {alertCount}
            </span>
          )}
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleLogout}>
          <LogOut className="h-[18px] w-[18px] text-muted-foreground" />
        </Button>
      </div>
    </header>
  );
}
