import { PillarOverview } from "@/components/dashboard/pillar-overview";
import { getPillar } from "@/lib/pillars";

export default function LoveOverviewPage() {
  return (
    <PillarOverview
      pillar={getPillar("love")}
      northStar={{
        metric: "1:1 conversations ≥30 min / 30d",
        value: "11",
        trend: "▼ 3 vs target 14",
      }}
    />
  );
}
