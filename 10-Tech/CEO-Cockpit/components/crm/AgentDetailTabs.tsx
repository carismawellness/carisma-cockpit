"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CrmAgent } from "@/lib/hooks/useCrmAgents";
import { AgentDetailPanel } from "@/components/crm/AgentDetailPanel";

interface AgentDetailTabsProps {
  agents: CrmAgent[];
}

export function AgentDetailTabs({ agents }: AgentDetailTabsProps) {
  const agentsWithData = agents.filter((a) => a.totals.total_sales > 0 || a.rows.length > 0);
  const displayAgents  = agentsWithData.length > 0 ? agentsWithData : agents;

  const [activeSlug, setActiveSlug] = useState<string>(
    displayAgents[0]?.slug ?? ""
  );

  if (displayAgents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-muted-foreground">
        No data for selected period — run the ETL sync first
      </div>
    );
  }

  const activeAgent = displayAgents.find((a) => a.slug === activeSlug) ?? displayAgents[0];

  return (
    <Tabs value={activeSlug} onValueChange={setActiveSlug}>
      <TabsList className="h-auto flex-wrap gap-1 bg-muted p-1">
        {displayAgents.map((agent) => (
          <TabsTrigger key={agent.slug} value={agent.slug} className="text-xs">
            {agent.name}
          </TabsTrigger>
        ))}
      </TabsList>

      {displayAgents.map((agent) => (
        <TabsContent key={agent.slug} value={agent.slug}>
          {activeAgent.slug === agent.slug && <AgentDetailPanel agent={agent} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}
