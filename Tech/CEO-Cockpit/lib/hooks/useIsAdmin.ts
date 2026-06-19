"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isAdminEmail } from "@/lib/auth/admins";

export interface IsAdminResult {
  isAdmin: boolean;
  isLoaded: boolean;
  email: string | null;
}

export function useIsAdmin(): IsAdminResult {
  const [state, setState] = useState<IsAdminResult>({
    isAdmin: false,
    isLoaded: false,
    email: null,
  });

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      const email = user?.email ?? null;
      setState({ isAdmin: isAdminEmail(email), isLoaded: true, email });
    });
  }, []);

  return state;
}
