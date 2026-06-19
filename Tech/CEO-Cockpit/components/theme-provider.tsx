"use client";

import { createContext, useContext, useEffect } from "react";

type Theme = "light" | "dark";

/**
 * Theme is pinned to light. Dark mode rendered near-invisible text because
 * dashboard content hardcodes light-gray palettes (UX audit, Jun 2026).
 * Plumbing is kept so a proper dark theme can be reintroduced later:
 * defaultTheme="light", enableSystem=false, no toggle exposed.
 */
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Clear any stale dark preference from before the light-only pin.
    document.documentElement.classList.remove("dark");
    try {
      localStorage.setItem("theme", "light");
    } catch {
      /* storage unavailable — ignore */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: "light", toggle: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
