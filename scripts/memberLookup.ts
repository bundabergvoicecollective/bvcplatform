/**
 * Who is this account, and what is attached to it?
 *
 * For the case where a member is showing up under something that is not their
 * name — an openId, a username carried over from an older system — and the
 * question is whether there are two accounts for one person, or one account
 * with the name fields empty. Those look identical from the outside and have
 * completely different fixes: merge, or fill in a name.
 *
 * Matches the token against openId, name, firstName, lastName and email, and
 * prints what each account holds: attendance by type, orders, passes, and
 * whether a password has ever been set here.
 *
 * Read-only. Names are cut to initials and addresses masked — the log is
 * public — except that the login identifier is shown in full, because it is
 * the thing being looked up and is not a secret.
 *
 * Usage: DATABASE_URL=… tsx scripts/memberLookup.ts --q=meakin
 */
import mysql from "mysql2/promise";

const Q = process.argv.find((a) => a.startsWith("--q="))?.slice(4);

const initials = (s: string | null) =>
  (s ?? "").trim().split(/\s+/).filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join("") || "—";
const maskEmail = (e: string | null) =>
  !e ? "—" : e.replace(/^(.{2})[^@]*(@.).*(\.[^.]+)$/, "$1•••$2•••$3");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!Q) throw new Error("Pass --q=<something> — part of a name, login or address.");

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;
  const like = `%${Q}%`;

  const users = await q<{
    id: number; openId: string; name: string | null; firstName: string | null;
    lastName: string | null; email: string | null; status: string; role: string;
    hasPassword: number; created: string; lastSeen: string;
  }[]>(
    `SELECT id, openId, name, firstName, lastName, email, status, role,
            (passwordHash IS NOT NULL AND passwordHash <> '') AS hasPassword,
            DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS created,
            DATE_FORMAT(DATE_ADD(lastSignedIn, INTERVAL 10 HOUR), '%Y-%m-%d') AS lastSeen
       FROM users
      WHERE openId LIKE ? OR name LIKE ? OR firstName LIKE ? OR lastName LIKE ?
         OR email LIKE ? OR CONCAT_WS(' ', firstName, lastName) LIKE ?
      ORDER BY id`,
    [like, like, like, like, like, like],
  );

  if (!users.length) {
    console.log(`Nothing matches "${Q}".`);
    await conn.end();
    process.exit(0);
  }

  console.log(`${users.length} account(s) matching "${Q}":\n`);

  for (const u of users) {
    // The name the app will actually show: getDisplayName prefers
    // firstName + lastName, then name, then the address.
    const shown = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.name || u.email || "Member";
    console.log(`  #${u.id}  login "${u.openId}"`);
    console.log(`     shows on their dashboard as: ${[u.firstName, u.lastName].filter(Boolean).length ? initials(shown) : `"${shown}"`}`);
    console.log(`     firstName ${u.firstName ? `"${initials(u.firstName)}"` : "(empty)"}   lastName ${u.lastName ? `"${initials(u.lastName)}"` : "(empty)"}   name ${u.name ? `"${u.name}"` : "(empty)"}`);
    console.log(`     ${maskEmail(u.email)}  ·  ${u.status}  ·  ${u.role}  ·  password ${Number(u.hasPassword) ? "set" : "NOT set"}`);
    console.log(`     joined ${u.created}, last signed in ${u.lastSeen}`);

    const att = await q<{ sessionType: string; n: number; first: string; last: string }[]>(
      `SELECT a.sessionType, count(*) AS n,
              DATE_FORMAT(DATE_ADD(MIN(s.sessionDate), INTERVAL 10 HOUR), '%Y-%m-%d') AS first,
              DATE_FORMAT(DATE_ADD(MAX(s.sessionDate), INTERVAL 10 HOUR), '%Y-%m-%d') AS last
         FROM attendance a JOIN sessions s ON s.id = a.sessionId
        WHERE a.userId = ? AND a.attended = 1
        GROUP BY a.sessionType`,
      [u.id],
    );
    console.log(`     attendance: ${att.length ? att.map((r) => `${r.n}× ${r.sessionType} (${r.first} → ${r.last})`).join(", ") : "none"}`);

    const dates = await q<{ d: string; t: string }[]>(
      `SELECT DATE_FORMAT(DATE_ADD(s.sessionDate, INTERVAL 10 HOUR), '%Y-%m-%d') AS d, a.sessionType AS t
         FROM attendance a JOIN sessions s ON s.id = a.sessionId
        WHERE a.userId = ? AND a.attended = 1 ORDER BY s.sessionDate`,
      [u.id],
    );
    if (dates.length) console.log(`       ${dates.map((r) => `${r.d} (${r.t})`).join(", ")}`);

    const [orders] = await q<{ n: number; cents: number }[]>(
      "SELECT count(*) AS n, COALESCE(SUM(amountCents),0) AS cents FROM pass_orders WHERE userId = ? AND status = 'paid'",
      [u.id],
    );
    const [pass] = await q<{ n: number; remaining: number }[]>(
      "SELECT count(*) AS n, COALESCE(SUM(remainingSessions),0) AS remaining FROM passes WHERE userId = ?",
      [u.id],
    );
    console.log(`     paid orders: ${orders.n} totalling $${(Number(orders.cents) / 100).toFixed(2)}`);
    console.log(`     passes: ${pass.n} row(s), ${pass.remaining} session(s) remaining\n`);
  }

  if (users.length > 1) {
    console.log("More than one account matched. If these are the same person, the");
    console.log("history is split across them and they need merging — not renaming.");
  }

  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
