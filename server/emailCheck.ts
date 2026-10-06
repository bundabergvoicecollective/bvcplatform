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
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "../_core/env";
import { db } from "../db";
import { passwordResets, users } from "../drizzle/schema";
import { sendEmailVerbose, verifyEmailTransport } from "../email";
import { asyncRoute } from "./asyncRoute";

/** Mirrors _core/auth-helper.ts, but reports why it refused rather than null. */
async function describeRequestUser(
  req: Request,
): Promise<{ ok: true; role: string; email: string | null } | { ok: false; reason: string }> {
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

  return { ok: true, role: user.role, email: user.email };
}

export function registerEmailCheck(app: Express) {
  app.get("/api/admin/email-check", asyncRoute(async (req, res) => {
    const who = await describeRequestUser(req);
    if (!who.ok) {
      return res.status(403).json({ error: "Admins only", reason: who.reason });
    }

    const pass = ENV.smtpPass;

    // ?forgot=1 walks the same branches as POST /api/auth/forgot for the
    // signed-in admin's own address, and says which one it lands on. That
    // endpoint answers identically whichever way it goes — deliberately, so it
    // cannot be used to discover who is a member — which also means a silent
    // skip is indistinguishable from a sent email. Nothing is sent here.
    if (req.query.forgot === "1") {
      const now = new Date();
      const email = (who.email ?? "").toLowerCase().trim();
      const [user] = email
        ? await db.select().from(users).where(eq(users.email, email)).limit(1)
        : [];

      if (!user) {
        return res.json({
          wouldSend: false,
          stoppedAt: "user lookup",
          detail: `No user row matches "${email}". /api/auth/forgot returns its generic answer here and sends nothing.`,
        });
      }
      if (user.status === "denied") {
        return res.json({
          wouldSend: false,
          stoppedAt: "status check",
          detail: `User ${user.id} has status "denied", which is skipped silently.`,
        });
      }

      const cutoff = new Date(now.getTime() - 2 * 60 * 1000);
      const [blocking] = await db
        .select()
        .from(passwordResets)
        .where(and(
          eq(passwordResets.userId, user.id),
          isNull(passwordResets.usedAt),
          gt(passwordResets.createdAt, cutoff),
        ))
        .limit(1);

      const latest = await db
        .select()
        .from(passwordResets)
        .where(eq(passwordResets.userId, user.id))
        .orderBy(desc(passwordResets.createdAt))
        .limit(5);

      return res.json({
        wouldSend: !blocking,
        stoppedAt: blocking ? "rate limit" : null,
        detail: blocking
          ? "An unused reset row counts as recent, so the request is skipped without sending. Compare its createdAt with serverNow below: if it is not actually within the last two minutes, the stored timestamps and the server clock disagree."
          : "All three checks pass, so a real request would insert a token and send.",
        serverNow: now.toISOString(),
        rateLimitCutoff: cutoff.toISOString(),
        blockingRow: blocking
          ? { createdAt: blocking.createdAt, expiresAt: blocking.expiresAt, usedAt: blocking.usedAt }
          : null,
        user: { id: user.id, status: user.status, hasPassword: Boolean(user.passwordHash) },
        resetRowCount: latest.length,
        recentRows: latest.map((r) => ({ createdAt: r.createdAt, usedAt: r.usedAt, expiresAt: r.expiresAt })),
      });
    }

    // ?send=1 posts a real message, because verify() only proves the
    // connection and login work — it never exercises the send itself, which is
    // where a rejected sender or a blocked recipient actually surfaces. It goes
    // only to the signed-in admin's own address, so this cannot be used to send
    // mail to anyone else.
    if (req.query.send === "1") {
      if (!who.email) {
        return res.json({ sent: false, error: "Your account has no email address on it." });
      }
      const stamp = new Date().toISOString();
      const sent = await sendEmailVerbose({
        to: who.email,
        subject: `BVC email test — ${stamp}`,
        html: `<p>This is a test from the BVC members site.</p><p>Sent ${stamp}.</p>`,
        text: `This is a test from the BVC members site.\n\nSent ${stamp}.`,
      });
      return res.json({
        sent: sent.ok,
        to: who.email,
        messageId: sent.messageId,
        response: sent.response,
        error: sent.error,
        from: ENV.smtpFrom,
        hint: sent.ok
          ? "Accepted by the provider. If it does not arrive, it was dropped after acceptance — check the provider's own logs and your spam folder."
          : "The provider rejected the message. The error above is its own wording.",
      });
    }

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
  }));
}
