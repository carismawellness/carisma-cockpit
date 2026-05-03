"use client";

import { useState } from "react";
import { ModuleShell } from "@/components/dashboard/module-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import { TrendLine } from "@/components/dashboard/charts";
import { recordsSeed, type LabMarker } from "@/lib/seed/health/records";
import { cn } from "@/lib/utils";

const STATUS_DOT = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500" };
const TABS = ["Bloodwork", "Imaging", "Screenings", "Meds", "Vaccines", "Family Hx", "Providers"] as const;
type Tab = (typeof TABS)[number];

export default function HealthRecordsPage() {
  const [tab, setTab] = useState<Tab>("Bloodwork");
  const [selectedMarker, setSelectedMarker] = useState<LabMarker | null>(null);
  const s = recordsSeed;
  const flagged = s.labs.markers.filter((m) => m.status !== "green");
  const overdueScreenings = s.screenings.filter((x) => x.status !== "green");

  return (
    <ModuleShell
      pillarId="health"
      moduleSlug="records"
      decision="ApoB up to 88 (red flag) + eye exam overdue → book lipid recheck and optometrist this week"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Last lab draw" value={s.labs.lastDraw.slice(5)} caption={`Next: ${s.labs.nextDue.slice(5)}`} />
        <StatCard label="Markers flagged" value={flagged.length} status={flagged.length === 0 ? "green" : "amber"} />
        <StatCard label="Screenings overdue" value={overdueScreenings.length} status={overdueScreenings.length === 0 ? "green" : "amber"} />
        <StatCard label="Active meds" value={s.medications.filter((x) => x.active).length} />
      </div>

      <div className="border-b border-border flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
              t === tab ? "border-emerald-600 text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Bloodwork" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-4 lg:col-span-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Bloodwork Vault — optimal vs reference</p>
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left py-2">Marker</th>
                  <th className="text-right py-2">Value</th>
                  <th className="text-right py-2">Optimal</th>
                  <th className="text-right py-2">Lab ref</th>
                  <th className="text-center py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {s.labs.markers.map((m) => (
                  <tr key={m.code} onClick={() => setSelectedMarker(m)} className="border-b border-border/50 cursor-pointer hover:bg-accent/40">
                    <td className="py-2 font-medium">{m.name}</td>
                    <td className="text-right">{m.value} <span className="text-xs text-muted-foreground">{m.unit}</span></td>
                    <td className="text-right text-xs text-emerald-700">{m.optimalLow}–{m.optimalHigh}</td>
                    <td className="text-right text-xs text-muted-foreground">{m.refLow}–{m.refHigh}</td>
                    <td className="text-center"><span className={cn("inline-block h-2 w-2 rounded-full", STATUS_DOT[m.status])} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              {selectedMarker ? `${selectedMarker.name} trend` : "ApoB trend (click any marker)"}
            </p>
            <TrendLine
              data={(selectedMarker || s.labs.markers[0]).trend}
              color="#10b981"
              optimalBand={{ low: (selectedMarker || s.labs.markers[0]).optimalLow, high: (selectedMarker || s.labs.markers[0]).optimalHigh }}
              height={200}
            />
          </Card>
        </div>
      )}

      {tab === "Imaging" && (
        <Card className="p-4">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-2">Date</th>
                <th className="text-left py-2">Modality</th>
                <th className="text-left py-2">Region</th>
                <th className="text-left py-2">Facility</th>
                <th className="text-left py-2">Impression</th>
              </tr>
            </thead>
            <tbody>
              {s.imaging.map((x, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2 text-muted-foreground">{x.date}</td>
                  <td className="font-medium">{x.modality}</td>
                  <td className="text-muted-foreground">{x.region}</td>
                  <td className="text-muted-foreground">{x.facility}</td>
                  <td className="text-xs">{x.impression}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "Screenings" && (
        <Card className="p-4">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-2">Test</th>
                <th className="text-left py-2">Last done</th>
                <th className="text-left py-2">Next due</th>
                <th className="text-center py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {s.screenings.map((x) => (
                <tr key={x.name} className="border-b border-border/50">
                  <td className="py-2 font-medium">{x.name}</td>
                  <td className="text-muted-foreground">{x.lastDone || "—"}</td>
                  <td className="text-muted-foreground">{x.nextDue}</td>
                  <td className="text-center"><span className={cn("inline-block h-2 w-2 rounded-full", STATUS_DOT[x.status])} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "Meds" && (
        <Card className="p-4 text-sm text-muted-foreground">
          {s.medications.map((m) => (
            <div key={m.name} className="border-b border-border/50 py-2">
              <div className="font-medium text-foreground">{m.name}</div>
              <div className="text-xs">{m.dose} · {m.indication} · {m.prescriber} · since {m.startDate}</div>
            </div>
          ))}
        </Card>
      )}

      {tab === "Vaccines" && (
        <Card className="p-4">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border"><th className="text-left py-2">Vaccine</th><th className="text-left py-2">Last dose</th><th className="text-left py-2">Next due</th></tr>
            </thead>
            <tbody>
              {s.vaccines.map((v) => (
                <tr key={v.name} className="border-b border-border/50">
                  <td className="py-2 font-medium">{v.name}</td>
                  <td className="text-muted-foreground">{v.date}</td>
                  <td className="text-muted-foreground">{v.nextDue || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "Family Hx" && (
        <Card className="p-4 text-sm">
          {s.familyHistory.map((f) => (
            <div key={f.relative} className="border-b border-border/50 py-2">
              <div className="font-medium">{f.relative}</div>
              <div className="text-xs text-muted-foreground">{f.conditions}</div>
            </div>
          ))}
        </Card>
      )}

      {tab === "Providers" && (
        <Card className="p-4">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border"><th className="text-left py-2">Name</th><th className="text-left py-2">Specialty</th><th className="text-left py-2">Clinic</th><th className="text-left py-2">Last visit</th></tr>
            </thead>
            <tbody>
              {s.providers.map((p) => (
                <tr key={p.name} className="border-b border-border/50">
                  <td className="py-2 font-medium">{p.name}</td>
                  <td className="text-muted-foreground">{p.specialty}</td>
                  <td className="text-muted-foreground">{p.clinic}</td>
                  <td className="text-muted-foreground">{p.lastVisit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </ModuleShell>
  );
}
