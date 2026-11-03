/**
 * Email/password authentication routes replacing Manus OAuth.
 * POST /api/auth/login    — sign in with email + password
 * POST /api/auth/register — create account (status=pending until approved by admin)
 * POST /api/auth/logout   — clear session cookie
 * GET  /api/auth/me       — return current user (or 401)
 * POST /api/auth/forgot   — email a single-use link to set/reset a password,
 *                           or resend the invitation if there is no account yet
 * POST /api/auth/reset    — set a new password using that link, then sign in
 * POST /api/auth/invite-complete — finish an invite: choose a password, sign in
 */
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { ENV } from "../_core/env";
import { countMembersSignedIn, db, getInviteByToken, getLiveInviteByEmail, markInviteResent, markInviteUsed, sameEmail } from "../db";
import { notifyOwner } from "../_core/notification";
import { passwordResets, users } from "../drizzle/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { buildInviteEmail, sendEmail } from "../email";

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function appOrigin(req: { get(name: string): string | undefined }): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
  return `${ENV.isProduction ? "https" : "http"}://${host}`;
}

function buildResetEmail(name: string, link: string, firstTime: boolean) {
  const heading = firstTime ? "Set your password" : "Reset your password";
  const intro = firstTime
    ? "Bundaberg Voice Collective has moved to a new members' site. To sign in for the first time, choose a password using the button below."
    : "We received a request to reset the password for your Bundaberg Voice Collective account.";
  const subject = firstTime
    ? "Set your password for the new BVC members' site"
    : "Reset your BVC password";
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr><td style="background:#0e1a2b;padding:32px 40px;text-align:center;">
          <p style="margin:0 0 4px;color:#c9922a;font-size:11px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;">Bundaberg Voice Collective</p>
          <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">${heading}</p>
        </td></tr>
        <tr><td style="padding:32px 40px;color:#333;font-size:16px;line-height:1.6;">
          <p style="margin:0 0 16px;">Hi ${name},</p>
          <p style="margin:0 0 24px;">${intro}</p>
          <p style="margin:0 0 24px;text-align:center;">
            <a href="${link}" style="display:inline-block;background:#c9922a;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;">${heading}</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#777;">This link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>
          <p style="margin:0;font-size:13px;color:#777;word-break:break-all;">Or copy this link: ${link}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = `Hi ${name},\n\n${intro}\n\n${heading}: ${link}\n\nThis link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email.\n\n— Bundaberg Voice Collective`;
  return { subject, html, text };
}

import { COOKIE_NAME } from "@shared/const";
// MILLISECONDS. Express's res.cookie takes maxAge in ms and divides by 1000
// for the Max-Age header, so the seconds figure that used to be here produced
// Max-Age=2592 — a session that died 43 minutes after signing in. That is what
// "I keep getting logged out" was.
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: ENV.isProduction,
    sameSite: "lax" as const,
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

