import { useState } from "react";
import { useLocation } from "wouter";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    if (password !== confirm) return setError("The two passwords don't match");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save password");
      window.location.href = "/dashboard";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save password");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Bundaberg Voice Collective</h1>
          <p className="text-muted-foreground mt-1">Choose your password</p>
        </div>
        {!token ? (
          <div className="space-y-4 text-center text-sm">
            <p>This link is incomplete. Please request a new one.</p>
            <button onClick={() => navigate("/forgot-password")} className="text-primary underline">
              Get a new link
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 text-destructive px-4 py-2 text-sm">
                {error}{" "}
                {error.includes("expired") && (
                  <a href="/forgot-password" className="underline">Get a new link</a>
                )}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="password">New password</label>
              <input id="password" type="password" required minLength={8} autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass}
                placeholder="At least 8 characters" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="confirm">Confirm password</label>
              <input id="confirm" type="password" required minLength={8} autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {loading ? "Saving…" : "Save password and sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
