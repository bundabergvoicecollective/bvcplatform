/**
 * Campaign emails: the message a member receives, and the unsubscribe link in
 * it.
 *
 * ── the unsubscribe link must never be a login ──
 *
 * A session is a JWT holding { userId }, signed with JWT_SECRET. If these
 * links were signed the same way, the token in one would also be accepted as
 * a session cookie, and forwarding a campaign email to a friend would hand
 * them the account. So the link carries a plain HMAC under a key DERIVED from
 * the secret for this purpose alone: it can prove "this is member 42's
 * unsubscribe link" and nothing else.
 *
 * ── every link is built from APP_URL ──
 *
 * As with invites and password resets: never from the request, never from
 * the admin's browser. Sending refuses outright when APP_URL is not set,
 * rather than mailing dozens of people a link to nowhere.
 */
import crypto from "node:crypto";
import { ENV } from "./_core/env";

function unsubscribeKey(): Buffer {
  if (!ENV.cookieSecret) throw new Error("JWT_SECRET is not set, so unsubscribe links cannot be signed.");
  return crypto.createHash("sha256").update(`bvc-campaign-unsubscribe:${ENV.cookieSecret}`).digest();
}

export function unsubscribeToken(userId: number): string {
  return crypto.createHmac("sha256", unsubscribeKey()).update(String(userId)).digest("base64url").slice(0, 32);
}

export function verifyUnsubscribeToken(userId: number, token: string): boolean {
  if (!Number.isInteger(userId) || userId <= 0 || typeof token !== "string") return false;
  const expected = Buffer.from(unsubscribeToken(userId));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function appOrigin(): string {
  const origin = (ENV.appUrl ?? "").replace(/\/$/, "");
  if (!origin) throw new Error("APP_URL is not set, so the links in this email would go nowhere. Nothing was sent.");
  return origin;
}

export function unsubscribeUrl(userId: number): string {
  return `${appOrigin()}/api/unsubscribe?u=${userId}&t=${unsubscribeToken(userId)}`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** {firstName} in the subject or message becomes the member's first name. */
export function personalise(text: string, firstName: string): string {
  return text.replace(/\{\s*first\s*name\s*\}/gi, firstName);
}

/**
 * The email itself, in the same dress as the invitation: navy band, gold
 * name, one clear button. The message is plain text typed by an admin —
 * escaped, never trusted as HTML — with blank lines becoming paragraphs.
 */
export function buildCampaignEmail(opts: {
  subject: string;
  body: string;
  firstName: string;
  userId: number;
  includeBuyButton: boolean;
}): { subject: string; html: string; text: string; listUnsubscribe: string } {
  const origin = appOrigin();
  const subject = personalise(opts.subject, opts.firstName);
  const body = personalise(opts.body, opts.firstName).trim();
  const unsub = unsubscribeUrl(opts.userId);
  const passesUrl = `${origin}/passes`;

  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p.trim()).replace(/\n/g, "<br/>")}</p>`)
    .join("\n          ");

  const button = opts.includeBuyButton
    ? `<p style="margin:8px 0 24px;text-align:center;">
            <a href="${passesUrl}" style="display:inline-block;background:#c9922a;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;font-size:17px;">Buy a pass</a>
          </p>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr><td style="background:#0e1a2b;padding:28px 40px;text-align:center;">
          <p style="margin:0;color:#c9922a;font-size:12px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;">Bundaberg Voice Collective</p>
        </td></tr>
        <tr><td style="padding:32px 40px 16px;color:#333;font-size:17px;line-height:1.6;">
          ${paragraphs}
          ${button}
        </td></tr>
        <tr><td style="padding:16px 40px 28px;border-top:1px solid #eee;color:#888;font-size:12px;line-height:1.5;text-align:center;">
          Sent by Bundaberg Voice Collective to members who have bought a pass with us.<br/>
          <a href="${unsub}" style="color:#888;">Unsubscribe from these emails</a> — you'll still get receipts and account emails.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text =
    `${body}\n\n` +
    (opts.includeBuyButton ? `Buy a pass: ${passesUrl}\n\n` : "") +
    `—\nSent by Bundaberg Voice Collective to members who have bought a pass with us.\n` +
    `Unsubscribe from these emails: ${unsub}\n`;

  return { subject, html, text, listUnsubscribe: unsub };
}
