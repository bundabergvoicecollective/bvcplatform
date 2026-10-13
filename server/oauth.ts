/**
 * Google and Facebook sign-in, alongside the email/password routes in auth.ts.
 *
 * Manus offered these and the migration dropped them, so members who always
 * tapped "Continue with Google" had no equivalent here. The members are older
 * and not confident with technology; a provider button they are already signed
 * in to on their phone is the easiest door in the building.
 *
 * THE POINT OF THIS FILE IS THE LINKING. There are 72 member accounts carrying
 * pass balances and years of attendance. A provider sign-in that created a new
 * row would hand a member a blank account — no passes, no history, and
 * `pending`, so blocked on the approval screen. So an address that matches an
 * existing member signs that member in and writes nothing.
 *
 * Matching is `lower(trim(email))` on both sides via sameEmail(), because
 * users.email is utf8mb4_bin under TiDB and compares case-sensitively — see
 * the note in db.ts.
 *
 * On linking by email being safe: to abuse it, someone must hold a provider
 * account on a member's own address, and both Google and Facebook confirm an
 * address before they will return it. Anyone with that much access could
 * already use "forgot password", so this adds no path that was not there.
 * Google states `email_verified` explicitly and it is required below. Facebook
 * offers no such field, which is why its own caveats are in docs/social-login.md.
 *
 * Both providers are off until their two secrets are set: an unconfigured
 * provider is simply not advertised and its routes 404, the same
 * degrade-rather-than-fail rule as R2 and Square in _core/env.ts.
 */
import type { Express, Request, Response } from "express";
import { SignJWT } from "jose";
import { parse as parseCookies } from "cookie";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { ENV } from "../_core/env";
import { db, sameEmail } from "../db";
import { users } from "../drizzle/schema";
import { COOKIE_NAME } from "@shared/const";

// Both in MILLISECONDS, which is what Express's res.cookie wants — see the
// note in auth.ts. Written in seconds, the state cookie below would have been
// 600ms: expired before the member got back from Google, so every provider
// sign-in would have failed the state check and blamed the member for taking
// too long.
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days, as in auth.ts
const STATE_COOKIE = "__oauth_state";
const STATE_MAX_AGE = 10 * 60 * 1000; // the round trip to a provider and back

/** The profile each provider is reduced to before anything is done with it. */
type Profile = {
  providerId: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
};

type Provider = {
  /** Also the URL segment and the openId prefix, so it must stay stable. */
  key: "google" | "facebook";
  label: string;
  configured(): boolean;
  authorizeUrl(state: string, redirectUri: string): string;
  fetchProfile(code: string, redirectUri: string): Promise<Profile>;
};

/**
 * The redirect URI has to match the provider console byte for byte, so it is
 * built from APP_URL alone. The request's Host header is attacker-controlled
 * and the reason APP_URL exists (see CLAUDE.md); using it here would also mean
 * the run.app host and the members domain needed separate console entries.
 */
function redirectUriFor(key: string): string | null {
  const origin = ENV.appUrl.replace(/\/$/, "");
  if (!origin) return null;
  return `${origin}/api/auth/${key}/callback`;
}

const GOOGLE: Provider = {
  key: "google",
  label: "Google",
  configured: () => Boolean(ENV.googleClientId && ENV.googleClientSecret),
  authorizeUrl(state, redirectUri) {
    const params = new URLSearchParams({
      client_id: ENV.googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      // Members will sign in on a phone they are already signed in to Google
      // on; "select_account" stops it silently picking the wrong one for a
      // household that shares a tablet.
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },
  async fetchProfile(code, redirectUri) {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: ENV.googleClientId,
        client_secret: ENV.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`Google token exchange returned ${tokenRes.status}`);
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) throw new Error("Google returned no access token");

    // userinfo rather than decoding the id_token: this is a server-to-server
    // call over TLS carrying our own token, so there is no JWT signature to
    // verify and no verification to get subtly wrong.
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!profileRes.ok) throw new Error(`Google userinfo returned ${profileRes.status}`);
    const p = (await profileRes.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      given_name?: string;
      family_name?: string;
      name?: string;
    };
    return {
      providerId: p.sub,
      email: p.email ?? null,
      emailVerified: p.email_verified === true,
      firstName: p.given_name ?? null,
      lastName: p.family_name ?? null,
      name: p.name ?? null,
    };
  },
};

const FACEBOOK: Provider = {
  key: "facebook",
  label: "Facebook",
  configured: () => Boolean(ENV.facebookAppId && ENV.facebookAppSecret),
  authorizeUrl(state, redirectUri) {
    const params = new URLSearchParams({
      client_id: ENV.facebookAppId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "email,public_profile",
      state,
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
  },
  async fetchProfile(code, redirectUri) {
    const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      code,
      client_id: ENV.facebookAppId,
      client_secret: ENV.facebookAppSecret,
      redirect_uri: redirectUri,
    })}`;
    const tokenRes = await fetch(tokenUrl);
    if (!tokenRes.ok) throw new Error(`Facebook token exchange returned ${tokenRes.status}`);
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) throw new Error("Facebook returned no access token");

    const fields = "id,email,first_name,last_name,name";
    const profileRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=${fields}&access_token=${encodeURIComponent(access_token)}`,
    );
    if (!profileRes.ok) throw new Error(`Facebook profile returned ${profileRes.status}`);
    const p = (await profileRes.json()) as {
      id: string;
      email?: string;
      first_name?: string;
      last_name?: string;
      name?: string;
    };
    return {
      providerId: p.id,
      email: p.email ?? null,
      // Facebook exposes no per-address verification flag. It confirms an
      // address before returning it, which is the reasoning in the header, but
      // it is not something this code can check, so it is not claimed here.
      emailVerified: Boolean(p.email),
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      name: p.name ?? null,
    };
  },
};

