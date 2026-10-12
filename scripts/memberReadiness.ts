/**
 * Read-only: how ready the 76 imported members are to be invited.
 *
 * Three things in the member's first-login path depend on their row, and each
 * one stops an invited member cold:
 *
 *   status = "pending"   client/components/BVCLayout.tsx blocks the whole app
 *                        and shows a holding screen. They would set a password,
 *                        sign in, and be told they are awaiting approval — which
 *                        to anyone non-technical reads as "it didn't work".
 *   status = "denied"    the same holding screen, worded worse.
 *   no firstName         BVCLayout force-redirects to /profile before anything
 *                        else, so their first sight of the site is a form.
 *
 * And one that changes the email they get rather than blocking them:
 *
 *   passwordHash set     /api/auth/forgot sends "Reset your BVC password"
 *                        instead of "Set your password for the new BVC members'
 *                        site". Confusing for someone who never had one.
 *
 * Counts only — no names, no addresses. GitHub Actions logs are readable by
 * anyone with repository access.
 *
 * Usage: DATABASE_URL=... tsx scripts/memberReadiness.ts
 */
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const conn = await mysql.createConnection(url);
  const query = async <T>(sql: string): Promise<T> => (await conn.query(sql))[0] as T;

  const [server] = await query<{ db: string }[]>("SELECT DATABASE() AS db");
  console.log(`Connected to \`${server.db}\`\n`);

  const byStatus = await query<{ status: string; n: number }[]>(
    "SELECT status, count(*) AS n FROM users GROUP BY status ORDER BY n DESC",
  );
  console.log("By status:");
  for (const r of byStatus) console.log(`  ${String(r.status).padEnd(10)} ${r.n}`);

  const [counts] = await query<
    {
      total: number;
      admins: number | null;
      withPassword: number | null;
      noFirstName: number | null;
      noEmail: number | null;
      blocked: number | null;
      readyToInvite: number | null;
    }[]
  >(
    `SELECT count(*) AS total,
            sum(role = 'admin') AS admins,
            sum(passwordHash IS NOT NULL AND passwordHash <> '') AS withPassword,
            sum(firstName IS NULL OR firstName = '') AS noFirstName,
            sum(email IS NULL OR email = '') AS noEmail,
            sum(status IN ('pending','denied')) AS blocked,
            sum(status = 'active' AND email IS NOT NULL AND email <> ''
                AND firstName IS NOT NULL AND firstName <> '') AS readyToInvite
       FROM users`,
  );

  const n = (v: number | null | undefined) => Number(v ?? 0);
  console.log(`\nMembers                        : ${n(counts?.total)}`);
  console.log(`  admins                       : ${n(counts?.admins)}`);
  console.log(`  already have a password      : ${n(counts?.withPassword)}`);
  console.log(`  no email address             : ${n(counts?.noEmail)}`);
  console.log(`  no first name                : ${n(counts?.noFirstName)}`);
  console.log(`  BLOCKED (pending or denied)  : ${n(counts?.blocked)}`);
  console.log(`  clean path to the dashboard  : ${n(counts?.readyToInvite)}`);

  const blocked = n(counts?.blocked);
  const noFirst = n(counts?.noFirstName);
  const noEmail = n(counts?.noEmail);

  console.log();
  if (blocked > 0) {
    console.log(
      `ACTION: ${blocked} member(s) would set a password, sign in, and hit the\n` +
        `        "awaiting approval" screen. Set them active before inviting, or\n` +
        `        leave them out of the invite.`,
    );
  }
  if (noFirst > 0) {
    console.log(
      `NOTE  : ${noFirst} member(s) have no first name, so their first sight of\n` +
        `        the site is the profile form rather than the dashboard.`,
    );
  }
  if (noEmail > 0) {
    console.log(`NOTE  : ${noEmail} member(s) have no address and cannot be emailed at all.`);
  }
  if (!blocked && !noFirst && !noEmail) {
    console.log("Nothing in the way — every member has a clean path to the dashboard.");
  }

  await conn.end();
}

main().catch((err) => {
  console.error("\nMember readiness check FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
