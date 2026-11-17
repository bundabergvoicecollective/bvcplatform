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
 * ── it follows the dashboard's rules, not its own ──
 *
 * It used to group orders by DATE(createdAt) in UTC and flag anything not on
 * a rehearsal date as "the tile will not show it". Both were wrong by the
 * time it was next read: Brisbane is UTC+10, so a Tuesday 9am online
 * purchase printed as Monday, and the tile had long since stopped matching
 * on the exact day. A $140 pass bought on the morning of 10 November was
 * reported as a stray 9 November payment the dashboard would never count,
 * when the dashboard had counted it correctly all along.
 *
 * The tile adds two things, and they are attributed differently:
 *
 *   Square   fetched live from Square for the rehearsal's own Brisbane day.
 *            A Square payment counts on a night's tile only if it was taken
 *            on that day; one bought online between rehearsals is on no
 *            night's tile, which is correct — it was not taken at one.
 *   cash     (and bank transfers, and complimentary) read from pass_orders:
 *            the rehearsal the order was recorded against, or for rows older
 *            than that link, the rehearsal on or before the Brisbane day it
 *            was entered, up to the next one.
 *
 * Every date and time here is Brisbane.
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
    "SELECT id, title, DATE_FORMAT(DATE_ADD(sessionDate, INTERVAL 10 HOUR), '%Y-%m-%d') AS d FROM sessions ORDER BY sessionDate DESC LIMIT 4",
  );
  console.log("The last few rehearsals (all dates and times below are Brisbane):");
  for (const s of sessions) console.log(`  #${s.id}  ${s.d}  ${s.title}`);

  // Every rehearsal's Brisbane day, oldest first, so each order can find the
  // one it belongs to. Fetched wide enough to cover the 14-day order window.
  const allSessions = await q<{ id: number; d: string }[]>(
    `SELECT id, DATE_FORMAT(DATE_ADD(sessionDate, INTERVAL 10 HOUR), '%Y-%m-%d') AS d
       FROM sessions
      WHERE sessionDate >= DATE_SUB(now(), INTERVAL 60 DAY)
      ORDER BY sessionDate`,
  );
  const sessionById = new Map(allSessions.map((x) => [x.id, x]));
  /** The rehearsal on or before a Brisbane day — the one cash entered then belongs to. */
  const onOrBefore = (d: string) => [...allSessions].reverse().find((x) => x.d <= d);

  console.log("\nEvery paid order from the last 14 days, in Brisbane time, and the");
  console.log("rehearsal tile it counts on:");
  const orders = await q<
    { d: string; t: string; method: string | null; channel: string | null; cents: number; sessionId: number | null; passType: string }[]
  >(
    `SELECT DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS d,
            DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 10 HOUR), '%a %H:%i') AS t,
            paymentMethod AS method,
            paymentChannel AS channel,
            amountCents AS cents,
            sessionId,
            passType
       FROM pass_orders
      WHERE status = 'paid' AND createdAt >= DATE_SUB(now(), INTERVAL 14 DAY)
      ORDER BY createdAt DESC`,
  );

  if (!orders.length) {
    console.log("  (none at all in that window)");
  } else {
    let unplaced = 0;
    for (const o of orders) {
      const method = o.method ?? "—";
      const how = o.channel && o.channel !== method ? `${method}/${o.channel}` : method;
      let where: string;
      if (method === "square" || method === "stripe") {
        // The tile asks Square for the rehearsal's own day, nothing wider.
        const night = allSessions.find((x) => x.d === o.d);
        if (night) {
          where = `→ #${night.id} ${night.d}  (taken on the night)`;
        } else {
          where = "→ no rehearsal tile: taken between rehearsals, which is correct";
          unplaced++;
        }
      } else {
        const linked = o.sessionId != null ? sessionById.get(o.sessionId) : undefined;
        const night = linked ?? onOrBefore(o.d);
        where = night
          ? `→ #${night.id} ${night.d}  (${linked ? "recorded against it" : "matched by the day it was entered"})`
          : "→ NO rehearsal found on or before this day";
      }
      console.log(
        `  ${o.d} ${o.t}  ${how.padEnd(18)} $${(Number(o.cents) / 100).toFixed(2).padStart(7)}  ${o.passType.padEnd(16)} ${where}`,
      );
    }
    if (unplaced) {
      console.log(
        `\n  ${unplaced} Square payment(s) were made between rehearsals — usually a pass bought\n` +
          "  online. Those members have their sessions; the money is in Square's own\n" +
          "  reports. It is on no rehearsal's income tile because it was not taken at one.",
      );
    }
  }

  console.log("\nCash and complimentary orders specifically, last 30 days:");
  const cash = await q<{ d: string; t: string; method: string; cents: number; hasUser: number }[]>(
    `SELECT DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS d,
            DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 10 HOUR), '%H:%i') AS t,
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
        `  ${c.d} ${c.t}  ${c.method.padEnd(14)} $${(Number(c.cents) / 100).toFixed(2)}` +
          (c.hasUser ? "" : "  (no member attached)"),
      );
    }
  }

  console.log("\nSquare orders with no member attached (these need assigning by hand):");
  const orphans = await q<{ d: string; cents: number; passType: string }[]>(
    `SELECT DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS d, amountCents AS cents, passType
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
