import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = "https://gnripfrvcxrakjhiwlxy.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImducmlwZnJ2Y3hyYWtqaGl3bHh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNDc4MzMsImV4cCI6MjA5MTgyMzgzM30.3bXDIXlF0UUmm4r7I2yNBK8zQUnRA0bkK4I0_vX2gUs";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
