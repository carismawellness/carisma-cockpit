import { departments, type Department } from "./departments";

export interface DashboardDef {
  key: string;
  label: string;
  group: string;
}

/**
 * Auto-derives the full permission list from departments.ts.
 * Adding a new route to departments.ts automatically adds it here.
 *
 * Rules:
 * - Leaf dept (no children): one entry, key = path without leading /
 * - singleKey dept: one entry using dept.slug (all sub-pages share that key — e.g. Settings)
 * - Normal dept with children: one entry per child (SubSubItem not expanded — covered by parent key)
 *   Label: just child.label when parent has no path (nav container), else "Parent — Child"
 */
function buildDashboards(depts: Department[]): DashboardDef[] {
  const seen = new Set<string>();
  const result: DashboardDef[] = [];

  for (const dept of depts) {
    const group = dept.group ?? "General";

    if (!dept.children?.length) {
      const key = dept.path.replace(/^\//, "");
      if (key && !seen.has(key)) { seen.add(key); result.push({ key, label: dept.label, group }); }
    } else if (dept.singleKey) {
      const key = dept.slug;
      if (!seen.has(key)) { seen.add(key); result.push({ key, label: dept.label, group }); }
    } else {
      for (const child of dept.children) {
        const key = child.path.replace(/^\//, "");
        if (!key) continue;
        // Nav containers (path: "") use just child.label; real parents prefix it
        const label = !dept.path ? child.label : `${dept.label} — ${child.label}`;
        if (!seen.has(key)) { seen.add(key); result.push({ key, label, group }); }

        // Recurse into SubSubItem (e.g. individual agent pages)
        if (child.children?.length) {
          for (const sub of child.children) {
            const subKey = sub.path.replace(/^\//, "");
            if (!subKey) continue;
            const subLabel = `${child.label} — ${sub.label}`;
            if (!seen.has(subKey)) { seen.add(subKey); result.push({ key: subKey, label: subLabel, group }); }
          }
        }
      }
    }
  }

  return result;
}

export const DASHBOARDS: DashboardDef[] = buildDashboards(departments);
export const DASHBOARD_KEYS = DASHBOARDS.map((d) => d.key);

/** Returns the permission key that governs a given Next.js pathname. */
export function pathToPermissionKey(pathname: string): string | null {
  const path = pathname.replace(/^\//, "");

  if (!path) return null;
  if (["login", "register", "unauthorized"].some((p) => path === p || path.startsWith(p + "/"))) return null;
  if (path.startsWith("api/") || path.startsWith("_next/") || path.startsWith("favicon")) return null;

  // singleKey departments: all sub-pages share one umbrella key.
  // NOTE: if you add a new singleKey dept in departments.ts, add a case here too.
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
