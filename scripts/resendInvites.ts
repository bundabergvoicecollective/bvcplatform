/**
 * Send an invitation again to everyone it never finished for.
 *
 * Four invited people turned out to have no account. An invite writes a row
 * in invite_tokens and sends two emails; it creates no user row. So somebody
 * could accept the invitation, receive the 6-digit code, enter it — and still
 * not exist as a member, because the screen after the code asked them to sign
 * in with a password nobody had ever given them. Their next move was the
 * reset form, which looked for a member, found nobody, sent nothing, and told
 * them a link was on its way.
 *
 * The invite page now takes the password itself, so the link in this email
 * leads somewhere. That is the only reason resending is worth doing: before
 * that deploy it would have walked them into the same dead end.
 *
 * WHO IT WRITES TO. Only addresses holding a live invitation — not used, not
 * expired — that have no user row. Somebody who already has an account is
 * skipped: for them the link is spent and the right advice is to sign in.
 * No member list is read and nobody else is written to. --email= narrows it
 * to one address, and --since= to invitations sent on or after a Brisbane
 * date — which is how you send to the two people who got stuck tonight
 * without also writing to somebody who was invited three weeks ago and never
 * opened it.
 *
 * Report-only unless --apply. The report is worth reading first, because
 * every run of this puts an email in somebody's inbox.
 *
 * Addresses masked and the log cut to initials — this log is public. The
 * message id of each send is printed, which is what the Resend lookup takes.
 *
 * Usage: DATABASE_URL=… SMTP_PASS=… APP_URL=https://… \
 *          tsx scripts/resendInvites.ts [--email=someone@example.com] \
 *          [--since=2026-11-03] [--apply]
 */
import mysql from "mysql2/promise";
import { buildInviteEmail, sendEmailVerbose, verifyEmailTransport } from "../email";

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--email="))?.slice(8).trim().toLowerCase();
/** Brisbane date, inclusive. Invitations sent before it are left alone. */
const SINCE = process.argv.find((a) => a.startsWith("--since="))?.slice(8).trim();

const mask = (e: string) => e.replace(/^(.{2})[^@]*(@.).*(\.[^.]+)$/, "$1•••$2•••$3");

type Row = {
  token: string;
  email: string;
  sent: string;
  verified: string | null;
  resent: string | null;
  expiresAt: Date;
  expires: string;
  userId: number | null;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  // The link has to carry the origin members actually use. Guessing it would
  // send somebody to a host that does not serve this app, and the mistake
  // would only show up as "the link does not work" days later.
  const origin = (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (!origin) throw new Error("APP_URL is not set, and the invite link needs an origin.");

  if (SINCE && !/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) {
    throw new Error("--since takes a Brisbane date as YYYY-MM-DD.");
  }

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  const rows = await q<Row[]>(
    `SELECT i.token, i.email,
            DATE_FORMAT(DATE_ADD(i.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d %H:%i') AS sent,
            DATE_FORMAT(DATE_ADD(i.emailVerifiedAt, INTERVAL 10 HOUR), '%Y-%m-%d %H:%i') AS verified,
            DATE_FORMAT(DATE_ADD(i.lastResentAt, INTERVAL 10 HOUR), '%Y-%m-%d %H:%i') AS resent,
            i.expiresAt,
            DATE_FORMAT(DATE_ADD(i.expiresAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS expires,
            u.id AS userId
       FROM invite_tokens i
       LEFT JOIN users u ON lower(trim(u.email)) = lower(trim(i.email))
      WHERE i.usedAt IS NULL
        AND i.expiresAt > now()
        AND (? IS NULL OR DATE(DATE_ADD(i.createdAt, INTERVAL 10 HOUR)) >= ?)
      ORDER BY i.createdAt DESC`,
    [SINCE ?? null, SINCE ?? null],
  );

  const stuck = rows.filter(
    (r) => !r.userId && (!ONLY || r.email.trim().toLowerCase() === ONLY),
  );
  const haveAccounts = rows.filter((r) => r.userId);

  console.log(
    `${rows.length} live invitation(s)${SINCE ? ` sent on or after ${SINCE}` : ""}; ` +
      `${stuck.length} with no account.\n`,
  );

  if (haveAccounts.length) {
    console.log(`Skipping ${haveAccounts.length} that already have an account — for them the`);
    console.log("invite is spent and the right advice is to sign in:\n");
    for (const r of haveAccounts) console.log(`  ${mask(r.email)}  member #${r.userId}`);
    console.log("");
  }

  if (!stuck.length) {
    console.log(
      ONLY
        ? "Nothing to resend for that address — it has no live invitation without an account."
        : "Nothing to resend. Every live invitation belongs to somebody who has an account.",
    );
    await conn.end();
    process.exit(0);
  }

  for (const r of stuck) {
    console.log(`  ${mask(r.email)}`);
    console.log(`    invited ${r.sent}, code ${r.verified ? `verified ${r.verified}` : "NOT verified"}, expires ${r.expires}`);
    if (r.resent) console.log(`    already resent once: ${r.resent}`);
  }

  if (!APPLY) {
    console.log(`\nReport only — nothing sent. Re-run with --apply to email ${stuck.length === 1 ? "this person" : `these ${stuck.length} people`}.`);
    await conn.end();
    process.exit(0);
  }

  // Fail before writing to anyone rather than halfway through the list: a run
  // that sends to two of three and then dies leaves nobody able to say which
  // two without reading the log.
  if (!process.env.SMTP_PASS) throw new Error("SMTP_PASS is not set, so nothing can be sent.");
  const transport = await verifyEmailTransport();
  if (!transport.ok) throw new Error(`The mail provider refused the login: ${transport.error}`);

  console.log(`\nSending ${stuck.length} invitation(s) from ${origin} …\n`);

  let sent = 0;
  for (const r of stuck) {
    const inviteUrl = `${origin}/invite/${r.token}`;
    const result = await sendEmailVerbose({
      to: r.email,
      ...buildInviteEmail(inviteUrl, new Date(r.expiresAt)),
    });
    if (result.ok) {
      await conn.query("UPDATE invite_tokens SET lastResentAt = now() WHERE token = ?", [r.token]);
      sent++;
      console.log(`  ok    ${mask(r.email)}  id ${result.messageId ?? "(none given)"}`);
      if (result.response) console.log(`        provider said: ${result.response}`);
    } else {
      console.log(`  FAIL  ${mask(r.email)}  ${result.error ?? "no reason given"}`);
    }
  }

  console.log(`\n${sent} of ${stuck.length} accepted by the mail provider.`);
  console.log("Accepted means it left here, not that it arrived. The message ids above are");
  console.log("what the resendlookup audit takes if one of them does not turn up.");

  await conn.end();
  process.exit(sent === stuck.length ? 0 : 1);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
