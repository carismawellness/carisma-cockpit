"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    // Check invitation before creating the account
    const checkRes = await fetch(
      `/api/auth/check-invitation?email=${encodeURIComponent(email.trim().toLowerCase())}`
    );
    if (!checkRes.ok) {
      const body = await checkRes.json();
      setError(body.error ?? "This email has not been invited.");
      setLoading(false);
      return;
    }

    const { error: signUpError } = await supabase.auth.signUp({ email, password });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);

    // If email confirmation is disabled in Supabase, redirect immediately
    setTimeout(() => router.push("/ceo"), 1500);
  }

  return (
    <div className="min-h-screen bg-warm-white flex items-center justify-center p-4">
      <Card className="w-full max-w-md rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] border-warm-border">
        <CardHeader className="text-center pt-10 pb-2">
          <h1 className="text-gold font-bold text-3xl tracking-wide">Carisma</h1>
          <p className="text-[11px] font-medium tracking-[0.3em] uppercase text-text-secondary mt-1">Cockpit</p>
          <p className="text-sm text-text-secondary mt-6">Create your account</p>
        </CardHeader>
        <CardContent className="pb-10">
          {done ? (
            <div className="text-center space-y-3">
              <p className="text-emerald-600 text-sm font-medium">Account created — signing you in…</p>
            </div>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
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
                placeholder="Password (min. 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-warm-border focus-visible:ring-gold/30 rounded-lg h-11"
              />
              <Input
                type="password"
                placeholder="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="border-warm-border focus-visible:ring-gold/30 rounded-lg h-11"
              />
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gold hover:bg-gold-dark text-white h-11 rounded-lg font-medium text-sm"
              >
                {loading ? "Creating account…" : "Create Account"}
              </Button>
            </form>
          )}
          <p className="text-center text-xs text-text-secondary mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-gold hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
