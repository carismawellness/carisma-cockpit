import { createClient } from "@supabase/supabase-js";

export function getAdminClient() {
  return createClient(
    "https://praceahubcvbrewuqejh.supabase.co",
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
