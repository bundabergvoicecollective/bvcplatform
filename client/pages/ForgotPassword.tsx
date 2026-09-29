import { useState } from "react";

export default function ForgotPassword() {
  const params = new URLSearchParams(window.location.search);
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setMessage(data.message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Bundaberg Voice Collective</h1>
          <p className="text-muted-foreground mt-1">Set up or reset your password</p>
        </div>
        {message ? (
          <div className="rounded-md bg-primary/10 px-4 py-3 text-sm">{message}</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              First time on the new members' site, or forgotten your password? Enter the email address
              you use for BVC and we'll send you a link to choose a password.
            </p>
            {error && (
              <div className="rounded-md bg-destructive/10 text-destructive px-4 py-2 text-sm">{error}</div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="you@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Sending…" : "Email me a link"}
            </button>
          </form>
        )}
        <p className="text-center text-sm text-muted-foreground">
          <a href="/login" className="text-primary underline">Back to sign in</a>
        </p>
      </div>
    </div>
  );
}
