/**
 * Read-only: how current the data is, table by table.
 *
 * "The data is a week behind" needs a number before it can be acted on. This
 * reports the newest row in each table that records something happening —
 * rehearsals, attendance, passes, payments, orders — so the gap is measured
 * rather than estimated, and so it is clear which tables are stale and which
 * were never used.
 *
 * Counts and dates only. No names, no addresses, no amounts against people.
 *
 * Usage: DATABASE_URL=... tsx scripts/dataRecency.ts
 */
import mysql from "mysql2/promise";

/** table → the column that says when the thing happened */
const TABLES: [table: string, column: string, label: string][] = [
  ["sessions", "sessionDate", "rehearsals (by session date)"],
  ["sessions", "createdAt", "rehearsals (by when recorded)"],
  ["attendance", "markedAt", "attendance marks"],
  ["passes", "assignedAt", "passes assigned"],
  ["pass_orders", "createdAt", "pass orders"],
  ["user_activity_log", "createdAt", "activity log"],
  ["shop_orders", "createdAt", "shop orders"],
  ["events", "createdAt", "events"],
  ["announcements", "createdAt", "announcements"],
  ["gallery_posts", "createdAt", "gallery posts"],
  ["library_items", "createdAt", "library items"],
  ["rehearsal_recordings", "createdAt", "rehearsal recordings"],
  ["documents", "createdAt", "documents"],
  ["users", "createdAt", "members added"],
  ["users", "lastSignedIn", "member sign-ins"],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const conn = await mysql.createConnection(url);
  const query = async <T>(sql: string): Promise<T> => (await conn.query(sql))[0] as T;

  const [server] = await query<{ db: string; now: string }[]>(
    "SELECT DATABASE() AS db, now() AS now",
  );
  console.log(`Connected to \`${server.db}\`; server time ${server.now}\n`);

  const live = await query<{ TABLE_NAME: string }[]>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
  );
  const have = new Set(live.map((r) => r.TABLE_NAME));

  console.log("                                   rows     newest");
  for (const [table, column, label] of TABLES) {
    if (!have.has(table)) {
      console.log(`${label.padEnd(32)}  (no such table)`);
      continue;
    }
    const [row] = await query<{ n: number; newest: string | null }[]>(
      `SELECT count(*) AS n, max(\`${column}\`) AS newest FROM \`${table}\``,
    );
    const n = Number(row?.n ?? 0);
    const newest = row?.newest ? String(row.newest).slice(0, 16) : "—";
    console.log(`${label.padEnd(32)}  ${String(n).padStart(5)}     ${newest}`);
  }

  // Money, in aggregate. Enough to compare against the books without listing
  // anyone's individual payments.
  if (have.has("pass_orders")) {
    const byStatus = await query<{ status: string; n: number; cents: number | null }[]>(
      `SELECT status, count(*) AS n, sum(amountCents) AS cents
         FROM pass_orders GROUP BY status ORDER BY n DESC`,
    );
    if (byStatus.length) {
      console.log("\nPass orders by status:");
      for (const r of byStatus) {
        const dollars = (Number(r.cents ?? 0) / 100).toFixed(2);
        console.log(`  ${String(r.status).padEnd(12)} ${String(r.n).padStart(4)}   $${dollars}`);
      }
    }
  }

  if (have.has("passes")) {
    const [p] = await query<
      { total: number; active: number | null; remaining: number | null }[]
    >(
      `SELECT count(*) AS total,
              sum(active) AS active,
              sum(CASE WHEN active THEN remainingSessions ELSE 0 END) AS remaining
         FROM passes`,
    );
    console.log(
      `\nPasses: ${Number(p?.total ?? 0)} total, ${Number(p?.active ?? 0)} active, ` +
        `${Number(p?.remaining ?? 0)} sessions outstanding across them`,
    );
  }

  await conn.end();
  console.log(
    "\nCompare the newest dates against what actually happened. Anything that\n" +
      "stops before today is a gap this database does not know about.",
  );
}

main().catch((err) => {
  console.error("\nData recency check FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
