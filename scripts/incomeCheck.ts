/**
 * Read-only: what income is recorded against the most recent rehearsals, and
 * what is floating unattached?
 *
 * The dashboard's "Last Rehearsal — Income" tile showed $0.00 cash for the
 * 13 October rehearsal when cash had been taken. There are two candidate
 * explanations and they need completely different fixes:
 *
 *   not recorded   nobody has entered it yet; nothing is wrong with the code
 *   not matched    it was entered, but on a different calendar day — the tile
 *                  joins orders to a session by DATE(createdAt), and a
 *                  pass_order carries no session link at all
 *
 * Amounts, methods and dates only. No names, no addresses.
 *
 * Usage: DATABASE_URL=... tsx scripts/incomeCheck.ts
 */
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string): Promise<T> => (await conn.query(sql))[0] as T;

  const sessions = await q<{ id: number; title: string; d: string }[]>(
    "SELECT id, title, DATE_FORMAT(sessionDate, '%Y-%m-%d') AS d FROM sessions ORDER BY sessionDate DESC LIMIT 4",
  );
  console.log("The last few rehearsals:");
  for (const s of sessions) console.log(`  #${s.id}  ${s.d}  ${s.title}`);

  console.log("\nEvery paid pass_order from the last 10 days, by the day it was RECORDED:");
  const orders = await q<
    { d: string; method: string | null; n: number; cents: number }[]
  >(
    `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') AS d,
            paymentMethod AS method,
            count(*) AS n,
            SUM(amountCents) AS cents
       FROM pass_orders
      WHERE status = 'paid' AND createdAt >= DATE_SUB(now(), INTERVAL 10 DAY)
      GROUP BY d, method
      ORDER BY d DESC, method`,
  );
  if (!orders.length) {
    console.log("  (none at all in that window)");
  } else {
    for (const o of orders) {
      const onASession = sessions.some((s) => s.d === o.d);
      console.log(
        `  ${o.d}  ${(o.method ?? "—").padEnd(14)} ${String(o.n).padStart(3)} order(s)  $${(Number(o.cents) / 100).toFixed(2)}` +
          (onASession ? "   ← falls on a rehearsal date" : "   ← NOT a rehearsal date, so the tile will not show it"),
      );
    }
  }

  console.log("\nCash and complimentary orders specifically, last 30 days:");
  const cash = await q<{ d: string; t: string; method: string; cents: number; hasUser: number }[]>(
    `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') AS d,
            DATE_FORMAT(createdAt, '%H:%i') AS t,
            paymentMethod AS method,
            amountCents AS cents,
            (userId IS NOT NULL) AS hasUser
       FROM pass_orders
      WHERE status = 'paid'
        AND paymentMethod IN ('cash', 'complimentary')
        AND createdAt >= DATE_SUB(now(), INTERVAL 30 DAY)
      ORDER BY createdAt DESC`,
  );
  if (!cash.length) {
    console.log("  NONE. No cash has been recorded in the last 30 days — so the $0.00 is");
    console.log("  the honest answer and the money has not been entered yet.");
  } else {
    for (const c of cash) {
      console.log(
        `  ${c.d} ${c.t} UTC  ${c.method.padEnd(14)} $${(Number(c.cents) / 100).toFixed(2)}` +
          (c.hasUser ? "" : "  (no member attached)"),
      );
    }
    console.log(
      "\n  Times are UTC. Brisbane is UTC+10, so a payment entered before 10am\n" +
        "  Brisbane shows here on the PREVIOUS day — which is the other half of\n" +
        "  why DATE(createdAt) is the wrong thing to match a rehearsal on.",
    );
  }

  console.log("\nSquare orders with no member attached (these need assigning by hand):");
  const orphans = await q<{ d: string; cents: number; passType: string }[]>(
    `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') AS d, amountCents AS cents, passType
       FROM pass_orders
      WHERE status = 'paid' AND userId IS NULL
      ORDER BY createdAt DESC LIMIT 20`,
  );
  if (!orphans.length) console.log("  (none)");
  else for (const o of orphans) console.log(`  ${o.d}  $${(Number(o.cents) / 100).toFixed(2)}  ${o.passType}`);

  await conn.end();
}

main().catch((err) => {
  console.error("\nIncome check FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
