import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { pathToPermissionKey, DASHBOARD_KEYS } from "@/lib/constants/dashboards";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "contact@mertgulen.com,admin@cockpit.local,123@cockpit.local,mert@carismaspa.com")
  .split(",")
  .map((e) => e.trim().toLowerCase());

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    "https://gnripfrvcxrakjhiwlxy.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImducmlwZnJ2Y3hyYWtqaGl3bHh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNDc4MzMsImV4cCI6MjA5MTgyMzgzM30.3bXDIXlF0UUmm4r7I2yNBK8zQUnRA0bkK4I0_vX2gUs",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public paths — no auth required
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/unauthorized") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico";

  if (isPublic) return supabaseResponse;

  // Not authenticated → redirect to login
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const email = (user.email ?? "").toLowerCase();

  // Admin has unrestricted access
  if (ADMIN_EMAILS.includes(email)) return supabaseResponse;

  // ── Check invitation status ────────────────────────────────────────────────
  const { data: invitation } = await supabase
    .from("user_invitations")
    .select("is_active")
    .eq("email", email)
    .single();

  if (!invitation?.is_active) {
    const url = request.nextUrl.clone();
    url.pathname = "/unauthorized";
    return NextResponse.redirect(url);
  }

  // ── Check dashboard permission ─────────────────────────────────────────────
  const permKey = pathToPermissionKey(pathname);

  if (permKey) {
    const { data: perm } = await supabase
      .from("user_dashboard_permissions")
      .select("has_access")
      .eq("email", email)
      .eq("dashboard_key", permKey)
      .single();

    if (!perm?.has_access) {
      // Find the first dashboard this user can access and redirect there
      const { data: allowed } = await supabase
        .from("user_dashboard_permissions")
        .select("dashboard_key")
        .eq("email", email)
        .eq("has_access", true)
        .order("dashboard_key")
        .limit(1);

      const firstKey = allowed?.[0]?.dashboard_key;
      const url = request.nextUrl.clone();

      if (firstKey && DASHBOARD_KEYS.includes(firstKey)) {
        url.pathname = `/${firstKey}`;
      } else {
        url.pathname = "/unauthorized";
      }

      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
