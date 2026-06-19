import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { pathToPermissionKey, DASHBOARD_KEYS } from "@/lib/constants/dashboards";
import { isAdminEmail } from "@/lib/auth/admins";

// The anon key is public by design — the literals below are safe fallbacks so
// the middleware keeps working even if the env vars aren't set in Vercel.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://gnripfrvcxrakjhiwlxy.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImducmlwZnJ2Y3hyYWtqaGl3bHh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNDc4MzMsImV4cCI6MjA5MTgyMzgzM30.3bXDIXlF0UUmm4r7I2yNBK8zQUnRA0bkK4I0_vX2gUs";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // ── API auth policy ────────────────────────────────────────────────────────
  if (pathname.startsWith("/api/")) {
    // Public API routes — no session required:
    //  - /api/webhooks/* verify provider signatures in-route (GHL HMAC, Zoho)
    //  - /api/cron/*     verify CRON_SECRET / x-vercel-cron in-route
    //  - /api/callback + /api/auth/check-invitation are needed pre-login
    const isPublicApi =
      pathname.startsWith("/api/webhooks/") ||
      pathname.startsWith("/api/cron/") ||
      pathname === "/api/callback" ||
      pathname === "/api/auth/check-invitation";

    if (isPublicApi) return supabaseResponse;

    // A valid browser session works for every API route.
    if (user) return supabaseResponse;

    // ETL triggers: also accept `Authorization: Bearer ${CRON_SECRET}`
    // (used by the nightly cron fan-out and the owner's manual curl).
    if (pathname.startsWith("/api/etl/")) {
      const cronSecret = process.env.CRON_SECRET;
      const authHeader = request.headers.get("authorization");
      if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
        return supabaseResponse;
      }
      // DELIBERATE FAIL-OPEN (logged): internal orchestrators that we don't
      // own here — /api/etl/revenue-refresh's fan-out and
      // /api/settings/data-sources' re-sync trigger — call /api/etl/* routes
      // server-to-server with neither cookies nor a bearer token. Returning
      // 401 here would silently break the nightly data refresh. Once those
      // callers forward `Authorization: Bearer ${CRON_SECRET}`, replace this
      // branch with a 401 response.
      console.warn(
        `[SECURITY] Unauthenticated request allowed to ${pathname} — set CRON_SECRET and forward it from internal ETL callers to lock this down.`
      );
      return supabaseResponse;
    }

    // Everything else under /api/* requires a session. JSON 401, no redirect.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Page auth policy ───────────────────────────────────────────────────────

  // Public paths — no auth required
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/unauthorized") ||
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
  if (isAdminEmail(email)) return supabaseResponse;

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

  // ── Sales-employee self-access ─────────────────────────────────────────────
  // A mapped sales employee may always view their own personal dashboard, even
  // with zero dashboard permissions (mapping lives in sales_employees.user_email).
  const empMatch = pathname.match(
    /^\/sales\/(spa|aesthetics|slimming)\/employees\/([^/]+)\/?$/
  );
  if (empMatch) {
    const { data: emp } = await supabase
      .from("sales_employees")
      .select("id")
      .eq("user_email", email)
      .eq("brand_slug", empMatch[1])
      .eq("slug", decodeURIComponent(empMatch[2]))
      .maybeSingle();
    if (emp) return supabaseResponse;
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
        // Mapped sales employees with no dashboard permissions land on their
        // own personal dashboard instead of /unauthorized.
        const { data: selfEmp } = await supabase
          .from("sales_employees")
          .select("brand_slug, slug")
          .eq("user_email", email)
          .eq("is_active", true)
          .limit(1);
        const se = selfEmp?.[0];
        url.pathname = se
          ? `/sales/${se.brand_slug}/employees/${se.slug}`
          : "/unauthorized";
      }

      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
