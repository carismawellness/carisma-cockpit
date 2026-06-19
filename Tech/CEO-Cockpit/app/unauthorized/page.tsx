"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function UnauthorizedPage() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-warm-white flex items-center justify-center p-4">
      <div className="text-center space-y-5 max-w-sm">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-red-50 flex items-center justify-center">
          <ShieldOff className="h-7 w-7 text-red-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-charcoal">Access Restricted</h1>
          <p className="text-sm text-text-secondary mt-2">
            You don&apos;t have permission to view this page. Contact your administrator to request access.
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <Button
            variant="outline"
            onClick={handleSignOut}
            className="border-warm-border text-text-secondary hover:bg-warm-gray rounded-lg text-sm"
          >
            Sign Out
          </Button>
          <Link href="/login">
            <Button className="bg-gold hover:bg-gold-dark text-white rounded-lg text-sm">
              Back to Login
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
