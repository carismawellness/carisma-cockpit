import { PillarOverview } from "@/components/dashboard/pillar-overview";
import { getPillar } from "@/lib/pillars";

export default function HealthOverviewPage() {
  return (
    <PillarOverview
      pillar={getPillar("health")}
      northStar={{
        metric: "VO2 max (mL/kg/min)",
        value: "48.2",
        trend: "▲ 1.6 vs 6mo · top 8% for age",
      }}
    />
  );
}