export function registerAuthRoutes(app: Express) {
  // ── Register ──────────────────────────────────────────────────────────────
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body as {
        email?: string;
        password?: string;
        firstName?: string;
        lastName?: string;
      };

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const normalizedEmail = email.toLowerCase().trim();

      // Check for duplicate
      const [existing] = await db.select().from(users).where(sameEmail(normalizedEmail)).limit(1);
      if (existing) {
        const hint = existing.passwordHash
          ? "An account with this email already exists. Try signing in, or use \"Forgot password\"."
          : "You're already a member! Use \"Set up / forgot password\" on the sign-in page to choose a password.";
        return res.status(409).json({ error: hint });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const openId = `email:${normalizedEmail}`; // synthetic openId for compatibility

      const [inserted] = await db.insert(users).values({
        email: normalizedEmail,
        passwordHash,
        openId,
        firstName: firstName?.trim() ?? null,
        lastName: lastName?.trim() ?? null,
        name: [firstName, lastName].filter(Boolean).join(" ") || normalizedEmail,
        status: "pending",
        role: "user",
        loginMethod: "email",
      }).$returningId();

      const userId = inserted.id;
      const token = await signToken(userId);

      res.cookie(COOKIE_NAME, token, cookieOptions(COOKIE_MAX_AGE));
      return res.status(201).json({ message: "Account created — awaiting admin approval" });
    } catch (err) {
      console.error("[Auth] register error:", err);
      return res.status(500).json({ error: "Registration failed" });
    }
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const [user] = await db.select().from(users).where(sameEmail(normalizedEmail)).limit(1);

      if (user && !user.passwordHash) {
        return res.status(401).json({
          error: "You haven't set a password on the new site yet. Use \"Set up / forgot password\" below to get a link by email.",
          code: "NO_PASSWORD",
        });
      }
      if (!user || !user.passwordHash) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Update last signed in
      await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));

      const token = await signToken(user.id);
      res.cookie(COOKIE_NAME, token, cookieOptions(COOKIE_MAX_AGE));
      return res.json({ message: "Logged in" });
    } catch (err) {
      console.error("[Auth] login error:", err);
      return res.status(500).json({ error: "Login failed" });
    }
  });

  // ── Forgot / first-time password setup ───────────────────────────────────
  // Always answers the same way so it can't be used to discover who is a member.
  app.post("/api/auth/forgot", async (req, res) => {
    const generic = { message: "If that email belongs to a member, a link is on its way. Check your inbox (and spam folder)." };
    try {
      const { email } = req.body as { email?: string };
      if (!email) return res.status(400).json({ error: "Email is required" });
      const normalizedEmail = email.toLowerCase().trim();
      const [user] = await db.select().from(users).where(sameEmail(normalizedEmail)).limit(1);

      // No member row. Two very different situations behind one answer, and
      // until now both of them sent nothing and said nothing anywhere.
      //
      // Four invited people turned out to have no account: an invite writes a
      // token and sends two emails but creates no user, so somebody could
      // accept the invitation, receive the code, enter it, and still not
      // exist. Their next move was this form, which found no member, sent no
      // email, and told them a link was on its way. Two of them waited all
      // evening for an email that was never going to come.
      //
      // The link they need is the invitation, so send that instead. The reply
      // stays identical either way — that is what stops this form being used
      // to discover who is in the choir — but the log now says which branch
      // ran, because "nothing was sent" and "the mail server is broken" looked
      // exactly alike from outside and cost an evening to tell apart.
      if (!user) {
        const invite = await getLiveInviteByEmail(normalizedEmail);
        if (!invite) {
          console.log("[Auth] forgot: no member and no live invite for", normalizedEmail, "— nothing sent");
          return res.json(generic);
        }
        // Same two minutes the reset path allows itself. Without it, anyone
        // who knows the address can post this form in a loop and mail-bomb
        // somebody who has not even joined yet.
        const lastSent = invite.lastResentAt ?? invite.createdAt;
        if (lastSent && lastSent > new Date(Date.now() - 2 * 60 * 1000)) {
          console.log("[Auth] forgot: invite for", normalizedEmail, "was sent in the last 2 minutes — not resending");
          return res.json(generic);
        }

        const inviteUrl = `${appOrigin(req)}/invite/${invite.token}`;
        const sent = await sendEmail({ to: normalizedEmail, ...buildInviteEmail(inviteUrl, invite.expiresAt) });
        if (sent) {
          await markInviteResent(invite.token);
          console.log("[Auth] forgot: no account yet — resent the invitation to", normalizedEmail);
        } else {
          console.error("[Auth] forgot: invitation could not be resent to", normalizedEmail);
        }
        return res.json(generic);
      }

      if (user.status === "denied") {
        console.log("[Auth] forgot: member", user.id, "is denied — nothing sent");
        return res.json(generic);
      }

      // Light rate limit: at most one live link per 2 minutes per member.
      const [recent] = await db
        .select()
        .from(passwordResets)
        .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt), gt(passwordResets.createdAt, new Date(Date.now() - 2 * 60 * 1000))))
        .limit(1);
      if (recent) return res.json(generic);

      const token = randomBytes(32).toString("hex");
      await db.insert(passwordResets).values({
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      });
      const link = `${appOrigin(req)}/reset-password?token=${token}`;
      const name = user.firstName || user.name || "there";
      const sent = await sendEmail({ to: normalizedEmail, ...buildResetEmail(name, link, !user.passwordHash) });
      if (sent) console.log("[Auth] forgot: reset link sent to", normalizedEmail);
      else console.error("[Auth] reset email could not be sent to", normalizedEmail);
      return res.json(generic);
    } catch (err) {
      console.error("[Auth] forgot error:", err);
      return res.json(generic);
    }
  });

  // ── Reset password with emailed token ─────────────────────────────────────
  app.post("/api/auth/reset", async (req, res) => {
    try {
      const { token, password } = req.body as { token?: string; password?: string };
      if (!token || !password) return res.status(400).json({ error: "Token and password are required" });
      if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

      const [reset] = await db
        .select()
        .from(passwordResets)
        .where(and(eq(passwordResets.tokenHash, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
        .limit(1);
      if (!reset) {
        return res.status(400).json({ error: "This link has expired or has already been used. Please request a new one." });
      }

      // Read the member before the write, to know whether this is the first
      // time they have got in here. A password can only be set on this site, so
      // going from none to one is the moment they arrived — lastSignedIn
      // carries values over from the Manus import and cannot tell us that.
      const [member] = await db.select().from(users).where(eq(users.id, reset.userId)).limit(1);
      const firstTimeIn = !member?.passwordHash;

      const passwordHash = await bcrypt.hash(password, 12);
      await db.update(users).set({ passwordHash, lastSignedIn: new Date() }).where(eq(users.id, reset.userId));
      // Invalidate this and any other outstanding links for the member.
      await db.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, reset.userId), isNull(passwordResets.usedAt)));

      // Tell the choir's inbox that someone is in, with the running total, so
      // the migration can be watched without anyone running an audit. First
      // time only: a notice on every sign-in would be dozens a day across 72
      // members and would stop being read within a week.
      //
      // Deliberately after the write and never awaited into the response — the
      // member is in whether or not the SMTP call succeeds, and they should not
      // wait on it or see it fail.
      if (firstTimeIn) {
        // Awaited, not fired and forgotten: Cloud Run allocates CPU only while
        // a request is in flight by default, so work started after the response
        // can be frozen until the next request happens along — and the notice
        // would go missing with nothing to show for it.
        //
        // Capped so the member never waits on our mail server. Whatever
        // happens here, their password is already saved and they are signed in.
        const notice = (async () => {
          const { signedIn, total } = await countMembersSignedIn();
          const who = [member?.firstName, member?.lastName].filter(Boolean).join(" ") || member?.name || "A member";
          await notifyOwner({
            title: `${who} has signed in`,
            content:
              `${who} (${member?.email ?? "no address"}) has set their password and signed in ` +
              `to the new members' site for the first time.\n\n` +
              `That is ${signedIn} of ${total} members now in.`,
          });
        })();
        await Promise.race([
          notice.catch((err) => console.warn("[Auth] first sign-in notice failed:", err)),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      }

      const session = await signToken(reset.userId);
      res.cookie(COOKIE_NAME, session, cookieOptions(COOKIE_MAX_AGE));
      return res.json({ message: "Password saved — you're signed in" });
    } catch (err) {
      console.error("[Auth] reset error:", err);
      return res.status(500).json({ error: "Could not reset password" });
    }
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  // ── Finish an invitation ──────────────────────────────────────────────────
  // The last step of being invited: choose a password and be signed in.
  //
  // It did not exist. An invited member verified their email with the code and
  // was then sent to the sign-in page — where they had no password, because
  // nobody had ever given them one. The only way through was to guess that
  // "Set up / forgot password" was meant for them, wait for a second email and
  // follow a second link. Most people would conclude the invite was broken.
  //
  // The invite token is already a bearer credential and the code has already
  // proved the person reads that mailbox, so there is nothing further to check
  // before letting them choose a password — this is the same proof a reset
  // link carries, collected in one sitting instead of two.
  app.post("/api/auth/invite-complete", async (req, res) => {
    try {
      const { token, password } = req.body as { token?: string; password?: string };
      if (!token || !password) {
        return res.status(400).json({ error: "Token and password are required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const invite = await getInviteByToken(token);
      if (!invite) return res.status(404).json({ error: "Invite not found" });
      if (invite.usedAt) {
        return res.status(409).json({ error: "This invite has already been used. Try signing in." });
      }
      if (invite.expiresAt < new Date()) {
        return res.status(400).json({ error: "This invite link has expired. Ask for a new one." });
      }
      // The code is what proves they read the mailbox. Without it, the link
      // alone would let anyone who saw it claim the account.
      if (!invite.emailVerifiedAt) {
        return res.status(400).json({ error: "Verify your email address first." });
      }

      const email = invite.email.toLowerCase().trim();
      const passwordHash = await bcrypt.hash(password, 12);
      const [existing] = await db.select().from(users).where(sameEmail(email)).limit(1);

      let userId: number;
      if (existing) {
        // A member who was denied was excluded on purpose, and an invite does
        // not undo that. Everyone else: inviting them IS the approval, so a
        // pending row becomes active rather than landing them on a "waiting
        // for approval" screen at the end of being approved.
        if (existing.status === "denied") {
          return res.status(403).json({ error: "This account cannot be activated. Please contact the choir." });
        }
        await db
          .update(users)
          .set({
            passwordHash,
            status: existing.status === "pending" ? "active" : existing.status,
            loginMethod: existing.loginMethod ?? "email",
          })
          .where(eq(users.id, existing.id));
        userId = existing.id;
      } else {
        const [inserted] = await db
          .insert(users)
          .values({
            email,
            passwordHash,
            openId: `email:${email}`,
            name: email,
            // Invited by an admin, and the address is proved. There is nobody
            // left to approve them.
            status: "active",
            role: "user",
            loginMethod: "email",
          })
          .$returningId();
        userId = inserted.id;
      }

      await markInviteUsed(token, userId);

      const sessionToken = await signToken(userId);
      res.cookie(COOKIE_NAME, sessionToken, cookieOptions(COOKIE_MAX_AGE));
      return res.json({ message: "Welcome to Bundaberg Voice Collective" });
    } catch (err) {
      console.error("[Auth] invite-complete error:", err);
      return res.status(500).json({ error: "Could not finish setting up your account" });
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.cookie(COOKIE_NAME, "", cookieOptions(0));
    return res.json({ message: "Logged out" });
  });

  // ── Me ────────────────────────────────────────────────────────────────────
  app.get("/api/auth/me", async (req, res) => {
    try {
      const rawCookies = req.headers.cookie ?? "";
      const { parse } = await import("cookie");
      const cookies = parse(rawCookies);
      const token = cookies[COOKIE_NAME];

      if (!token) return res.status(401).json({ error: "Not authenticated" });

      const { jwtVerify } = await import("jose");
      const secret = new TextEncoder().encode(ENV.cookieSecret);
      const { payload } = await jwtVerify(token, secret);
      const userId = payload.userId as number;

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return res.status(401).json({ error: "User not found" });

      // Don't leak passwordHash
      const { passwordHash: _ph, ...safeUser } = user;
      return res.json(safeUser);
    } catch {
      return res.status(401).json({ error: "Invalid session" });
    }
  });
}
