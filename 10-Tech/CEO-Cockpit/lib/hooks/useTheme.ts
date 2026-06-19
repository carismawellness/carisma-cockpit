"use client";
import { useState, useEffect } from "react";

export function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("cockpit-theme");
    if (saved === "dark") {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  function toggle() {
    setDark((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
        localStorage.setItem("cockpit-theme", "dark");
      } else {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("cockpit-theme", "light");
      }
      return next;
    });
  }

  return { dark, toggle };
}
