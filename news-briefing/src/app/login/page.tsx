"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Wrong password.");
        setSubmitting(false);
        return;
      }
      router.replace(from);
    } catch {
      setError("Couldn't reach the server.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm rounded-2xl bg-surface shadow-card p-7"
    >
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
        Sign in
      </h1>
      <p className="mt-1 text-[14px] text-ink-muted">
        Enter your password to continue.
      </p>
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-5 w-full rounded-xl border border-surface-line bg-surface-tint px-4 py-3 text-[15px] text-ink focus:outline-none focus:border-accent"
        placeholder="Password"
      />
      {error && (
        <p className="mt-3 text-[13px] text-[#d70015]">{error}</p>
      )}
      <button
        type="submit"
        disabled={submitting || password.length === 0}
        className="pressable mt-5 w-full rounded-xl bg-accent px-5 py-3 text-[15px] font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-5">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
