export type AgentBrand = "SPA" | "AESTHETICS" | "SLIMMING";
export type AgentRole  = "Chat" | "SDR";

export interface AgentMeta {
  slug:     string;
  name:     string;
  brand:    AgentBrand;
  role:     AgentRole;
  inactive: boolean;
}

export const AGENT_META: AgentMeta[] = [
  // ── SPA ──────────────────────────────────────────────────────────────────
  { slug: "abid",     name: "Abid",     brand: "SPA",        role: "Chat", inactive: false },
  { slug: "km",       name: "K&M",      brand: "SPA",        role: "Chat", inactive: false },
  { slug: "vj",       name: "VJ",       brand: "SPA",        role: "Chat", inactive: false },
  { slug: "nicci",    name: "Nicci",    brand: "SPA",        role: "Chat", inactive: true  },
  // ── AESTHETICS ───────────────────────────────────────────────────────────
  { slug: "rana",     name: "Rana",     brand: "AESTHETICS", role: "Chat", inactive: false },
  { slug: "juliana",  name: "Juliana",  brand: "AESTHETICS", role: "SDR",  inactive: false },
  { slug: "nathalia", name: "Nathalia", brand: "AESTHETICS", role: "SDR",  inactive: false },
  { slug: "april",    name: "April",    brand: "AESTHETICS", role: "SDR",  inactive: false },
  { slug: "anni",     name: "Anni",     brand: "AESTHETICS", role: "SDR",  inactive: true  },
  // ── SLIMMING ─────────────────────────────────────────────────────────────
  { slug: "dorianne", name: "Dorianne", brand: "SLIMMING",   role: "SDR",  inactive: false },
  { slug: "queenee",  name: "Queenee",  brand: "SLIMMING",   role: "SDR",  inactive: false },
  { slug: "adeel",    name: "Adeel",    brand: "SLIMMING",   role: "SDR",  inactive: true  },
];

export const AGENT_META_BY_SLUG: Record<string, AgentMeta> = Object.fromEntries(
  AGENT_META.map((a) => [a.slug, a])
);

export const BRAND_ORDER: AgentBrand[] = ["SPA", "AESTHETICS", "SLIMMING"];
