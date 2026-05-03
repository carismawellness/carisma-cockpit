"use client";

import { useState } from "react";
import { ModuleShell } from "@/components/dashboard/module-shell";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const CEO_URL = process.env.NEXT_PUBLIC_CEO_COCKPIT_URL || "https://cockpit-run.vercel.app";

const SECTIONS = [
  { slug: "ceo", label: "CEO" },
  { slug: "sales", label: "Sales" },
  { slug: "crm", label: "CRM" },
  { slug: "finance", label: "Finance" },
  { slug: "funnel", label: "Funnel" },
  { slug: "marketing", label: "Marketing" },
  { slug: "operations", label: "Operations" },
  { slug: "hr", label: "HR" },
];

export default function BusinessPage() {
  const [section, setSection] = useState("ceo");
  const src = `${CEO_URL}/${section}`;
  return (
    <ModuleShell
      pillarId="wealth"
      moduleSlug="business"
      decision="Group revenue €1.2M MTD, +8% YoY — full breakdown in Finance tab"
    >
      <div className="flex items-center justify-between border-b border-border">
        <div className="flex gap-1 overflow-x-auto">
          {SECTIONS.map((s) => (
            <button
              key={s.slug}
              type="button"
              onClick={() => setSection(s.slug)}
              className={cn(
                "px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
                s.slug === section ? "border-slate-700 text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2"
        >
          Open <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <iframe
        key={src}
        src={src}
        title="CEO Cockpit"
        className="w-full border border-border rounded-md bg-white"
        style={{ height: "calc(100vh - 320px)", minHeight: 600 }}
      />

      <p className="text-[11px] text-muted-foreground">
        First load? You may need to sign in to CEO Cockpit once. Same Supabase account as this app.
      </p>
    </ModuleShell>
  );
}
