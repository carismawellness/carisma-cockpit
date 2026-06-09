import {
  LayoutDashboard,
  Megaphone,
  DollarSign,
  Headphones,
  Users,
  Settings,
  Activity,
  TrendingUp,
  Sparkles,
  Heart,
  Filter,
  BookOpen,
  RefreshCw,
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
  children?: SubItem[];
}

export const departments: Department[] = [
  {
    slug: "todo",
    label: "To Do",
    icon: ClipboardList,
    path: "",
    children: [
      { slug: "ceo",        label: "CEO",        path: "/ceo",        icon: LayoutDashboard },
      { slug: "funnel",     label: "Funnel",     path: "/funnel",     icon: Filter },
      {
        slug: "marketing",
        label: "Marketing",
        path: "/marketing",
        icon: Megaphone,
        children: [
          { slug: "marketing-master",     label: "Master",     path: "/marketing",            icon: Megaphone },
          { slug: "marketing-spa",        label: "Spa",        path: "/marketing/spa",        icon: Sparkles  },
          { slug: "marketing-aesthetics", label: "Aesthetics", path: "/marketing/aesthetics", icon: Heart     },
          { slug: "marketing-slimming",   label: "Slimming",   path: "/marketing/slimming",   icon: Activity  },
        ],
      },
      { slug: "hr",         label: "HR",         path: "/hr",         icon: Users },
      { slug: "operations", label: "Operations", path: "/operations", icon: Settings },
    ],
  },
  {
    slug: "sales",
    label: "Sales",
    icon: DollarSign,
    path: "/sales",
    children: [
      { slug: "overview", label: "Overview", path: "/sales", icon: DollarSign },
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
    children: [
      { slug: "crm-overview",    label: "Overview",        path: "/crm",            icon: Headphones },
      { slug: "crm-individual",  label: "Individual KPIs", path: "/crm/individual", icon: Users },
    ],
  },
  {
    slug: "finance",
    label: "EBITDA",
    icon: TrendingUp,
    path: "/finance/ebitda-v2",
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
    children: [
      { slug: "ebitda-rules",   label: "EBITDA Rules",   path: "/settings/ebitda-rules",   icon: BookOpen },
      { slug: "ebitda-mapping", label: "EBITDA Mapping", path: "/settings/ebitda-mapping", icon: BookOpen },
      { slug: "data-sources",   label: "EBITDA Sources",  path: "/settings/data-sources",   icon: Activity },
      { slug: "user-access",    label: "User Access",    path: "/settings/user-access",    icon: Users },
      { slug: "data-sync",      label: "Data Sync",      path: "/settings/etl-runner",     icon: RefreshCw },
    ],
  },
];
