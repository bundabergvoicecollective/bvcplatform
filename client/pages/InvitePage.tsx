import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";
import { Users, CheckCircle2, XCircle, Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type Stage = "loading" | "sending" | "enter_code" | "verified" | "accepting" | "done" | "error";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();

  const [stage, setStage] = useState<Stage>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteExpiry, setInviteExpiry] = useState<Date | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Fetch invite info
  const inviteQuery = trpc.invites.get.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: false }
  );

  const sendCodeMutation = trpc.invites.sendCode.useMutation({
    onSuccess: () => {
      setStage("enter_code");
      startCooldown();
    },
    onError: (err) => {
      setErrorMsg(err.message);
      setStage("error");
    },
  });

  const verifyCodeMutation = trpc.invites.verifyCode.useMutation({
    onSuccess: () => {
      setStage("verified");
    },
    onError: (err) => {
      setCodeError(err.message);
      setCode("");
    },
  });

  const acceptMutation = trpc.invites.accept.useMutation({
    onSuccess: () => {
      setStage("done");
      toast.success("Welcome to Bundaberg Voice Collective!");
      setTimeout(() => navigate("/dashboard"), 1800);
    },
    onError: (err) => {
      setErrorMsg(err.message);
      setStage("error");
    },
  });

  const startCooldown = () => {
    setResendCooldown(60);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current!); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  // Once invite loads, decide what stage to show
  useEffect(() => {
    if (inviteQuery.data && stage === "loading") {
      const inv = inviteQuery.data;
      setInviteEmail(inv.email);
      setInviteExpiry(new Date(inv.expiresAt));
      // If already email-verified (e.g. page refresh), skip straight to verified
      if (inv.emailVerifiedAt) {
        setStage("verified");
      } else if (inv.codeExpiresAt && new Date(inv.codeExpiresAt) > new Date()) {
        // A valid code was already sent — go straight to entry form without re-sending
        setStage("enter_code");
        // Start the resend cooldown so they can't spam, but don't send a new code
        startCooldown();
      } else {
        // No code yet (or expired) — send a fresh one
        setStage("sending");
        sendCodeMutation.mutate({ token: token ?? "" });
      }
    }
    if (inviteQuery.error) {
      setErrorMsg(inviteQuery.error.message);
      setStage("error");
    }
  }, [inviteQuery.data, inviteQuery.error]);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (code.length === 6 && stage === "enter_code" && !verifyCodeMutation.isPending) {
      setCodeError("");
      verifyCodeMutation.mutate({ token: token ?? "", code });
    }
  }, [code]);

  // Auto-accept once user is authenticated (after email verified + OAuth)
  useEffect(() => {
    if (!authLoading && user && stage === "verified" && !acceptMutation.isPending) {
      setStage("accepting");
      acceptMutation.mutate({ token: token ?? "" });
    }
  }, [authLoading, user, stage]);

  const handleResend = () => {
    if (resendCooldown > 0) return;
    setCode("");
    setCodeError("");
    sendCodeMutation.mutate({ token: token ?? "" });
  };

  /**
   * The last step of being invited.
   *
   * Not a tRPC mutation: this one sets the session cookie, and the tRPC client
   * is already holding query results from when there was no session. A plain
   * POST followed by a full page load is the only way to be sure the app comes
   * up signed in rather than half-signed-in.
   */
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setSaveError("Please use at least 8 characters.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/auth/invite-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: token ?? "", password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not finish setting up your account");
      toast.success("Welcome to Bundaberg Voice Collective!");
      window.location.href = "/dashboard";
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not finish setting up your account");
      setSaving(false);
    }
  };

  const formatExpiry = (d: Date | null) =>
    d ? d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : "—";

  const bgStyle = { background: "oklch(0.12 0.04 240)" };

  // ── Loading / sending ──────────────────────────────────────────────────────
  if (stage === "loading" || stage === "sending") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={bgStyle}>
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: "oklch(0.78 0.17 75)" }} />
          <p className="text-sm" style={{ color: "oklch(0.65 0.02 240)" }}>
            {stage === "loading" ? "Loading your invitation…" : "Sending verification code to your email…"}
          </p>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (stage === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={bgStyle}>
        <Card className="w-full max-w-md border-0 shadow-xl">
          <CardContent className="flex flex-col items-center gap-4 py-12 px-8 text-center">
            <XCircle className="w-12 h-12" style={{ color: "oklch(0.55 0.18 25)" }} />
            <h1 className="text-xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>Invite Unavailable</h1>
            <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>{errorMsg}</p>
            {/* An already-used invite means the account exists, so sending
                them to the administrator for a new one is the wrong advice
                and another dead end. */}
            {/already been used/i.test(errorMsg) ? (
              <Button
                className="font-semibold"
                style={{ background: "oklch(0.78 0.17 75)", color: "oklch(0.12 0.04 240)" }}
                onClick={() => { window.location.href = "/login"; }}
              >
                Sign in instead
              </Button>
            ) : (
              <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>
                Please ask your choir administrator for a new invitation.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (stage === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={bgStyle}>
        <Card className="w-full max-w-md border-0 shadow-xl">
          <CardContent className="flex flex-col items-center gap-4 py-12 px-8 text-center">
            <CheckCircle2 className="w-12 h-12" style={{ color: "oklch(0.55 0.14 185)" }} />
            <h1 className="text-xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>Welcome aboard!</h1>
            <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
              You've joined Bundaberg Voice Collective. Taking you to your dashboard…
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Accepting ──────────────────────────────────────────────────────────────
  if (stage === "accepting") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={bgStyle}>
        <Card className="w-full max-w-md border-0 shadow-xl">
          <CardContent className="flex flex-col items-center gap-4 py-12 px-8 text-center">
            <Loader2 className="w-10 h-10 animate-spin" style={{ color: "oklch(0.55 0.14 185)" }} />
            <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>Completing your membership…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Enter OTP ──────────────────────────────────────────────────────────────
  if (stage === "enter_code") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={bgStyle}>
        <Card className="w-full max-w-md border-0 shadow-xl">
          <CardContent className="flex flex-col items-center gap-6 py-12 px-8">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "oklch(0.78 0.17 75)" }}
            >
              <Mail className="w-8 h-8 text-white" />
            </div>

            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
                Check your email
              </h1>
              <p className="text-base font-semibold" style={{ color: "oklch(0.55 0.14 185)" }}>
                Bundaberg Voice Collective
              </p>
              <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                We sent a 6-digit verification code to
              </p>
              <p className="font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>{inviteEmail}</p>
            </div>

            <div className="flex flex-col items-center gap-3 w-full">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={setCode}
                disabled={verifyCodeMutation.isPending}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>

              {verifyCodeMutation.isPending && (
                <div className="flex items-center gap-2 text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                  <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
                </div>
              )}

              {codeError && (
                <p className="text-sm text-destructive text-center">{codeError}</p>
              )}
            </div>

            <div className="text-center space-y-1">
              <p className="text-sm" style={{ color: "oklch(0.65 0.02 240)" }}>Didn't receive it?</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResend}
                disabled={resendCooldown > 0 || sendCodeMutation.isPending}
              >
                {resendCooldown > 0
                  ? `Resend in ${resendCooldown}s`
                  : sendCodeMutation.isPending ? "Sending…" : "Resend code"}
              </Button>
            </div>

            <p className="text-xs text-center" style={{ color: "oklch(0.65 0.02 240)" }}>
              Code expires in 30 minutes. Check your spam folder if you don't see it.
              {inviteExpiry && <><br />Invite expires: {formatExpiry(inviteExpiry)}</>}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }


  // ── Verified — choose a password, which is the last step ───────────────────
  //
  // This is where four invited people stopped. The code proved they read the
  // mailbox, and then the page sent them to the sign-in screen to enter "your
  // email and password" — a password nobody had ever given them, for an
  // account that did not exist yet, because an invite creates a token and two
  // emails and no user row. The only way through was to guess that "forgot
  // password" was meant for them; and that was a dead end too, because the
  // reset form looks for a member, finds nobody, and says a link is on its
  // way. Two of them asked for one tonight and are still waiting.
  //
  // So the password is set here, in the same sitting, one field, while they
  // are still holding the phone that received the code.
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={bgStyle}>
      <Card className="w-full max-w-md border-0 shadow-xl">
        <CardContent className="flex flex-col items-center gap-6 py-12 px-8 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "oklch(0.55 0.14 185)" }}
          >
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
              Email verified!
            </h1>
            <p className="text-base font-semibold" style={{ color: "oklch(0.55 0.14 185)" }}>
              Bundaberg Voice Collective
            </p>
            <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
              {user
                ? "Your email has been confirmed. Completing your membership…"
                : "One last step: choose a password. You'll use it with your email address to sign in from now on."}
            </p>
          </div>

          {inviteEmail && (
            <p className="text-xs px-3 py-1.5 rounded-full" style={{ background: "oklch(0.94 0.03 185)", color: "oklch(0.35 0.10 185)" }}>
              Invite for: {inviteEmail}
            </p>
          )}

          {user ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              Completing membership…
            </div>
          ) : (
            <form onSubmit={handleSetPassword} className="w-full space-y-3 text-left">
              <label className="block">
                <span className="text-sm font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>
                  Choose a password
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setSaveError(""); }}
                  autoComplete="new-password"
                  autoFocus
                  disabled={saving}
                  placeholder="At least 8 characters"
                  className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>

              {/* One field, not two. A confirm box is the commonest place for
                  somebody to get stuck on a phone keyboard; being able to read
                  what you typed solves the same problem without the trap. */}
              <label className="flex items-center gap-2 text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  className="w-4 h-4"
                />
                Show password
              </label>

              {saveError && <p className="text-sm text-destructive">{saveError}</p>}

              <Button
                type="submit"
                className="w-full font-semibold text-base py-5"
                style={{ background: "oklch(0.78 0.17 75)", color: "oklch(0.12 0.04 240)" }}
                disabled={password.length < 8 || saving}
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Setting up your account…</>
                ) : (
                  "Finish and sign in"
                )}
              </Button>

              <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>
                Already set a password? <a href="/login" className="underline">Sign in instead</a>.
              </p>
            </form>
          )}

          {inviteExpiry && (
            <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>
              Invite expires: {formatExpiry(inviteExpiry)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
