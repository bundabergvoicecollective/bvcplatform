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
// --id is for following up a sweep, which prints ids and initials rather than
// names because the log is public. Searching by the initials it gave you
// would be guesswork; the id it gave you is exact.
const ID = process.argv.find((a) => a.startsWith("--id="))?.slice(5);

const initials = (s: string | null) =>
  (s ?? "").trim().split(/\s+/).filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join("") || "—";
const maskEmail = (e: string | null) =>
  !e ? "—" : e.replace(/^(.{2})[^@]*(@.).*(\.[^.]+)$/, "$1•••$2•••$3");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!Q && !ID) throw new Error("Pass --q=<name, login or address> or --id=<member id>.");

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;
  const like = `%${Q}%`;

  const select = `SELECT id, openId, name, firstName, lastName, email, status, role,
            (passwordHash IS NOT NULL AND passwordHash <> '') AS hasPassword,
            DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS created,
            DATE_FORMAT(DATE_ADD(lastSignedIn, INTERVAL 10 HOUR), '%Y-%m-%d') AS lastSeen
       FROM users`;
  type Row = {
    id: number; openId: string; name: string | null; firstName: string | null;
    lastName: string | null; email: string | null; status: string; role: string;
    hasPassword: number; created: string; lastSeen: string;
  };
  const users = ID
    ? await q<Row[]>(`${select} WHERE id = ?`, [Number(ID)])
    : await q<Row[]>(
        `${select}
          WHERE openId LIKE ? OR name LIKE ? OR firstName LIKE ? OR lastName LIKE ?
             OR email LIKE ? OR CONCAT_WS(' ', firstName, lastName) LIKE ?
          ORDER BY id`,
        [like, like, like, like, like, like],
      );

  if (!users.length) {
    console.log(`Nothing matches ${ID ? `#${ID}` : `"${Q}"`}.`);
    await conn.end();
    process.exit(0);
  }

  console.log(`${users.length} account(s) matching ${ID ? `#${ID}` : `"${Q}"`}:\n`);

  for (const u of users) {
    // The name the app will actually show: getDisplayName prefers
    // firstName + lastName, then name, then the address.
    const shown = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.name || u.email || "Member";
    console.log(`  #${u.id}  login "${u.openId}"`);
    console.log(`     shows on their dashboard as: ${[u.firstName, u.lastName].filter(Boolean).length ? initials(shown) : `"${shown}"`}`);
    console.log(`     firstName ${u.firstName ? `"${initials(u.firstName)}"` : "(empty)"}   lastName ${u.lastName ? `"${initials(u.lastName)}"` : "(empty)"}   name ${u.name ? `"${u.name}"` : "(empty)"}`);
    console.log(`     ${maskEmail(u.email)}  ·  ${u.status}  ·  ${u.role}  ·  password ${Number(u.hasPassword) ? "set" : "NOT set"}`);
    console.log(`     joined ${u.created}, last signed in ${u.lastSeen}`);

    // Every rehearsal, and what this member's row says about it. Rows with
    // attended = 0 matter as much as the ones without a row at all: until
    // 27 October the attendance checkbox was disabled for the whole list
    // while any one write was in flight, so taps during a roll could be
    // swallowed. "No row" and "a row saying absent" tell different stories
    // about what happened on the night.
    const rows = await q<{ d: string; title: string; marked: number | null; t: string | null; paidCents: number }[]>(
      `SELECT DATE_FORMAT(DATE_ADD(s.sessionDate, INTERVAL 10 HOUR), '%Y-%m-%d') AS d,
              s.title, a.attended AS marked, a.sessionType AS t,
              (SELECT COALESCE(SUM(o.amountCents), 0) FROM pass_orders o
                WHERE o.userId = ? AND o.sessionId = s.id AND o.status = 'paid') AS paidCents
         FROM sessions s
         LEFT JOIN attendance a ON a.sessionId = s.id AND a.userId = ?
        ORDER BY s.sessionDate DESC`,
      [u.id, u.id],
    );
    const present = rows.filter((r) => Number(r.marked) === 1);
    console.log(`     attendance: present at ${present.length} of ${rows.length} rehearsal(s)`);
    for (const r of rows) {
      const state =
        r.marked === null ? "no row at all"
        : Number(r.marked) === 1 ? `present (${r.t})`
        : `marked ABSENT (${r.t})`;
      const paid = Number(r.paidCents) > 0 ? `, $${(Number(r.paidCents) / 100).toFixed(2)} taken` : "";
      console.log(`       ${r.d}  ${state}${paid}`);
    }

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
