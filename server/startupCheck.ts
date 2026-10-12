/**
 * Boot-time configuration check, imported for its side effect.
 *
 * It has to run before anything that pulls in `db.ts`, because that module
 * throws on an unset `DATABASE_URL` while it is being imported — a bare stack
 * trace that names one variable, from a process that `tsx watch` then keeps
 * alive, so it reads as a hang rather than as missing config.
 *
 * Two classes of variable, treated differently on purpose:
 *
 *   - Required: the process exits, naming everything that is missing at once.
 *     Without `DATABASE_URL` nothing works; without `JWT_SECRET` the server
 *     boots and serves pages, then throws when it signs a session, which looks
 *     like a login bug rather than a configuration one.
 *   - Everything else: one line per feature that is now unavailable.
 *     `_core/env.ts` gives every value a fallback so a missing secret degrades
 *     a feature instead of stopping boot. That stays; this only makes it
 *     visible, because the alternative is finding out from a member.
 */

const isProduction = process.env.NODE_ENV === "production";

function missing(name: string): boolean {
  return !process.env[name];
}

const required: Array<{ name: string; why: string }> = [
  { name: "DATABASE_URL", why: "every request needs the database" },
  { name: "JWT_SECRET", why: "sessions cannot be signed, so nobody can sign in" },
];

// Unset in production, emailed links get built from `x-forwarded-host`, which
// the caller controls — a password reset link that points at someone else's
// host. Locally there is no proxy in front and the fallback is just localhost.
if (isProduction) {
  required.push({
    name: "APP_URL",
    why: "emailed links would be built from the request Host header",
  });
}

const absent = required.filter((v) => missing(v.name));

if (absent.length > 0) {
  const lines = absent.map((v) => `  - ${v.name}: ${v.why}`).join("\n");
  console.error(
    `[Config] Refusing to start — ${absent.length} required variable${absent.length === 1 ? "" : "s"} not set:\n${lines}\n` +
      `[Config] Copy .env.example to .env and fill these in (see README.md).`
  );
  process.exit(1);
}

const degraded: string[] = [];

if (missing("R2_ACCOUNT_ID") || missing("R2_ACCESS_KEY_ID") || missing("R2_SECRET_ACCESS_KEY")) {
  degraded.push("R2 is not configured: uploads and file reads will fail (gallery, documents, library, recordings)");
}
if (missing("SMTP_PASS")) {
  degraded.push("SMTP_PASS is not set: no email will go out, including password set-up, reset and invites");
}
if (missing("VAPID_PUBLIC_KEY") || missing("VAPID_PRIVATE_KEY")) {
  degraded.push("VAPID keys are not set: push notifications are disabled");
}
if (missing("SQUARE_ACCESS_TOKEN")) {
  degraded.push("SQUARE_ACCESS_TOKEN is not set: pass purchases and shop payments are unavailable");
} else if (!isProduction && missing("SQUARE_ENVIRONMENT")) {
  // `_core/env.ts` defaults this to production deliberately, so an unset value
  // outside production points a dev server at the live Square account.
  degraded.push("SQUARE_ENVIRONMENT is not set and defaults to production: this will hit the live Square account");
}
if (!isProduction && missing("APP_URL")) {
  degraded.push("APP_URL is not set: emailed links will point at whatever host the request arrived on");
}

for (const line of degraded) {
  console.warn(`[Config] ${line}`);
}
