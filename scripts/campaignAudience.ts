/**
 * Read-only: who would the "pass has run out" email go to right now?
 *
 * Calls the same getMultipassEmptyAudience() the Email tab uses, so this is
 * the real list, not a reimplementation of the rule. Run it before a first
 * campaign to see who is in and why, and to check nobody is there who only
 * ever pays by the session.
 *
 * Member ids and initials only — the Actions log is public. No addresses.
 *
 * db.ts opens a connection pool at import, which keeps the process alive, so
 * every path out exits explicitly.
 *
 * Usage: DATABASE_URL=… tsx scripts/campaignAudience.ts
 */
import mysql from "mysql2/promise";
import { getMultipassEmptyAudience } from "../db";

const initials = (first: string | null, last: string | null, name: string | null) => {
  const parts = [first, last].filter(Boolean) as string[];
  const src = parts.length ? parts : (name ?? "").split(/\s+/).filter(Boolean);
  return src.map((p) => `${p[0].toUpperCase()}.`).join("") || "—";
};

async function main() {
  const rows = await getMultipassEmptyAudience();
  const reachable = rows.filter((r) => !r.optedOut);
  console.log(`${reachable.length} member(s) would get the email; ${rows.length - reachable.length} unsubscribed.\n`);
  for (const r of rows) {
    const why = r.boughtMulti > 0 ? `bought a multi-pass (${r.boughtMulti} order(s))` : `held a ${r.biggestPass}-session pass, no order`;
    console.log(
      `  #${String(r.id).padEnd(8)} ${initials(r.firstName, r.lastName, r.name).padEnd(7)} ${why}` +
        `${r.lastPassAt ? ` · last pass ${r.lastPassAt}` : ""}` +
        `${r.lastEmailedAt ? ` · emailed ${r.lastEmailedAt}` : ""}` +
        `${r.optedOut ? "  UNSUBSCRIBED" : ""}`,
    );
  }
  const noOrder = rows.filter((r) => r.boughtMulti === 0).length;
  if (noOrder) {
    console.log(`\n${noOrder} are in because they held a pass of 5+ sessions with no order behind it —`);
    console.log("passes assigned by hand, or paper cards carried over. Untick any who shouldn't be.");
  }
  // How the list was made: every active member with nothing left, and which
  // side of the rule they fell on. Without this, a short list cannot be told
  // apart from a rule that is quietly leaving people out.
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [zero] = (await conn.query(`
    SELECT u.id, u.firstName, u.lastName, u.name,
           (u.email IS NOT NULL AND TRIM(u.email) <> '') AS hasEmail,
           (SELECT COUNT(*) FROM pass_orders o WHERE o.userId = u.id AND o.status = 'paid' AND o.passType IN ('5-pass','10-pass')) AS multiOrders,
           (SELECT COUNT(*) FROM pass_orders o WHERE o.userId = u.id AND o.status = 'paid' AND o.passType = 'single') AS singleOrders,
           (SELECT COUNT(*) FROM passes p WHERE p.userId = u.id) AS passCount,
           COALESCE((SELECT MAX(p.totalSessions) FROM passes p WHERE p.userId = u.id), 0) AS biggestPass,
           (SELECT COUNT(*) FROM passes p WHERE p.userId = u.id AND p.active = 1) AS activePasses,
           (SELECT COUNT(*) FROM attendance a WHERE a.userId = u.id) AS attended
      FROM users u
     WHERE u.status = 'active'
       AND COALESCE((SELECT SUM(p.remainingSessions) FROM passes p WHERE p.userId = u.id AND p.active = 1), 0) = 0
     ORDER BY u.id`)) as unknown as [Array<Record<string, number | string | null>>];
  await conn.end();

  const inList = new Set(rows.map((r) => r.id));
  console.log(`\nEvery active member with 0 sessions left: ${zero.length}`);
  const tally = new Map<string, number>();
  for (const z of zero) {
    const why = inList.has(Number(z.id))
      ? "IN the list"
      : !Number(z.hasEmail)
        ? "out: no email address"
        : Number(z.passCount) === 0
          ? "out: never had a pass (pays by the session, or never attended)"
          : "out: only a small pass under 5 sessions, no 5/10-pass order";
    tally.set(why, (tally.get(why) ?? 0) + 1);
    console.log(
      `  #${String(z.id).padEnd(8)} ${initials(z.firstName as string | null, z.lastName as string | null, z.name as string | null).padEnd(7)} ` +
        `${why.padEnd(64)} passes:${z.passCount} biggest:${z.biggestPass} 5/10 orders:${z.multiOrders} singles:${z.singleOrders} attended:${z.attended}`,
    );
  }
  console.log("\nSummary:");
  for (const [k, v] of tally) console.log(`  ${String(v).padStart(3)}  ${k}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
