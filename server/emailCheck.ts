/**
 * GET /api/admin/email-check — admin-only diagnostic for outbound email.
 *
 * sendEmail() returns false and logs rather than throwing, so that
 * /api/auth/forgot answers identically whether or not an address belongs to a
 * member. The cost is that a broken mailbox looks exactly like a working one
 * from the browser: the member is told a link is on its way and nothing
 * arrives. This endpoint is the way to see why, without reading Cloud Run logs.
 *
 * It reports the configuration the running container actually has, and the real
 * error from an SMTP connect + authenticate. It never returns the password:
 * only its length and whether it carries Resend's "re_" prefix, which is enough
 * to catch an empty, truncated or wrong-service value.
 *
 * The refusal path is deliberately specific too. A flat 403 says nothing about
 * whether the cookie was missing, the token stale, or the role wrong, and
 * guessing between those costs a round trip each time.
 */
import type { Express, Request } from "express";
import { jwtVerify } from "jose";
import { parse } from "cookie";
import { eq } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "../_core/env";
import { db } from "../db";
import { users } from "../drizzle/schema";
import { verifyEmailTransport } from "../email";

/** Mirrors _core/auth-helper.ts, but reports why it refused rather than null. */
async function describeRequestUser(
  req: Request,
): Promise<{ ok: true; role: string } | { ok: false; reason: string }> {
  const rawCookies = req.headers.cookie ?? "";
  if (!rawCookies) return { ok: false, reason: "The request carried no cookies at all." };

  const token = parse(rawCookies)[COOKIE_NAME];
  if (!token) {
    const names = Object.keys(parse(rawCookies)).join(", ") || "none";
    return { ok: false, reason: `No "${COOKIE_NAME}" cookie. Cookies present: ${names}.` };
  }
  if (!ENV.cookieSecret) return { ok: false, reason: "JWT_SECRET is not set on the server." };

  let userId: unknown;
  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret);
    ({ payload: { userId } } = await jwtVerify(token, secret) as { payload: { userId: unknown } });
  } catch (err) {
    return {
      ok: false,
      reason: `Session cookie failed verification: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (typeof userId !== "number") {
    return { ok: false, reason: `Session carried no numeric user id (got ${typeof userId}).` };
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { ok: false, reason: `No user row for id ${userId}.` };
  if (user.role !== "admin") {
    return { ok: false, reason: `Signed in as user ${userId}, but role is "${user.role}", not "admin".` };
  }

  return { ok: true, role: user.role };
}

export function registerEmailCheck(app: Express) {
  app.get("/api/admin/email-check", async (req, res) => {
    const who = await describeRequestUser(req);
    if (!who.ok) {
      return res.status(403).json({ error: "Admins only", reason: who.reason });
    }

    const pass = ENV.smtpPass;
    const result = await verifyEmailTransport();

    return res.json({
      ok: result.ok,
      error: result.error,
      config: {
        host: ENV.smtpHost,
        port: ENV.smtpPort,
        user: ENV.smtpUser,
        from: ENV.smtpFrom,
        passSet: Boolean(pass),
        passLength: pass.length,
        passLooksLikeResendKey: pass.startsWith("re_"),
      },
      hint: result.ok
        ? "SMTP connected and authenticated. If mail still is not arriving, the send is being rejected after this point — check the from address against your verified domain."
        : "SMTP could not connect or authenticate. Compare the config above with your provider: a wrong length or a missing re_ prefix means SMTP_PASS holds the wrong value.",
    });
  });
}
