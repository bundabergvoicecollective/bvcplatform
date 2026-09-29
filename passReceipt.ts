/**
 * Email receipts for online pass purchases.
 */
import { sendEmail } from "./email";

type ReceiptOpts = {
  to: string;
  memberName: string;
  passType: string;
  sessionCount: number;
  amountCents: number;
  /** ISO currency code; defaults to AUD. */
  currency?: string | null;
  /** Square payment/session id, or a BVC-<orderId> fallback. */
  paymentReference?: string | null;
  /** When the purchase completed; defaults to now. */
  purchasedAt?: Date | null;
};

/**
 * Determine whether a paid order should trigger a receipt email.
 * Returns true when the order has an email address and a positive amount.
 */
export function shouldIssueOnlinePassReceipt(order: {
  userEmail?: string | null;
  amountCents?: number | null;
}): boolean {
  return Boolean(order.userEmail && (order.amountCents ?? 0) > 0);
}

/**
 * Send an online pass purchase receipt to the member.
 * Returns true on success, false if delivery was skipped or failed.
 */
export async function sendOnlinePassReceipt(opts: ReceiptOpts): Promise<boolean> {
  const { to, memberName, passType, sessionCount, amountCents } = opts;
  const dollars = (amountCents / 100).toFixed(2);
  const currency = (opts.currency || "AUD").toUpperCase();
  const passLabel = passType.replace(/-/g, " ");
  const sessionWord = sessionCount === 1 ? "session" : "sessions";
  const purchasedAt = opts.purchasedAt ?? new Date();
  const purchasedLabel = purchasedAt.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Brisbane",
  });
  const reference = opts.paymentReference || "";

  const subject = `🎟 Your BVC pass receipt — ${passLabel}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#4f46e5;">Bundaberg Voice Collective</h2>
  <p>Hi ${memberName},</p>
  <p>Thank you for your purchase! Here is your receipt.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">Pass type</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${passLabel}</td>
    </tr>
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">Sessions</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${sessionCount} ${sessionWord}</td>
    </tr>
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">Date</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${purchasedLabel}</td>
    </tr>${reference ? `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">Reference</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${reference}</td>
    </tr>` : ""}
    <tr>
      <td style="padding:8px;font-weight:600;">Amount paid</td>
      <td style="padding:8px;">${currency} $${dollars}</td>
    </tr>
  </table>
  <p>Your sessions have been added to your account. We look forward to seeing you at rehearsal!</p>
  <p style="margin-top:32px;font-size:0.85em;color:#6b7280;">
    — Bundaberg Voice Collective<br>
    <a href="https://bundabergvoicecollective.com.au">bundabergvoicecollective.com.au</a>
  </p>
</body>
</html>`;

  const text = `Hi ${memberName},\n\nThank you for your purchase!\n\nPass: ${passLabel}\nSessions: ${sessionCount} ${sessionWord}\nDate: ${purchasedLabel}${reference ? `\nReference: ${reference}` : ""}\nAmount: ${currency} $${dollars}\n\nYour sessions have been added to your account. See you at rehearsal!\n\n— Bundaberg Voice Collective`;

  return sendEmail({ to, subject, html, text });
}
