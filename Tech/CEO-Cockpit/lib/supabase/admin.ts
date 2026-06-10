import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://gnripfrvcxrakjhiwlxy.supabase.co";

export function getAdminClient() {
  // Service-role key MUST come from the environment — never hardcode it.
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}
