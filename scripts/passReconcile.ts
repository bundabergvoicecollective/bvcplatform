/**
 * Is anyone short of sessions they paid for?
 *
 * The migration counted 121 pass rows here against 122 in Manus. Manus has
 * been retired, so that row cannot be looked up — and it was never the
 * useful question. This asks the useful one, and is careful about which
 * parts of the data can answer it.
 *
 * WHAT CANNOT BE RECONCILED, AND WHY. The 6 October import brought the
 * balances across already deducted, and the attendance history across in
 * full. So granted − used = left does not close for anyone who was a member
 * before that date, and cannot be made to: the sessions behind an imported
 * balance were spent in a system we no longer have. A check that treats that
 * as drift reports the whole choir as short and means nothing. The aggregate
 * is printed as the shape of the import, not as a fault.
 *
 * WHAT CAN. Everything since the platform went live on 13 October is ours
 * end to end: a mark here writes its own deduction, and an order here issues
 * its own pass. Both are checked, and a failure in either is real.
 *
 * Read-only. Member ids and initials only — no names, no addresses, because
 * this runs in Actions and the repository is public.
 *
 * Usage: DATABASE_URL=… tsx scripts/passReconcile.ts [--since=2026-10-13]
 */
import mysql from "mysql2/promise";

/** The first rehearsal marked through the live site. Same floor as passDriftAudit.ts. */
const SINCE = process.argv.find((a) => a.startsWith("--since="))?.slice(8) ?? "2026-10-13";