const PROVIDERS = [GOOGLE, FACEBOOK];

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: ENV.isProduction,
    sameSite: "lax" as const, // the provider redirect is a cross-site GET
    maxAge,
    path: "/",
  };
}

async function signToken(userId: number): Promise<string> {
  const secret = new TextEncoder().encode(ENV.cookieSecret);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

/** Equal-length compare, so a wrong state cannot be narrowed by timing. */
function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Back to the login page with a code the client turns into plain English. */
function fail(res: Response, code: string) {
  return res.redirect(`/login?error=${encodeURIComponent(code)}`);
}

export function registerOAuthRoutes(app: Express) {
  // Which buttons the login page should show. Always answers, so the client
  // needs no knowledge of how the server is configured.
  app.get("/api/auth/providers", (_req, res) => {
    const available: Record<string, boolean> = {};
    for (const p of PROVIDERS) available[p.key] = p.configured() && Boolean(redirectUriFor(p.key));
    res.json(available);
  });

  for (const provider of PROVIDERS) {
    // ── Start ───────────────────────────────────────────────────────────────
    app.get(`/api/auth/${provider.key}`, (req: Request, res: Response) => {
      if (!provider.configured()) return res.status(404).json({ error: `${provider.label} sign-in is not configured` });
      const redirectUri = redirectUriFor(provider.key);
      if (!redirectUri) {
        console.error(`[OAuth] APP_URL is unset, so no ${provider.key} redirect URI can be built`);
        return fail(res, "unconfigured");
      }

      // CSRF: a value held in an httpOnly cookie and echoed back by the
      // provider. Without it, an attacker can complete someone else's
      // authorization and land their session in the victim's browser.
      const state = randomBytes(32).toString("hex");
      res.cookie(STATE_COOKIE, state, cookieOptions(STATE_MAX_AGE));
      return res.redirect(provider.authorizeUrl(state, redirectUri));
    });

    // ── Callback ────────────────────────────────────────────────────────────
    app.get(`/api/auth/${provider.key}/callback`, async (req: Request, res: Response) => {
      if (!provider.configured()) return res.status(404).json({ error: "Not configured" });
      const redirectUri = redirectUriFor(provider.key);
      if (!redirectUri) return fail(res, "unconfigured");

      // There is no cookie-parser in this app; _core/auth-helper.ts reads
      // req.headers.cookie through the `cookie` package and so does this.
      // req.cookies would be undefined, and the state check would reject
      // every callback.
      const expected = parseCookies(req.headers.cookie ?? "")[STATE_COOKIE] ?? "";
      const given = typeof req.query.state === "string" ? req.query.state : "";
      res.clearCookie(STATE_COOKIE, { path: "/" });

      // "access_denied" is the member tapping Cancel, which is not an error
      // worth a message.
      if (typeof req.query.error === "string") {
        return res.redirect(req.query.error === "access_denied" ? "/login" : `/login?error=provider`);
      }
      if (!expected || !given || !sameState(expected, given)) return fail(res, "state");

      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!code) return fail(res, "nocode");
      if (!db) return fail(res, "server");

      try {
        const profile = await provider.fetchProfile(code, redirectUri);
        const email = profile.email?.toLowerCase().trim() ?? "";
        if (!email) return fail(res, `${provider.key}-no-email`);
        if (!profile.emailVerified) return fail(res, "unverified");

        const [existing] = await db.select().from(users).where(sameEmail(email)).limit(1);

        if (existing) {
          // A denied row is a stray sign-up that an admin turned away — see
          // docs/migration-status.md. Refuse before issuing a session, the
          // same as /api/auth/forgot does.
          if (existing.status === "denied") return fail(res, "denied");

          // Deliberately no writes. This member's row carries their passes,
          // their history and their openId — the last of which OWNER_OPEN_ID
          // matches on to grant admin. Signing in is not the moment to touch
          // any of it.
          const token = await signToken(existing.id);
          res.cookie(COOKIE_NAME, token, cookieOptions(COOKIE_MAX_AGE));
          console.log(`[OAuth] ${provider.key} sign-in linked to existing member #${existing.id}`);
          return res.redirect("/dashboard");
        }

        // Nobody with that address. This is a stranger, so they get the same
        // treatment as a self-registration: an account awaiting approval,
        // which BVCLayout blocks until an admin acts.
        const openId = `${provider.key}:${profile.providerId}`;
        // `name` is NOT NULL in the schema, and a provider can return an empty
        // string as readily as nothing at all, so each fallback is tested for
        // being non-empty rather than merely present.
        const displayName =
          profile.name?.trim() ||
          [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
          email;
        const [inserted] = await db
          .insert(users)
          .values({
            openId,
            email,
            firstName: profile.firstName,
            lastName: profile.lastName,
            name: displayName,
            status: "pending",
            role: "user",
            loginMethod: provider.key,
          })
          .$returningId();

        const token = await signToken(inserted.id);
        res.cookie(COOKIE_NAME, token, cookieOptions(COOKIE_MAX_AGE));
        console.log(`[OAuth] ${provider.key} sign-in created pending account #${inserted.id}`);
        return res.redirect("/dashboard");
      } catch (err) {
        // The message can carry provider detail, so it goes to the log and
        // the member gets a code.
        console.error(`[OAuth] ${provider.key} callback failed:`, err);
        return fail(res, "provider");
      }
    });
  }
}
