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
 */
import type { Express } from "express";
import { ENV } from "../_core/env";
import { getRequestUser } from "../_core/auth-helper";
import { verifyEmailTransport } from "../email";

export function registerEmailCheck(app: Express) {
  app.get("/api/admin/email-check", async (req, res) => {
    const user = await getRequestUser(req);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admins only" });
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
