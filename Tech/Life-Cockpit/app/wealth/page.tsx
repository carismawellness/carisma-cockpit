import { PillarOverview } from "@/components/dashboard/pillar-overview";
import { getPillar } from "@/lib/pillars";

export default function WealthOverviewPage() {
  return (
    <PillarOverview
      pillar={getPillar("wealth")}
      northStar={{
        metric: "Years of Freedom (liquid NW ÷ burn)",
        value: "3.2 yrs",
        trend: "▲ 0.4 vs YE 2025",
      }}
    />
  );
}
