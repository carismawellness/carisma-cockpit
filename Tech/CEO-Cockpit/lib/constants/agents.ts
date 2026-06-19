export type AgentBrand = "SPA" | "AESTHETICS" | "SLIMMING";
export type AgentRole  = "Chat" | "SDR";

export interface AgentMeta {
  slug:           string;
  name:           string;
  brand:          AgentBrand;
  role:           AgentRole;
  inactive:       boolean;
  commissionRate: number;   // decimal: 0.01 = 1%
}

export const AGENT_META: AgentMeta[] = [
  // ── SPA ──────────────────────────────────────────────────────────────────
  { slug: "abid",     name: "Abid",     brand: "SPA",        role: "Chat", inactive: false, commissionRate: 0.01  },
  { slug: "km",       name: "K&M",      brand: "SPA",        role: "Chat", inactive: false, commissionRate: 0.01  },
  { slug: "vj",       name: "VJ",       brand: "SPA",        role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "nicci",    name: "Nicci",    brand: "SPA",        role: "SDR",  inactive: true,  commissionRate: 0.01  },
  // ── AESTHETICS ───────────────────────────────────────────────────────────
  { slug: "rana",     name: "Rana",     brand: "AESTHETICS", role: "Chat", inactive: false, commissionRate: 0.015 },
  { slug: "juliana",  name: "Juliana",  brand: "SPA",        role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "nathalia", name: "Nathalia", brand: "AESTHETICS", role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "april",    name: "April",    brand: "AESTHETICS", role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "rey",      name: "Rey",      brand: "AESTHETICS", role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "anni",     name: "Anni",     brand: "AESTHETICS", role: "SDR",  inactive: true,  commissionRate: 0.01  },
  // ── SLIMMING ─────────────────────────────────────────────────────────────
  { slug: "dorianne", name: "Dorianne", brand: "SLIMMING",   role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "queenee",  name: "Queenee",  brand: "SLIMMING",   role: "SDR",  inactive: false, commissionRate: 0.01  },
  { slug: "adeel",    name: "Adeel",    brand: "SLIMMING",   role: "Chat", inactive: true,  commissionRate: 0.01  },
];

export const AGENT_META_BY_SLUG: Record<string, AgentMeta> = Object.fromEntries(
  AGENT_META.map((a) => [a.slug, a])
);

export const BRAND_ORDER: AgentBrand[] = ["SPA", "AESTHETICS", "SLIMMING"];
