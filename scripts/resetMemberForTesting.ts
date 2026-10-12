/**
 * Puts one member's account back to its pre-migration state, so the first-time
 * set-up journey can be walked through for real.
 *
 * Why this is needed: once someone has set a password, /api/auth/forgot sends
 * them "Reset your BVC password". A member who has never had one gets "Set your
 * password for the new BVC members' site", with different wording throughout.
 * Testing with an already-migrated account therefore tests the wrong path — and
 * the path it does not test is the one all 76 members will take exactly once.
 *
 * Clearing passwordHash returns the account to that state. The member can get
 * back in through the normal set-up email, so nothing here is one-way.
 *
 * Deliberately narrow:
 *   - acts on exactly one address, named explicitly at dispatch
 *   - refuses if that address matches no row, or more than one
 *   - refuses outright on an admin account, so nobody locks themselves out of
 *     the admin side while testing the member side
 *   - reports before and after, and changes nothing without --apply
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/resetMemberForTesting.ts --email=someone@example.com
 *   ... --apply            clear the password
 *   ... --apply --names    also clear firstName/lastName, to see the profile
 *                          form eight members will meet on first login
 */
import mysql from "mysql2/promise";

const arg = (flag: string) =>
  process.argv.find((a) => a.startsWith(`--${flag}=`))?.slice(flag.length + 3);

const APPLY = process.argv.includes("--apply");
const CLEAR_NAMES = process.argv.includes("--names");
const EMAIL = (arg("email") ?? "").toLowerCase().trim();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!EMAIL) throw new Error("Pass --email=<address>. This script will not guess a target.");

  const conn = await mysql.createConnection(url);
  const query = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
    (await conn.query(sql, params))[0] as T;

  // lower(trim(...)) on both sides, matching how the app itself looks members
  // up — users.email is utf8mb4_bin, so an exact compare is case sensitive.
  const rows = await query<
    {
      id: number;
      email: string;
      role: string;
      status: string;
      firstName: string | null;
      lastName: string | null;
      hasPassword: number;
    }[]
  >(
    `SELECT id, email, role, status, firstName, lastName,
            (passwordHash IS NOT NULL AND passwordHash <> '') AS hasPassword
       FROM users WHERE lower(trim(email)) = ?`,
    [EMAIL],
  );

  if (rows.length === 0) throw new Error(`No member matches "${EMAIL}".`);
  if (rows.length > 1) {
    throw new Error(`${rows.length} rows match "${EMAIL}" — refusing to touch any of them.`);
  }

  const user = rows[0]!;
  console.log(`Member #${user.id}  ${user.email}`);
  console.log(`  role        : ${user.role}`);
  console.log(`  status      : ${user.status}`);
  console.log(`  name        : ${[user.firstName, user.lastName].filter(Boolean).join(" ") || "(none)"}`);
  console.log(`  has password: ${user.hasPassword ? "yes" : "no"}\n`);

  if (user.role === "admin") {
    throw new Error(
      "That is an admin account. Refusing — clearing its password would lock you out of the admin side. Use a member account.",
    );
  }

  if (!user.hasPassword && (!CLEAR_NAMES || !user.firstName)) {
    console.log("Already in the pre-migration state. Nothing to do.");
    await conn.end();
    return;
  }

  const sets = ["passwordHash = NULL"];
  if (CLEAR_NAMES) sets.push("firstName = NULL", "lastName = NULL");

  console.log(`Would run: UPDATE users SET ${sets.join(", ")} WHERE id = ${user.id}`);

  if (!APPLY) {
    console.log("\nReport only. Re-run with apply ticked to make the change.");
    await conn.end();
    return;
  }

  await query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [user.id]);

  const [after] = await query<{ hasPassword: number; firstName: string | null }[]>(
    `SELECT (passwordHash IS NOT NULL AND passwordHash <> '') AS hasPassword, firstName
       FROM users WHERE id = ?`,
    [user.id],
  );
  console.log(`\nDone. has password: ${after?.hasPassword ? "yes" : "no"}; first name: ${after?.firstName ?? "(none)"}`);
  console.log(
    "\nThat account is now signed out of nothing — any existing session cookie still\n" +
      "works until it expires, so sign out first, then use \"Set up / forgot password\".",
  );

  await conn.end();
}

main().catch((err) => {
  console.error("\nReset FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
