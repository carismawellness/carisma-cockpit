import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://praceahubcvbrewuqejh.supabase.co";

export function getAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(SUPABASE_URL, key);
}
