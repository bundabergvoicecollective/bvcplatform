/**
 * Give named accounts admin rights, by email.
 *
 * Promoting somebody was only possible from inside the admin panel, which is
 * a problem exactly when it matters: if the one admin account is not the one
 * you are signed in to, there is no way in. That is the state this was
 * written for — the only active admin turned out to be a shared address, and
 * the two people who run the choir had no admin rights on their own accounts.
 *
 * It CANNOT create an account. An address with no member row is reported and
 * skipped: a typo that silently made a new admin would be the worst possible
 * failure here, and the right fix for a missing person is an invitation.
 *
 * It never demotes anybody either. Taking rights away is a different decision
 * from granting them, and bundling the two into one run means a mistyped
 * list quietly removes somebody's access.
 *
 * Report-only unless --apply. Addresses masked and names cut to initials —
 * this log is public — but the role, status and whether a password exists are
 * printed in full, because those are the things being decided.
 *
 * Usage: DATABASE_URL=… tsx scripts/grantAdmin.ts \
 *          --emails=a@example.com,b@example.com [--apply]
 */
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const RAW = process.argv.find((a) => a.startsWith("--emails="))?.slice(9) ?? "";

const mask = (e: string) => e.replace(/^(.{2})[^@]*(@.).*(\.[^.]+)$/, "$1•••$2•••$3");
const initials = (first: string | null, last: string | null, name: string | null) => {
  const parts = [first, last].filter(Boolean) as string[];
  const src = parts.length ? parts : (name ?? "").split(/\s+/).filter(Boolean);
  return src.map((p) => `${p[0].toUpperCase()}.`).join("") || "—";
};

type Row = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  role: string;
  status: string;
  hasPassword: number;
  adminMode: number;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const wanted = RAW.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) throw new Error("Pass --emails=a@example.com,b@example.com");

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  const rows = await q<Row[]>(
    `SELECT id, email, firstName, lastName, name, role, status,
            (passwordHash IS NOT NULL AND passwordHash <> '') AS hasPassword,
            adminMode
       FROM users
      WHERE lower(trim(email)) IN (${wanted.map(() => "?").join(",")})`,
    wanted,
  );

  const byEmail = new Map(rows.map((r) => [r.email.trim().toLowerCase(), r]));
  const toPromote: Row[] = [];
  const missing: string[] = [];

  console.log(`${wanted.length} address(es) asked for:\n`);

  for (const email of wanted) {
    const row = byEmail.get(email);
    if (!row) {
      missing.push(email);
      console.log(`  ${mask(email)}`);
      console.log("    NO ACCOUNT — skipped. Invite them; this will not create one.");
      continue;
    }
    console.log(`  ${mask(email)}  #${row.id}  ${initials(row.firstName, row.lastName, row.name)}`);
    console.log(
      `    ${row.status} · ${row.role} · ${Number(row.hasPassword) ? "password set" : "password NOT set"}`,
    );
    if (row.role === "admin") {
      console.log("    already an admin — nothing to do.");
      // The view setting is theirs to change and is not touched here.
      if (!Number(row.adminMode)) console.log("    (currently viewing as a member, which is their own choice)");
    } else {
      toPromote.push(row);
      console.log("    would become: admin");
    }
    if (!Number(row.hasPassword)) {
      console.log("    NOTE: no password on this account, so they cannot sign in to use it yet.");
    }
  }

  // Said plainly, because "how many admins are there?" is the question this
  // run changes the answer to, and it should never be a surprise.
  const [before] = await q<{ n: number }[]>(
    "SELECT count(*) AS n FROM users WHERE role = 'admin' AND status = 'active'",
  );
  console.log(`\nActive admins now: ${before.n}. After applying: ${Number(before.n) + toPromote.length}.`);

  if (!toPromote.length) {
    console.log(missing.length ? "\nNothing to change." : "\nNothing to change — everyone asked for is already an admin.");
    await conn.end();
    process.exit(missing.length ? 1 : 0);
  }

  if (!APPLY) {
    console.log(`\nReport only — nothing written. Re-run with --apply to promote ${toPromote.length}.`);
    await conn.end();
    process.exit(0);
  }

  for (const row of toPromote) {
    await conn.query("UPDATE users SET role = 'admin' WHERE id = ?", [row.id]);
    await conn.query(
      `INSERT INTO user_activity_log (userId, actorId, action, detail) VALUES (?, NULL, 'role_changed', ?)`,
      [row.id, "Granted admin rights"],
    );
    console.log(`  promoted #${row.id} ${mask(row.email)}`);
  }

  const [after] = await q<{ n: number }[]>(
    "SELECT count(*) AS n FROM users WHERE role = 'admin' AND status = 'active'",
  );
  console.log(`\n${toPromote.length} promoted. Active admins: ${after.n}.`);
  console.log("Each of them now has the View as member option on their Profile.");

  await conn.end();
  process.exit(missing.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
