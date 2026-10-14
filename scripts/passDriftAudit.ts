/**
 * Read-only: has any attendance mark failed to move the pass it should have?
 *
 * Marking someone present through the admin UI does two writes — the
 * attendance row, then the deduction — and they are not in one transaction
 * (routers.ts, attendance.mark). If the second fails, the member is recorded
 * as present and keeps the session, and nothing says so. Rows written straight
 * into the database drift the same way: the 6 October import did exactly that,
 * deliberately, because the balances came from Manus already deducted.
 *
 * Every successful deduction writes a user_activity_log row carrying
 * balanceBefore and balanceAfter. So an attendance row that claims a pass was
 * used, with no deduction logged for that member on that day, is drift.
 *
 * --since=YYYY-MM-DD limits the window. It defaults to 13 October 2026, the
 * first rehearsal marked through the live site: before that the 33 imported
 * rows would all be flagged, which is true but already known and not useful.
 *
 * Counts and member ids only — no names, no addresses. This runs in Actions
 * and the repository is public.
 *
 * Usage: DATABASE_URL=... tsx scripts/passDriftAudit.ts [--since=2026-10-13]
 */
import mysql from "mysql2/promise";

const SINCE = process.argv.find((a) => a.startsWith("--since="))?.slice("--since=".length) ?? "2026-10-13";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) throw new Error(`--since must be YYYY-MM-DD, got "${SINCE}"`);

  const conn = await mysql.createConnection(url);
  const query = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
    (await conn.query(sql, params))[0] as T;

  console.log(`Attendance marks since ${SINCE} that claim a pass was used.\n`);

  // Brisbane days on both sides, so a Tuesday-evening mark is compared against
  // a Tuesday-evening log entry rather than slipping across a UTC midnight.
  const rows = await query<
    { userId: number; day: string; marks: number; deductions: number }[]
  >(
    `SELECT a.userId AS userId,
            DATE_FORMAT(DATE_ADD(a.markedAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS day,
            count(*) AS marks,
            (SELECT count(*) FROM user_activity_log l
              WHERE l.userId = a.userId
                AND l.balanceBefore IS NOT NULL
                AND l.balanceAfter IS NOT NULL
                AND l.balanceAfter < l.balanceBefore
                AND DATE_FORMAT(DATE_ADD(l.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d')
                    = DATE_FORMAT(DATE_ADD(a.markedAt, INTERVAL 10 HOUR), '%Y-%m-%d')
            ) AS deductions
       FROM attendance a
      WHERE a.attended = 1
        AND a.passUsed = 1
        AND a.markedAt >= ?
      GROUP BY a.userId, day
      ORDER BY day, a.userId`,
    [`${SINCE} 00:00:00`],
  );

  if (!rows.length) {
    console.log("No pass-using attendance in that window at all.");
    await conn.end();
    return;
  }

  const drift = rows.filter((r) => Number(r.deductions) < Number(r.marks));
  const totalMarks = rows.reduce((n, r) => n + Number(r.marks), 0);

  console.log(`${totalMarks} mark(s) across ${rows.length} member-days.\n`);

  if (!drift.length) {
    console.log("Every one has a matching deduction logged. Nothing has drifted.");
  } else {
    console.log(`${drift.length} member-day(s) where a pass was marked used but no`);
    console.log("deduction was logged — the member kept the session:\n");
    for (const r of drift) {
      console.log(`  user #${r.userId}  ${r.day}  ${r.marks} mark(s), ${r.deductions} deduction(s) logged`);
    }
    console.log(
      "\nFix by hand under Admin → Members: adjust the balance down by the\n" +
        "difference. Do not re-mark attendance — the row is already there, and\n" +
        "re-marking will not deduct for a mark it already considers made.",
    );
  }

  // The other half: deductions with no attendance behind them. Rarer, but it
  // is the one that takes sessions off a member who was not there.
  const orphans = await query<{ n: number }[]>(
    `SELECT count(*) AS n
       FROM user_activity_log l
      WHERE l.action = 'attendance_marked'
        AND l.balanceAfter < l.balanceBefore
        AND l.createdAt >= ?
        AND NOT EXISTS (
          SELECT 1 FROM attendance a
           WHERE a.userId = l.userId
             AND a.passUsed = 1
             AND DATE_FORMAT(DATE_ADD(a.markedAt, INTERVAL 10 HOUR), '%Y-%m-%d')
                 = DATE_FORMAT(DATE_ADD(l.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d')
        )`,
    [`${SINCE} 00:00:00`],
  );
  const n = Number(orphans[0]?.n ?? 0);
  console.log(
    n
      ? `\n! ${n} deduction(s) logged with no pass-using attendance on the same day —\n  somebody may have lost a session they should still have.`
      : "\nNo deductions without attendance behind them either.",
  );

  await conn.end();
}

main().catch((err) => {
  console.error("\nPass drift audit FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
