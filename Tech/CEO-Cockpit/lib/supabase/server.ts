import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// The anon key is public by design — the literals below are safe fallbacks so
// the server client keeps working even if the env vars aren't set in Vercel.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://gnripfrvcxrakjhiwlxy.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImducmlwZnJ2Y3hyYWtqaGl3bHh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNDc4MzMsImV4cCI6MjA5MTgyMzgzM30.3bXDIXlF0UUmm4r7I2yNBK8zQUnRA0bkK4I0_vX2gUs";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from Server Component — ignored
        }
      },
    },
  });
}
