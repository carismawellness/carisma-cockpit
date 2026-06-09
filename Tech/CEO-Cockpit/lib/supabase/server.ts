import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    "https://praceahubcvbrewuqejh.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYWNlYWh1YmN2YnJld3VxZWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNjUxMzgsImV4cCI6MjA5MTc0MTEzOH0.85_0sUC3ExlfMR7EFNm_YUgMJ3VFo6PJBRlkPh5q_v4",
    {
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
    }
  );
}
