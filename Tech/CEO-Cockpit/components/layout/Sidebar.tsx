"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { departments, type Department, type SubItem } from "@/lib/constants/departments";
import { pathToPermissionKey } from "@/lib/constants/dashboards";
import { cn } from "@/lib/utils";
import { ChevronsLeft, ChevronsRight, ChevronDown, X, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

function filterDepartments(depts: Department[], keys: Set<string>, isAdmin: boolean): Department[] {
  if (isAdmin) return depts;
  return depts
    .map((dept) => {
      if (!dept.children || dept.children.length === 0) {
        const key = pathToPermissionKey(dept.path);
        return key && keys.has(key) ? dept : null;
      }
      const visibleChildren = dept.children.filter((child) => {
        const key = pathToPermissionKey(child.path);
        return key && keys.has(key);
      });
      if (visibleChildren.length === 0) return null;
      return { ...dept, children: visibleChildren };
    })
    .filter(Boolean) as Department[];
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function SubNavItem({
  child,
  pathname,
  onMobileClose,
}: {
  child: SubItem;
  pathname: string;
  onMobileClose: () => void;
}) {
  const isActive = pathname === child.path;
  const isSubActive = child.children?.some((s) => pathname === s.path) ?? false;
  const [open, setOpen] = useState(isActive || isSubActive);
  const ChildIcon = child.icon;

  if (isActive || isSubActive) { if (!open) setOpen(true); }

  return (
    <div>
      <div
        className={cn(
          "w-full flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-all pr-1",
          isActive || isSubActive
            ? "text-gold bg-gold-bg/40"
            : "text-text-secondary hover:bg-warm-gray hover:text-charcoal"
        )}
      >
        <Link
          href={child.path}
          onClick={onMobileClose}
          className="flex items-center gap-2.5 px-3 py-2 flex-1 min-w-0"
        >
          {ChildIcon && (
            <ChildIcon className={cn("h-[15px] w-[15px] shrink-0", isActive || isSubActive ? "text-gold" : "text-text-secondary")} />
          )}
          <span className="truncate flex-1 text-left">{child.label}</span>
        </Link>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
          aria-label={open ? "Collapse" : "Expand"}
          className="p-1.5 rounded-md hover:bg-warm-gray cursor-pointer"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", open ? "rotate-0" : "-rotate-90")} />
        </button>
      </div>
      {open && child.children && (
        <div className="ml-3 pl-3 border-l border-warm-border space-y-0.5 mt-0.5">
          {child.children.map((sub) => {
            const subActive = pathname === sub.path;
            const SubIcon = sub.icon;
            return (
              <Link
                key={sub.slug}
                href={sub.path}
                onClick={onMobileClose}
                className={cn(
                  "flex items-center gap-2 rounded-lg text-[12px] font-medium transition-all px-2.5 py-1.5",
                  subActive
                    ? "bg-gold-bg text-gold"
                    : "text-text-secondary hover:bg-warm-gray hover:text-charcoal"
                )}
              >
                {SubIcon && (
                  <SubIcon className={cn("h-[13px] w-[13px] shrink-0", subActive ? "text-gold" : "text-text-secondary")} />
                )}
                {sub.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavItem({
  dept,
  pathname,
  collapsed,
  onMobileClose,
}: {
  dept: Department;
  pathname: string;
  collapsed: boolean;
  onMobileClose: () => void;
}) {
  const isActive = pathname === dept.path;
  const isChildActive = dept.children?.some((c) =>
    pathname === c.path || c.children?.some((s) => pathname === s.path)
  ) ?? false;
  const isExpanded = isActive || isChildActive;
  const [open, setOpen] = useState(isExpanded);

  const Icon = dept.icon;
  const hasChildren = dept.children && dept.children.length > 0;

  // Keep open state in sync when navigating
  if (isExpanded && !open) setOpen(true);

  if (!hasChildren) {
    return (
      <Link
        href={dept.path}
        title={collapsed ? dept.label : undefined}
        onClick={onMobileClose}
        className={cn(
          "flex items-center rounded-lg text-sm font-medium transition-all",
          collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-4 py-2.5",
          isActive
            ? "border-l-[3px] border-gold bg-gold-bg text-gold"
            : "text-text-secondary hover:bg-warm-gray hover:text-charcoal"
        )}
      >
        <Icon className={cn("h-[18px] w-[18px] shrink-0", isActive ? "text-gold" : "text-text-secondary")} />
        {!collapsed && dept.label}
      </Link>
    );
  }

  // Parent with children — label navigates, chevron toggles expand/collapse
  return (
    <div>
      <div
        className={cn(
          "flex items-center rounded-lg text-sm font-medium transition-all",
          isActive
            ? "border-l-[3px] border-gold bg-gold-bg text-gold"
            : isChildActive
              ? "text-gold"
              : "text-text-secondary hover:bg-warm-gray hover:text-charcoal"
        )}
      >
        <Link
          href={dept.path}
          title={collapsed ? dept.label : undefined}
          onClick={onMobileClose}
          className={cn(
            "flex-1 flex items-center min-w-0",
            collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-4 py-2.5"
          )}
        >
          <Icon className={cn("h-[18px] w-[18px] shrink-0", (isActive || isChildActive) ? "text-gold" : "text-text-secondary")} />
          {!collapsed && <span className="truncate flex-1 text-left">{dept.label}</span>}
        </Link>
        {!collapsed && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
            aria-label={open ? `Collapse ${dept.label}` : `Expand ${dept.label}`}
            className="p-2 mr-1 rounded-md hover:bg-warm-gray/60 transition-colors"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-200",
                open ? "rotate-0" : "-rotate-90"
              )}
            />
          </button>
        )}
      </div>

      {/* Children */}
      {!collapsed && open && dept.children && (
        <div className="ml-4 pl-4 border-l border-warm-border space-y-0.5 mt-0.5">
          {dept.children.map((child) => {
            if (child.children && child.children.length > 0) {
              return (
                <SubNavItem
                  key={child.slug}
                  child={child}
                  pathname={pathname}
                  onMobileClose={onMobileClose}
                />
              );
            }
            const childActive = pathname === child.path;
            const ChildIcon = child.icon;
            return (
              <Link
                key={child.slug}
                href={child.path}
                onClick={onMobileClose}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-all px-3 py-2",
                  childActive
                    ? "bg-gold-bg text-gold"
                    : "text-text-secondary hover:bg-warm-gray hover:text-charcoal"
                )}
              >
                {ChildIcon && (
                  <ChildIcon className={cn("h-[15px] w-[15px] shrink-0", childActive ? "text-gold" : "text-text-secondary")} />
                )}
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [visibleDepts, setVisibleDepts] = useState<Department[]>(departments);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch("/api/me/permissions")
      .then((r) => r.json())
      .then(({ isAdmin, keys }: { isAdmin: boolean; keys: string[] }) => {
        setVisibleDepts(filterDepartments(departments, new Set(keys), isAdmin));
      })
      .catch(() => setVisibleDepts(departments));
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "??";

  const sidebarContent = (
    <aside
      className={cn(
        "h-screen bg-warm-white flex flex-col fixed left-0 top-0 z-40 border-r border-warm-border transition-all duration-200",
        collapsed ? "w-[4.5rem]" : "w-60"
      )}
    >
      {/* Logo */}
      <div className={cn("border-b border-warm-border flex items-center", collapsed ? "p-3 justify-center" : "p-6 justify-between")}>
        <div className={collapsed ? "text-center" : ""}>
          <h1 className={cn("text-gold font-bold tracking-wide", collapsed ? "text-base" : "text-xl")}>
            {collapsed ? "C" : "Carisma"}
          </h1>
          {!collapsed && (
            <p className="text-[10px] font-medium tracking-[0.25em] uppercase text-text-secondary mt-0.5">
              Cockpit
            </p>
          )}
        </div>
        {/* min 44px touch target on mobile (Apple/Google guideline) */}
        <button
          onClick={onMobileClose}
          className="lg:hidden min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center text-text-secondary hover:bg-warm-gray hover:text-charcoal transition-colors"
          aria-label="Close sidebar"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          onClick={onToggle}
          className={cn(
            "hidden lg:flex h-7 w-7 rounded-lg items-center justify-center text-text-secondary hover:bg-warm-gray hover:text-charcoal transition-colors",
            collapsed && "mt-1"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {visibleDepts.map((dept) => (
          <NavItem
            key={dept.slug}
            dept={dept}
            pathname={pathname}
            collapsed={collapsed}
            onMobileClose={onMobileClose}
          />
        ))}
      </nav>

      {/* User section */}
      <div className={cn("border-t border-warm-border", collapsed ? "p-2" : "p-3")}>
        <div className={cn("flex items-center", collapsed ? "flex-col gap-1" : "gap-2")}>
          <div className="h-8 w-8 rounded-full bg-gold/10 flex items-center justify-center text-gold text-xs font-semibold shrink-0">
            {initials}
          </div>
          {!collapsed && (
            <p className="text-xs text-charcoal truncate flex-1 min-w-0">{userEmail ?? "…"}</p>
          )}
          {/* min 44px touch target on mobile (Apple/Google guideline); desktop keeps 28px */}
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 lg:h-7 lg:w-7 rounded-md flex items-center justify-center text-text-secondary hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        {sidebarContent}
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={onMobileClose}
            aria-label="Close sidebar"
          />
          <aside className="relative h-screen w-60 bg-warm-white flex flex-col border-r border-warm-border z-50">
            {/* Logo */}
            <div className="border-b border-warm-border flex items-center p-6 justify-between">
              <div>
                <h1 className="text-gold font-bold tracking-wide text-xl">Carisma</h1>
                <p className="text-[10px] font-medium tracking-[0.25em] uppercase text-text-secondary mt-0.5">
                  Cockpit
                </p>
              </div>
              {/* min 44px touch target on mobile */}
              <button
                onClick={onMobileClose}
                className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center text-text-secondary hover:bg-warm-gray hover:text-charcoal transition-colors"
                aria-label="Close sidebar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
              {departments.map((dept) => (
                <NavItem
                  key={dept.slug}
                  dept={dept}
                  pathname={pathname}
                  collapsed={false}
                  onMobileClose={onMobileClose}
                />
              ))}
            </nav>

            {/* User section */}
            <div className="border-t border-warm-border p-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-gold/10 flex items-center justify-center text-gold text-xs font-semibold shrink-0">
                  {initials}
                </div>
                <p className="text-xs text-charcoal truncate flex-1 min-w-0">{userEmail ?? "…"}</p>
                {/* min 44px touch target on mobile */}
                <button
                  onClick={handleSignOut}
                  title="Sign out"
                  className="min-h-[44px] min-w-[44px] rounded-md flex items-center justify-center text-text-secondary hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
