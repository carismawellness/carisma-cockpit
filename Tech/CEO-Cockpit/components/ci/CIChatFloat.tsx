"use client";

import { useState, useEffect } from "react";
import { Bot, X, Minus } from "lucide-react";
import { CIChat } from "./CIChat";
import { cn } from "@/lib/utils";

export function CIChatFloat() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    function handleOpen() {
      setOpen(true);
      setMinimized(false);
    }
    function handleClose() {
      setOpen(false);
      setMinimized(false);
    }
    window.addEventListener("open-ci-chat", handleOpen);
    window.addEventListener("close-ci-chat", handleClose);
    return () => {
      window.removeEventListener("open-ci-chat", handleOpen);
      window.removeEventListener("close-ci-chat", handleClose);
    };
  }, []);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 pb-safe z-50 h-14 w-14 rounded-full bg-gold text-white shadow-lg hover:bg-gold-dark transition-all hover:scale-105 flex items-center justify-center"
        style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
        aria-label="Open Carisma Intelligence"
      >
        <Bot className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed z-50 flex flex-col bg-white shadow-2xl border border-warm-border overflow-hidden transition-all",
        minimized
          ? "right-6 w-72 h-14 rounded-2xl"
          : "bottom-0 right-0 w-full h-[70vh] rounded-t-2xl sm:right-6 sm:w-[420px] sm:h-[520px] sm:rounded-2xl"
      )}
      style={
        minimized
          ? { bottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }
          : { paddingBottom: "env(safe-area-inset-bottom, 0px)" }
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-warm-border bg-warm-white shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-gold/10 flex items-center justify-center">
            <Bot className="h-4 w-4 text-gold" />
          </div>
          <span className="text-sm font-semibold text-charcoal">Carisma Intelligence</span>
        </div>
        <div className="flex items-center gap-1">
          {/* min 44px touch targets on mobile; reset to 28px on md+ */}
          <button
            onClick={() => setMinimized(!minimized)}
            className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 md:h-7 md:w-7 rounded-lg flex items-center justify-center text-text-secondary hover:bg-warm-gray hover:text-charcoal transition-colors"
            aria-label={minimized ? "Expand" : "Minimize"}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setOpen(false); setMinimized(false); }}
            className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 md:h-7 md:w-7 rounded-lg flex items-center justify-center text-text-secondary hover:bg-warm-gray hover:text-charcoal transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Chat body — hidden when minimized */}
      {!minimized && (
        <div className="flex-1 overflow-hidden">
          <CIChat embedded />
        </div>
      )}
    </div>
  );
}
