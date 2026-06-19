import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-warm-white flex items-center justify-center p-4">
      <Card className="w-full max-w-md rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] border-warm-border">
        <CardHeader className="text-center pt-10 pb-2">
          <h1 className="text-gold font-bold text-3xl tracking-wide">Carisma</h1>
          <p className="text-[11px] font-medium tracking-[0.3em] uppercase text-text-secondary mt-1">Cockpit</p>
        </CardHeader>
        <CardContent className="pb-10 text-center space-y-3">
          <p className="text-sm font-medium text-charcoal">Access is by invitation only.</p>
          <p className="text-sm text-text-secondary">
            Your account is created by an admin. Contact your manager to get access — you'll receive login credentials directly.
          </p>
          <Link href="/login" className="inline-block text-sm text-gold hover:underline font-medium mt-2">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
