"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function useKeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Number keys 1-7 for department navigation
      const routes = ["/marketing", "/sales", "/finance", "/hr", "/operations", "/data"];
      const num = parseInt(e.key);
      if (num >= 1 && num <= 7 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        router.push(routes[num - 1]);
        return;
      }

      // / to focus CI chat (dispatch custom event)
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("open-ci-chat"));
        return;
      }

      // Escape to close CI chat
      if (e.key === "Escape") {
        window.dispatchEvent(new CustomEvent("close-ci-chat"));
        return;
      }

      // ? to show shortcuts help
      if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-shortcuts-help"));
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);
}
