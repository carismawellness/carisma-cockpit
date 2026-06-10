export interface DashboardDef {
  key: string;
  label: string;
  group: string;
}

export const DASHBOARDS: DashboardDef[] = [
  { key: "funnel",                     label: "Funnel",                    group: "General"    },
  { key: "hr",                         label: "HR",                        group: "General"    },
  { key: "operations",                 label: "Operations",                group: "General"    },
  { key: "crm",                        label: "CRM",                       group: "Sales"      },
  { key: "sales",                      label: "Sales — Overview",          group: "Sales"      },
  { key: "sales/spa",                  label: "Sales — Spa",               group: "Sales"      },
  { key: "sales/aesthetics",           label: "Sales — Aesthetics",        group: "Sales"      },
  { key: "sales/slimming",             label: "Sales — Slimming",          group: "Sales"      },
  { key: "marketing",                  label: "Marketing — Overview",      group: "Marketing"  },
  { key: "marketing/spa",              label: "Marketing — Spa",           group: "Marketing"  },
  { key: "marketing/aesthetics",       label: "Marketing — Aesthetics",    group: "Marketing"  },
  { key: "marketing/slimming",         label: "Marketing — Slimming",      group: "Marketing"  },
  { key: "finance/ebitda-v2",          label: "EBITDA — Point in Time",    group: "Finance"    },
  { key: "finance/ebitda-longitudinal",label: "EBITDA — Longitudinal",     group: "Finance"    },
  { key: "settings",                   label: "Settings",                  group: "Admin"      },
];

export const DASHBOARD_KEYS = DASHBOARDS.map((d) => d.key);

/** Returns the permission key that governs a given Next.js pathname. */
export function pathToPermissionKey(pathname: string): string | null {
  const path = pathname.replace(/^\//, "");

  if (!path) return "ceo";
  if (["login", "register", "unauthorized"].some((p) => path === p || path.startsWith(p + "/"))) return null;
  if (path.startsWith("api/") || path.startsWith("_next/") || path.startsWith("favicon")) return null;

  // All settings sub-pages share one key
  if (path === "settings" || path.startsWith("settings/")) return "settings";

  // Try longest defined key first to avoid false prefix matches
  const sorted = [...DASHBOARD_KEYS]
    .filter((k) => k !== "settings")
    .sort((a, b) => b.length - a.length);

  for (const key of sorted) {
    if (path === key || path.startsWith(key + "/")) return key;
  }

  // Fallback: first path segment
  return path.split("/")[0] || null;
}
