import {
  Megaphone,
  DollarSign,
  Headphones,
  Users,
  User,
  Settings,
  Activity,
  TrendingUp,
  Sparkles,
  Heart,
  Filter,
  BookOpen,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";

export interface SubSubItem {
  slug: string;
  label: string;
  path: string;
  icon?: LucideIcon;
}

export interface SubItem {
  slug: string;
  label: string;
  path: string;
  icon?: LucideIcon;
  children?: SubSubItem[];
}

export interface Department {
  slug: string;
  label: string;
  icon: LucideIcon;
  path: string;
  /** Permission group label shown in User Access UI */
  group?: string;
  /** If true, all children share one permission key (dept.slug) — e.g. Settings */
  singleKey?: boolean;
  children?: SubItem[];
}

export const departments: Department[] = [
  {
    slug: "todo",
    label: "To Do",
    icon: ClipboardList,
    path: "",
    group: "General",
    children: [
      { slug: "funnel",     label: "Funnel",     path: "/funnel",     icon: Filter },
      { slug: "hr",         label: "HR",         path: "/hr",         icon: Users },
      { slug: "operations", label: "Operations", path: "/operations", icon: Settings },
    ],
  },
  {
    slug: "sales",
    label: "Sales",
    icon: DollarSign,
    path: "/sales/spa",
    group: "Sales",
    children: [
      { slug: "spa", label: "Spa", path: "/sales/spa", icon: Sparkles },
      { slug: "aesthetics", label: "Aesthetics", path: "/sales/aesthetics", icon: Heart },
      { slug: "slimming", label: "Slimming", path: "/sales/slimming", icon: Activity },
    ],
  },
  {
    slug: "crm",
    label: "CRM",
    icon: Headphones,
    path: "/crm",
    group: "CRM",
    children: [
      { slug: "crm-overview", label: "Overview", path: "/crm", icon: Headphones },
      {
        slug: "crm-individual",
        label: "Agent KPIs",
        path: "/crm/individual",
        icon: Users,
        children: [
          { slug: "agent-abid",     label: "Abid",     path: "/crm/individual/abid",     icon: User },
          { slug: "agent-rana",     label: "Rana",     path: "/crm/individual/rana",     icon: User },
          { slug: "agent-nathalia", label: "Nathalia", path: "/crm/individual/nathalia", icon: User },
          { slug: "agent-adeel",    label: "Adeel",    path: "/crm/individual/adeel",    icon: User },
          { slug: "agent-km",       label: "K&M",      path: "/crm/individual/km",       icon: User },
          { slug: "agent-vj",       label: "VJ",       path: "/crm/individual/vj",       icon: User },
          { slug: "agent-dorianne", label: "Dorianne", path: "/crm/individual/dorianne", icon: User },
          { slug: "agent-juliana",  label: "Juliana",  path: "/crm/individual/juliana",  icon: User },
          { slug: "agent-anni",     label: "Anni",     path: "/crm/individual/anni",     icon: User },
          { slug: "agent-nicci",    label: "Nicci",    path: "/crm/individual/nicci",    icon: User },
          { slug: "agent-april",    label: "April",    path: "/crm/individual/april",    icon: User },
          { slug: "agent-queenee",  label: "Queenee",  path: "/crm/individual/queenee",  icon: User },
        ],
      },
    ],
  },
  {
    slug: "marketing",
    label: "Marketing",
    icon: Megaphone,
    path: "/marketing",
    group: "Marketing",
    children: [
      { slug: "marketing-master",     label: "Master",     path: "/marketing",            icon: Megaphone },
      { slug: "marketing-spa",        label: "Spa",        path: "/marketing/spa",        icon: Sparkles  },
      { slug: "marketing-aesthetics", label: "Aesthetics", path: "/marketing/aesthetics", icon: Heart     },
      { slug: "marketing-slimming",   label: "Slimming",   path: "/marketing/slimming",   icon: Activity  },
    ],
  },
  {
    slug: "finance",
    label: "EBITDA",
    icon: TrendingUp,
    path: "/finance/ebitda-v2",
    group: "Finance",
    children: [
      { slug: "ebitda-point-in-time",  label: "Point in Time",  path: "/finance/ebitda-v2",            icon: TrendingUp },
      { slug: "ebitda-longitudinal",   label: "Longitudinal",   path: "/finance/ebitda-longitudinal",  icon: TrendingUp },
    ],
  },
  {
    slug: "settings",
    label: "Settings",
    icon: Settings,
    path: "/settings",
    group: "Admin",
    singleKey: true,
    children: [
      { slug: "ebitda-rules",   label: "EBITDA Rules",   path: "/settings/ebitda-rules",   icon: BookOpen },
      { slug: "ebitda-mapping", label: "EBITDA Mapping", path: "/settings/ebitda-mapping", icon: BookOpen },
      { slug: "data-sources",   label: "Data Sources",    path: "/settings/data-sources",   icon: Activity },
      { slug: "user-access",    label: "User Access",    path: "/settings/user-access",    icon: Users },
    ],
  },
];
