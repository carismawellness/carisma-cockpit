import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://praceahubcvbrewuqejh.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByYWNlYWh1YmN2YnJld3VxZWpoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjE2NTEzOCwiZXhwIjoyMDkxNzQxMTM4fQ.sp3c1FogKB9Dr4xlNBAZEr3QMEKH9XKQiu-RgJe12us";

export function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}
