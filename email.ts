/**
 * Generic email helpers built on nodemailer.
 * Intended for transactional emails (receipts, notifications, invites).
 */
import nodemailer from "nodemailer";
import { ENV } from "./_core/env";

function createTransport() {
  return nodemailer.createTransport({
    host: ENV.smtpHost,
    port: ENV.smtpPort,
    secure: ENV.smtpPort === 465,
    auth: ENV.smtpUser && ENV.smtpPass
      ? { user: ENV.smtpUser, pass: ENV.smtpPass }
      : undefined,
  });
}

export type SendEmailOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Send a transactional email.
 * Returns true on success, false if SMTP is not configured or delivery fails.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  if (!ENV.smtpPass) {
    console.warn("[Email] SMTP not configured — skipping email to", opts.to);
    return false;
  }

  try {
    const transport = createTransport();
    await transport.sendMail({
      from: ENV.smtpFrom,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    return true;
  } catch (err) {
    console.error("[Email] Failed to send to", opts.to, err);
    return false;
  }
}

/**
 * Build the invitation email sent when an admin invites a new member.
 */
export function buildInviteEmail(inviteUrl: string, expiresAt: Date): { subject: string; html: string; text: string } {
  const expiry = expiresAt.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  const subject = "You're invited to join Bundaberg Voice Collective";
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr><td style="background:#0e1a2b;padding:32px 40px;text-align:center;">
          <p style="margin:0 0 4px;color:#c9922a;font-size:11px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;">Bundaberg Voice Collective</p>
          <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">You're invited!</p>
        </td></tr>
        <tr><td style="padding:32px 40px;color:#333;font-size:16px;line-height:1.6;">
          <p style="margin:0 0 16px;">You've been invited to create your member account for Bundaberg Voice Collective.</p>
          <p style="margin:0 0 24px;">Click the button below to set up your account.</p>
          <p style="margin:0 0 24px;text-align:center;">
            <a href="${inviteUrl}" style="display:inline-block;background:#c9922a;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;">Accept invitation</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#777;">This invitation expires on ${expiry}.</p>
          <p style="margin:0;font-size:13px;color:#777;word-break:break-all;">Or copy this link: ${inviteUrl}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = `You've been invited to join Bundaberg Voice Collective.\n\nAccept your invitation: ${inviteUrl}\n\nThis invitation expires on ${expiry}.`;
  return { subject, html, text };
}
