import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = "https://praceahubcvbrewuqejh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYWNlYWh1YmN2YnJld3VxZWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNjUxMzgsImV4cCI6MjA5MTc0MTEzOH0.85_0sUC3ExlfMR7EFNm_YUgMJ3VFo6PJBRlkPh5q_v4";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
