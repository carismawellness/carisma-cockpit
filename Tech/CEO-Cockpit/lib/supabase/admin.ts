import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://gnripfrvcxrakjhiwlxy.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImducmlwZnJ2Y3hyYWtqaGl3bHh5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjI0NzgzMywiZXhwIjoyMDkxODIzODMzfQ.kb_qbeaKU1NK1_Ie3GubD_WKVCFi9GV528132xFhCnQ";

export function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}
