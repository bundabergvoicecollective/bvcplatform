/**
 * Where did an invited member get stuck?
 *
 * Being invited and having an account are different things, and the gap
 * between them is invisible. An invite creates a token and sends an email; it
 * does not create a user. So somebody can accept the invite, receive the
 * verification code, enter it — and still have no account. When they then ask
 * for a password reset, /api/auth/forgot finds no user, sends nothing, and
 * tells them a link is on its way, because answering the same way for a
 * stranger and a member is what stops the form being used to discover who is
 * in the choir. Correct, and indistinguishable from a broken mail server.
 *
 * This shows each invite's real state: sent, code verified, account exists,
 * password set, used. The row where it stops is where the person is stuck.
 *
 * Read-only. Addresses masked and names cut to initials — the log is public.
 *
 * Usage: DATABASE_URL=… tsx scripts/inviteStatus.ts [--days=14]
 */
import mysql from "mysql2/promise";

const DAYS = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) ?? 14);

const mask = (e: string | null) =>
  !e ? "—" : e.replace(/^(.{2})[^@]*(@.).*(\.[^.]+)$/, "$1•••$2•••$3");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!Number.isInteger(DAYS) || DAYS < 1) throw new Error("--days must be a whole number");

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  const rows = await q<{
    email: string;
    sent: string;
    verified: string | null;
    used: string | null;
    expires: string;
    userId: number | null;
    status: string | null;
    hasPassword: number | null;
    resets: number;
  }[]>(
    `SELECT i.email,
            DATE_FORMAT(DATE_ADD(i.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d %H:%i') AS sent,
            DATE_FORMAT(DATE_ADD(i.emailVerifiedAt, INTERVAL 10 HOUR), '%Y-%m-%d %H:%i') AS verified,
            DATE_FORMAT(DATE_ADD(i.usedAt, INTERVAL 10 HOUR), '%Y-%m-%d %H:%i') AS used,
            DATE_FORMAT(DATE_ADD(i.expiresAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS expires,
            u.id AS userId, u.status,
            (u.passwordHash IS NOT NULL AND u.passwordHash <> '') AS hasPassword,
            (SELECT count(*) FROM password_resets r WHERE r.userId = u.id) AS resets
       FROM invite_tokens i
       LEFT JOIN users u ON lower(trim(u.email)) = lower(trim(i.email))
      WHERE i.createdAt >= DATE_SUB(now(), INTERVAL ? DAY)
      ORDER BY i.createdAt DESC`,
    [DAYS],
  );

  if (!rows.length) {
    console.log(`No invites in the last ${DAYS} days.`);
    await conn.end();
    process.exit(0);
  }

  console.log(`${rows.length} invite(s) in the last ${DAYS} days:\n`);

  let stuck = 0;
  for (const r of rows) {
    const stage = r.used
      ? `done ${r.used}`
      : !r.userId
        ? "NO ACCOUNT — a password reset will send them nothing"
        : !Number(r.hasPassword)
          ? "account exists, no password set"
          : "has a password, not marked used";
    if (!r.used && !r.userId) stuck++;

    console.log(`  ${mask(r.email)}`);
    console.log(`    invited ${r.sent}, code ${r.verified ? `verified ${r.verified}` : "NOT verified"}, expires ${r.expires}`);
    console.log(`    ${stage}${r.userId ? ` (member #${r.userId}, ${r.status}, ${r.resets} reset(s) requested)` : ""}`);
  }

  if (stuck) {
    console.log(`\n${stuck} invited ${stuck === 1 ? "person has" : "people have"} no account.`);
    console.log("For them the reset form is a dead end: it finds no user, sends no email,");
    console.log("and says a link is on its way — the same answer it gives a stranger, which");
    console.log("is what stops it being used to discover who is a member.");
    console.log("\nThey need the invite link again, not a password reset.");
  }

  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
