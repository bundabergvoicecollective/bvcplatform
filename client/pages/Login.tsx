import { useEffect, useState } from "react";
import { useLocation } from "wouter";

/**
 * What a provider redirect can come back with. The server sends a code rather
 * than a sentence so nothing from Google or Facebook is echoed into the page.
 */
const OAUTH_ERRORS: Record<string, string> = {
  denied: "That account is not an approved member. Please speak to Andy.",
  unverified:
    "Your email address is not confirmed with that provider, so we cannot match you to your membership. Please sign in with your email and password instead.",
  "google-no-email": "Google did not share an email address, so we cannot find your membership. Please sign in with your email and password instead.",
  "facebook-no-email":
    "Facebook did not share an email address — this happens on accounts that sign in with a phone number. Please sign in with your email and password instead.",
  state: "That sign-in took too long or was interrupted. Please try again.",
  nocode: "That sign-in did not complete. Please try again.",
  unconfigured: "That sign-in option is not set up yet. Please use your email and password.",
  provider: "We could not complete that sign-in. Please try again, or use your email and password.",
  server: "Something went wrong at our end. Please try your email and password.",
};

export default function Login() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<Record<string, boolean>>({});

  // Which buttons to show is the server's business — a provider whose secrets
  // are unset must not be offered, or members tap it and get an error.
  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => (r.ok ? r.json() : {}))
      .then(setProviders)
      .catch(() => setProviders({}));
  }, []);

  // A failed provider round trip comes back as /login?error=<code>.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (!code) return;
    setError(OAUTH_ERRORS[code] ?? OAUTH_ERRORS.provider);
    window.history.replaceState({}, "", "/login");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "NO_PASSWORD") {
          navigate(`/forgot-password?email=${encodeURIComponent(email)}`);
          return;
        }
        throw new Error(data.error ?? "Login failed");
      }
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Bundaberg Voice Collective</h1>
          <p className="text-muted-foreground mt-1">Sign in to your account</p>
        </div>
        {/* Provider buttons come first: a member already signed in to Google
            on their phone gets in with one tap and no password to remember.
            Plain links, not fetch — the browser has to leave the page. */}
        {(providers.google || providers.facebook) && (
          <div className="space-y-3">
            {providers.google && (
              <a
                href="/api/auth/google"
                className="flex w-full items-center justify-center gap-3 rounded-md border border-input bg-background px-4 py-3 text-sm font-medium hover:bg-accent"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86a5.3 5.3 0 0 1-4.98-3.66H1.02v2.34A8.99 8.99 0 0 0 9 18Z" />
                  <path fill="#FBBC05" d="M4.02 10.76a5.4 5.4 0 0 1 0-3.52V4.9H1.02a9 9 0 0 0 0 8.2l3-2.34Z" />
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A8.99 8.99 0 0 0 1.02 4.9l3 2.34A5.3 5.3 0 0 1 9 3.58Z" />
                </svg>
                Continue with Google
              </a>
            )}
            {providers.facebook && (
              <a
                href="/api/auth/facebook"
                className="flex w-full items-center justify-center gap-3 rounded-md border border-input bg-background px-4 py-3 text-sm font-medium hover:bg-accent"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true">
                  <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.93-1.95 1.88v2.28h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z" />
                </svg>
                Continue with Facebook
              </a>
            )}
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or use your email</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 text-destructive px-4 py-2 text-sm">
              {error}
            </div>
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
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="rounded-md border border-input px-4 py-3 text-sm text-center">
          <span className="font-medium">First time on the new site?</span>{" "}
          <a href="/forgot-password" className="text-primary underline">Set up / forgot password</a>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <a href="/register" className="text-primary underline">Register</a>
        </p>
      </div>
    </div>
  );
}
