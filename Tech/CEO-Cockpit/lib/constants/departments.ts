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
  type LucideIcon,
} from "lucide-react";

export interface SubItem {
  slug: string;
  label: string;
  path: string;
  icon?: LucideIcon;
}

export interface Department {
  slug: string;
  label: string;
  icon: LucideIcon;
  path: string;
  children?: SubItem[];
}

export const departments: Department[] = [
  { slug: "ceo", label: "CEO", icon: LayoutDashboard, path: "/ceo" },
  { slug: "funnel", label: "Funnel", icon: Filter, path: "/funnel" },
  {
    slug: "sales",
    label: "Sales",
    icon: DollarSign,
    path: "/sales",
    children: [
      { slug: "overview", label: "Overview", path: "/sales", icon: DollarSign },
      { slug: "spa", label: "Spa", path: "/sales/spa", icon: Sparkles },
      { slug: "spa-deepa", label: "Spa - Deepa", path: "/sales/spa-deepa", icon: Sparkles },
      { slug: "aesthetics", label: "Aesthetics", path: "/sales/aesthetics", icon: Heart },
      { slug: "aesthetics-deepa", label: "Aesthetics - Deepa", path: "/sales/aesthetics-deepa", icon: Heart },
      { slug: "slimming", label: "Slimming", path: "/sales/slimming", icon: Activity },
      { slug: "slimming-deepa", label: "Slimming - Deepa", path: "/sales/slimming-deepa", icon: Activity },
      { slug: "crm", label: "CRM", path: "/crm", icon: Headphones },
    ],
  },
  {
    slug: "marketing",
    label: "Marketing",
    icon: Megaphone,
    path: "/marketing",
    children: [
      { slug: "master", label: "Master", path: "/marketing", icon: Megaphone },
      { slug: "spa", label: "Spa", path: "/marketing/spa", icon: Sparkles },
      { slug: "aesthetics", label: "Aesthetics", path: "/marketing/aesthetics", icon: Heart },
      { slug: "slimming", label: "Slimming", path: "/marketing/slimming", icon: Activity },
    ],
  },
  {
    slug: "finance",
    label: "EBITDA",
    icon: TrendingUp,
    path: "/finance/ebitda",
    children: [
      { slug: "ebitda-v1",  label: "EBITDA (V1)",  path: "/finance/ebitda",    icon: TrendingUp },
      { slug: "ebitda-v2",  label: "EBITDA V2",    path: "/finance/ebitda-v2", icon: TrendingUp },
    ],
  },
  {
    slug: "hr",
    label: "HR",
    icon: Users,
    path: "/hr",
  },
  {
    slug: "operations",
    label: "Operations",
    icon: Settings,
    path: "/operations",
  },
  {
    slug: "settings",
    label: "Settings",
    icon: Settings,
    path: "/settings",
    children: [
      { slug: "coa-mapping",         label: "COA Mapping",         path: "/settings/coa-mapping",         icon: BookOpen },
      { slug: "employee-mapping",    label: "Employee Mapping",    path: "/settings/employee-mapping",    icon: Users },
      { slug: "salary-supplement",   label: "Salary Supplement",   path: "/settings/salary-supplement",   icon: BookOpen },
      { slug: "fallback-rules",      label: "Fallback Rules",      path: "/settings/fallback-rules",      icon: BookOpen },
      { slug: "ebitda-v2-rules",     label: "EBITDA V2 Rules",     path: "/settings/ebitda-v2-rules",     icon: BookOpen },
      { slug: "logic-mapping",       label: "Logic Mapping",       path: "/settings/logic-mapping",       icon: BookOpen },
      { slug: "etl-runner",          label: "ETL Runner",          path: "/settings/etl-runner",          icon: RefreshCw },
      { slug: "data-sources",        label: "Data Sources",        path: "/settings/data-sources",        icon: Activity },
    ],
  },
];
