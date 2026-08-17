"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { login, signup } = useAuth();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await signup(email, name, password);
      }
      router.push("/");
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-8">
          <Logo size={40} />
          <h1 className="text-lg font-semibold text-ink">Request Assistant</h1>
          <p className="text-sm text-text-secondary">
            {mode === "login" ? "Sign in to continue" : "Create an account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-panel border border-hairline rounded-xl shadow-sm p-6 space-y-4">
          {mode === "signup" && (
            <label className="block">
              <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full text-sm rounded-md border border-hairline px-3 py-2 text-ink outline-none focus:border-ink-muted"
              />
            </label>
          )}

          <label className="block">
            <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full text-sm rounded-md border border-hairline px-3 py-2 text-ink outline-none focus:border-ink-muted"
            />
          </label>

          <label className="block">
            <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full text-sm rounded-md border border-hairline px-3 py-2 text-ink outline-none focus:border-ink-muted"
            />
          </label>

          {error && <p className="text-xs text-warning-strong">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2 rounded-md bg-ink text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="text-center text-xs text-text-secondary mt-4">
          {mode === "login" ? (
            <>
              Don't have an account?{" "}
              <button type="button" onClick={() => { setMode("signup"); setError(null); }} className="text-ink font-medium underline">
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => { setMode("login"); setError(null); }} className="text-ink font-medium underline">
                Sign in
              </button>
            </>
          )}
        </p>

        {mode === "signup" && (
          <p className="text-center text-[11px] text-text-tertiary mt-4">
            New accounts start as Requesters. Approver access is granted separately.
          </p>
        )}

        <p className="text-center text-[11px] text-text-tertiary mt-6">
          Demo accounts: requester@acme-demo.com / approver@acme-demo.com — password demo1234
        </p>
      </div>
    </div>
  );
}
