/**
 * Close out pending pass orders that were settled some other way.
 *
 * A pending pass_order is a checkout that was started and never finished
 * here: the member paid at a rehearsal instead, or paid on the old platform,
 * or simply changed their mind. Twenty-seven of them had accumulated since
 * May, and on 3 November 2026 they were confirmed settled — nobody holding
 * an outstanding pass or payment.
 *
 * They are marked `cancelled`, not deleted. The row is the only record that
 * the attempt happened, and a count that drops because rows vanished cannot
 * be checked afterwards. Cancelled rows leave the pending count and stay
 * readable.
 *
 * It touches nothing but the status and the note. No pass is granted,
 * revoked or altered, and a `paid` order is never eligible — this cannot
 * take money or sessions off anyone.
 *
 * --before defaults to now, so a checkout started while this runs is left
 * alone rather than cancelled by a decision made before it existed.
 *
 * Report-only unless --apply.
 *
 * Usage: DATABASE_URL=… tsx scripts/clearPendingOrders.ts [--before=2026-11-03] [--apply]
 */
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const BEFORE = process.argv.find((a) => a.startsWith("--before="))?.slice(9);
const REASON =
  process.argv.find((a) => a.startsWith("--reason="))?.slice(9) ??
  "Settled by other means; no pass or payment outstanding.";

const initials = (first: string | null, last: string | null, name: string | null) => {
  const parts = [first, last].filter(Boolean) as string[];
  const src = parts.length ? parts : (name ?? "").split(/\s+/).filter(Boolean);
  return src.map((p) => `${p[0].toUpperCase()}.`).join("") || "?";
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (BEFORE && !/^\d{4}-\d{2}-\d{2}$/.test(BEFORE)) throw new Error("--before must be YYYY-MM-DD");

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  // A cutoff either way: an explicit Brisbane date, or this moment.
  const cutoffSql = BEFORE ? "DATE_SUB(?, INTERVAL 10 HOUR)" : "now()";
  const cutoffParams = BEFORE ? [`${BEFORE} 00:00:00`] : [];

  const rows = await q<{
    id: number;
    d: string;
    passType: string;
    cents: number;
    ref: string | null;
    firstName: string | null;
    lastName: string | null;
    name: string | null;
  }[]>(
    `SELECT o.id, DATE_FORMAT(DATE_ADD(o.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d %H:%i') AS d,
            o.passType, o.amountCents AS cents, o.stripeSessionId AS ref,
            u.firstName, u.lastName, u.name
       FROM pass_orders o LEFT JOIN users u ON u.id = o.userId
      WHERE o.status = 'pending' AND o.createdAt < ${cutoffSql}
      ORDER BY o.createdAt`,
    cutoffParams,
  );

  if (!rows.length) {
    console.log("No pending orders to close.");
    await conn.end();
    process.exit(0);
  }

  console.log(`${rows.length} pending order(s)${BEFORE ? ` created before ${BEFORE}` : ""}:\n`);
  let total = 0;
  for (const r of rows) {
    total += Number(r.cents);
    console.log(
      `  ${APPLY ? "CANCEL" : "would"}  #${String(r.id).padEnd(8)} ${r.d}  ${r.passType.padEnd(16)}` +
        ` $${(Number(r.cents) / 100).toFixed(2).padStart(7)}  ${initials(r.firstName, r.lastName, r.name).padEnd(6)}` +
        `${r.ref ? "" : " (no Square reference)"}`,
    );
  }
  console.log(`\n  $${(total / 100).toFixed(2)} of never-completed checkouts. No money is being`);
  console.log("  written off here — these are attempts, not debts.");

  // Said out loud because it is the whole safety argument.
  const [sanity] = await q<{ withPass: number }[]>(
    `SELECT count(*) AS withPass FROM pass_orders
      WHERE status = 'pending' AND passId IS NOT NULL AND createdAt < ${cutoffSql}`,
    cutoffParams,
  );
  if (Number(sanity.withPass) > 0) {
    console.log(`\n  ${sanity.withPass} of them already have a pass attached, which should not`);
    console.log("  happen for a pending order. Stopping rather than guessing.");
    await conn.end();
    process.exit(1);
  }
  console.log("  None of them has a pass attached, so no balance can be affected.");

  if (!APPLY) {
    console.log("\nReport only — nothing written. Re-run with --apply to close them.");
    await conn.end();
    process.exit(0);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const ids = rows.map((r) => r.id);
  const [res] = (await conn.query(
    `UPDATE pass_orders
        SET status = 'cancelled',
            notes = TRIM(CONCAT(COALESCE(notes, ''), ' ', ?))
      WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'pending'`,
    [`[Cancelled ${stamp}] ${REASON}`, ...ids],
  )) as unknown as [{ affectedRows: number }];

  console.log(`\n${res.affectedRows} order(s) cancelled.`);

  const [left] = await q<{ n: number }[]>(
    "SELECT count(*) AS n FROM pass_orders WHERE status = 'pending'",
  );
  console.log(`${left.n} pending order(s) remain.`);

  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
