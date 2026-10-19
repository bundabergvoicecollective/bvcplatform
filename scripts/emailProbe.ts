/**
 * Does outbound email actually leave, and what does the provider say?
 *
 * An invite to andymclucasmusic@gmail.com reported "Invite sent!" and never
 * arrived. That wording only renders when sendEmail() returned true, which
 * means nodemailer completed the SMTP handover — so the failure is after
 * acceptance, somewhere we cannot see from the browser.
 *
 * sendEmail() throws the provider's own answer away: it returns a boolean and
 * keeps neither the message id nor the SMTP response. Without those there is
 * nothing to look up in Resend and nothing to tell a filtered message from a
 * rejected one. This prints both.
 *
 * --to= is required and is the only address written to. No member list is
 * read; nothing is sent to anyone who did not ask for it.
 *
 * Usage:
 *   SMTP_PASS=… tsx scripts/emailProbe.ts --to=someone@example.com [--send]
 */
export {};

import { ENV } from "../_core/env";
import { sendEmailVerbose, verifyEmailTransport } from "../email";

const args = process.argv.slice(2);
const TO = args.find((a) => a.startsWith("--to="))?.slice(5).trim();
const SEND = args.includes("--send");

function describePass(pass: string): string {
  if (!pass) return "NOT SET — nothing can be sent";
  const prefix = pass.startsWith("re_") ? 'starts "re_" (a Resend key)' : "does NOT start \"re_\"";
  return `${pass.length} characters, ${prefix}`;
}

async function main() {
  console.log("What this container is configured to send with:\n");
  console.log(`  host      ${ENV.smtpHost}`);
  console.log(`  port      ${ENV.smtpPort}`);
  console.log(`  user      ${ENV.smtpUser}`);
  console.log(`  password  ${describePass(ENV.smtpPass)}`);
  console.log(`  from      ${ENV.smtpFrom}`);
  console.log("");

  if (!ENV.smtpPass) {
    console.error("::error::SMTP_PASS is not set in this job, so nothing can be tested.");
    process.exit(1);
  }

  console.log("Connecting and logging in (no message sent) …");
  const verified = await verifyEmailTransport();
  if (!verified.ok) {
    console.error(`::error::The provider refused the connection or login: ${verified.error}`);
    process.exit(1);
  }
  console.log("  the provider accepts this login.\n");

  if (!SEND) {
    console.log("Pass --send with --to= to post a real message. Nothing was sent.");
    process.exit(0);
  }
  if (!TO) {
    console.error("::error::--send needs --to=<address>. It will not guess a recipient.");
    process.exit(1);
  }

  const stamp = new Date().toISOString();
  console.log(`Sending one message to ${TO} …`);
  const sent = await sendEmailVerbose({
    to: TO,
    subject: `BVC delivery test — ${stamp}`,
    html:
      `<p>This is a delivery test from the Bundaberg Voice Collective members site.</p>` +
      `<p>If you are reading it, outbound email works to this address.</p><p>Sent ${stamp}.</p>`,
    text: `Delivery test from the BVC members site.\n\nSent ${stamp}.`,
  });

  if (!sent.ok) {
    console.error(`\n::error::The provider REJECTED it: ${sent.error}`);
    console.error("That is its own wording. Nothing was delivered.");
    process.exit(1);
  }

  console.log("\n  accepted by the provider.");
  console.log(`  message id  ${sent.messageId ?? "(none returned)"}`);
  console.log(`  response    ${sent.response ?? "(none returned)"}`);
  console.log(
    "\nAccepted is not delivered. If it does not arrive, it was dropped AFTER\n" +
      "this point — look the message id up in the Resend dashboard, which will\n" +
      "say delivered, bounced or complained, and check the spam folder.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\nEmail probe FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
