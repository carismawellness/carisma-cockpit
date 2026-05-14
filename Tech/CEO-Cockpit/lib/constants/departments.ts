import {
  LayoutDashboard,
  Megaphone,
  DollarSign,
  Headphones,
  PiggyBank,
  Users,
  Settings,
  Activity,
  TrendingUp,
  Sparkles,
  Heart,
  Filter,
  BookOpen,
  Layers,
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
    label: "Finance",
    icon: PiggyBank,
    path: "/finance",
    children: [
      { slug: "ebitda", label: "EBITDA Overview", path: "/finance/ebitda", icon: TrendingUp },
      { slug: "ebitda-group", label: "Group EBITDA", path: "/finance/ebitda/group", icon: Layers },
      { slug: "ebitda-spa", label: "EBITDA Spa", path: "/finance/ebitda/spa", icon: Sparkles },
      { slug: "ebitda-aesthetics", label: "EBITDA Aesthetics", path: "/finance/ebitda/aesthetics", icon: Heart },
      { slug: "ebitda-slimming", label: "EBITDA Slimming", path: "/finance/ebitda/slimming", icon: Activity },
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
      { slug: "coa-mapping",        label: "COA Mapping",        path: "/settings/coa-mapping",        icon: BookOpen },
      { slug: "salary-supplement",   label: "Salary Supplement",   path: "/settings/salary-supplement",   icon: BookOpen },
    ],
  },
];
