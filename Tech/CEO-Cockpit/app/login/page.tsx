"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/ceo");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-warm-white flex items-center justify-center p-4">
      <Card className="w-full max-w-md rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] border-warm-border">
        <CardHeader className="text-center pt-10 pb-2">
          <h1 className="text-gold font-bold text-3xl tracking-wide">Carisma</h1>
          <p className="text-[11px] font-medium tracking-[0.3em] uppercase text-text-secondary mt-1">Cockpit</p>
          <p className="text-sm text-text-secondary mt-6">Sign in to your account</p>
        </CardHeader>
        <CardContent className="pb-10">
          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="border-warm-border focus-visible:ring-gold/30 rounded-lg h-11"
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="border-warm-border focus-visible:ring-gold/30 rounded-lg h-11"
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gold hover:bg-gold-dark text-white h-11 rounded-lg font-medium text-sm"
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
          <p className="text-center text-xs text-text-secondary mt-6">
            Need an account?{" "}
            <Link href="/register" className="text-gold hover:underline font-medium">
              Create one
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
