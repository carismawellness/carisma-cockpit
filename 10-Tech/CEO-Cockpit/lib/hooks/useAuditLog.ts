"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function useAuditLog() {
  const pathname = usePathname();

  useEffect(() => {
    // Log page view
    fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "page_view",
        page: pathname,
      }),
    }).catch(() => {}); // Silent fail — audit should never break the app
  }, [pathname]);
}