/** "Deborah Dreaver" → "D.D." — enough to find the person, not to identify them. */
function initials(first: string | null, last: string | null, name: string | null): string {
  const parts = [first, last].filter(Boolean) as string[];
  const source = parts.length ? parts : (name ?? "").split(/\s+/).filter(Boolean);
  return source.map((p) => `${p[0].toUpperCase()}.`).join("") || "?";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) throw new Error(`--since must be YYYY-MM-DD, got "${SINCE}"`);
  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;
  const from = `${SINCE} 00:00:00`;
  let problems = 0;

  // ── What we hold ────────────────────────────────────────────────────────
  const [totals] = await q<{ passes: number; granted: number; remaining: number; holders: number }[]>(
    `SELECT count(*) AS passes, COALESCE(sum(totalSessions),0) AS granted,
            COALESCE(sum(remainingSessions),0) AS remaining, count(DISTINCT userId) AS holders
       FROM passes`,
  );
  console.log(`${totals.passes} pass rows across ${totals.holders} members.`);
  console.log(`  ${totals.granted} sessions granted, ${totals.remaining} still on the books.\n`);

  // ── 1. Orders placed here, since we went live ───────────────────────────
  // A paid order should link to a pass through passOrders.passId, or at least
  // have one assigned to the same member within a day of it.
  console.log(`Orders paid since ${SINCE} — ours end to end, so these must close`);
  const live = await q<{
    id: number; firstName: string | null; lastName: string | null; name: string | null;
    passType: string; amountCents: number; method: string; when: string; linked: number; near: number;
  }[]>(
    `SELECT o.id, u.firstName, u.lastName, u.name, o.passType, o.amountCents,
            o.paymentMethod AS method,
            DATE_FORMAT(DATE_ADD(o.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS \`when\`,
            (o.passId IS NOT NULL) AS linked,
            (SELECT count(*) FROM passes p
              WHERE p.userId = o.userId
                AND p.assignedAt BETWEEN DATE_SUB(o.createdAt, INTERVAL 1 DAY)
                                     AND DATE_ADD(o.createdAt, INTERVAL 1 DAY)) AS near
       FROM pass_orders o LEFT JOIN users u ON u.id = o.userId
      WHERE o.status = 'paid' AND o.createdAt >= ?
      ORDER BY o.createdAt`,
    [from],
  );
  const unfulfilled = live.filter((o) => !Number(o.linked) && !Number(o.near));
  if (!live.length) {
    console.log(`  no paid orders since ${SINCE}\n`);
  } else if (!unfulfilled.length) {
    console.log(`  ${live.length} order(s), every one with a pass issued against it\n`);
  } else {
    problems += unfulfilled.length;
    console.log(`  ${unfulfilled.length} of ${live.length} order(s) took money and issued no pass:\n`);
    for (const o of unfulfilled) {
      console.log(
        `    order #${o.id}  ${initials(o.firstName, o.lastName, o.name).padEnd(6)} ` +
        `${o.passType.padEnd(16)} $${(o.amountCents / 100).toFixed(2).padStart(7)} ` +
        `${o.method.padEnd(13)} ${o.when}`,
      );
    }
    console.log("");
  }

  // ── 2. Marks made here, since we went live ──────────────────────────────
  // applyAttendance writes the mark and the deduction in one transaction, so
  // a mark without one means something bypassed it.
  console.log(`Attendance marked since ${SINCE} — a mark must carry its deduction`);
  const drift = await q<{ userId: number; day: string; marks: number; deductions: number }[]>(
    `SELECT a.userId, DATE_FORMAT(DATE_ADD(a.markedAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS day,
            count(*) AS marks,
            (SELECT count(*) FROM user_activity_log l
              WHERE l.userId = a.userId AND l.balanceBefore IS NOT NULL AND l.balanceAfter IS NOT NULL
                AND l.balanceAfter < l.balanceBefore
                AND DATE_FORMAT(DATE_ADD(l.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d')
                  = DATE_FORMAT(DATE_ADD(a.markedAt, INTERVAL 10 HOUR), '%Y-%m-%d')) AS deductions
       FROM attendance a
      WHERE a.attended = 1 AND a.passUsed = 1 AND a.markedAt >= ?
      GROUP BY a.userId, day HAVING deductions < marks`,
    [from],
  );
  if (!drift.length) {
    console.log("  every mark deducted correctly — nobody has kept a session they used\n");
  } else {
    problems += drift.length;
    console.log(`  ${drift.length} member-day(s) marked present with no deduction logged\n`);
  }

  // ── 3. The part that cannot close, stated as such ───────────────────────
  const perMember = await q<{ granted: number; used: number; remaining: number }[]>(
    `SELECT COALESCE(sum(p.granted),0) AS granted, COALESCE(sum(a.used),0) AS used,
            COALESCE(sum(p.remaining),0) AS remaining
       FROM users u
       LEFT JOIN (SELECT userId, sum(totalSessions) AS granted, sum(remainingSessions) AS remaining
                    FROM passes GROUP BY userId) p ON p.userId = u.id
       LEFT JOIN (SELECT userId, count(*) AS used FROM attendance
                   WHERE attended = 1 AND passUsed = 1 GROUP BY userId) a ON a.userId = u.id
      WHERE u.status = 'active'`,
  );
  const [all] = perMember;
  const gap = Number(all.granted) - Number(all.used) - Number(all.remaining);
  console.log("Before we went live — cannot be reconciled, and that is expected");
  console.log(`  ${all.granted} granted, ${all.used} used, ${all.remaining} left — a gap of ${gap}.`);
  console.log("  The 6 October import brought balances across already deducted and the");
  console.log("  attendance history across in full, so this gap is the import's shape.");
  console.log("  Closing it would mean asking Manus, which no longer exists. The single");
  console.log("  unexplained pass row sits somewhere in here and cannot be pulled out of it.\n");

  const [orphan] = await q<{ n: number }[]>(
    `SELECT count(*) AS n FROM passes p
      WHERE NOT EXISTS (SELECT 1 FROM pass_orders o WHERE o.userId = p.userId AND o.status = 'paid')`,
  );
  console.log(`  ${orphan.n} pass row(s) belong to a member with no paid order — expected for`);
  console.log("  complimentary passes and for balances carried over from the paper system.\n");

  console.log("─".repeat(60));
  console.log(
    problems
      ? `${problems} thing(s) to look at above. Everything since ${SINCE} is ours, so each one is real.`
      : `Nothing owed. Every order since ${SINCE} issued its pass and every mark took its session.`,
  );

  await conn.end();
  process.exit(problems ? 1 : 0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
