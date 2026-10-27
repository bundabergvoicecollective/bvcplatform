/**
 * Record money taken at the door for sessions that were never charged for.
 *
 * A member with no pass is marked attended as a "single" session. That
 * deducts nothing and creates no order, so until 27 October 2026 the
 * attendance row was the only trace the money existed. The Attendance page
 * now prompts for it on the night; this is for the nights already missed.
 *
 * It finds every attended single session for a member that has no payment
 * recorded against that rehearsal, and records one. Sessions that already
 * have a payment are skipped and named, so running it twice cannot charge
 * anyone twice.
 *
 * It grants no sessions. The rehearsal was attended when it was attended —
 * adding a session to the balance as well is how a member ends up holding
 * more than they have paid for.
 *
 * Report-only unless --apply. Names are cut to initials: the log is public.
 *
 * --name takes one word and matches anywhere in the member's name, because
 * the workflow word-splits its arguments and a quoted full name would arrive
 * in pieces. Two matches is an error rather than a guess: use --email then.
 *
 * Usage: DATABASE_URL=… tsx scripts/doorPayments.ts --name=Carolyn \
 *          [--amount=1600] [--channel=cash] [--apply]
 */
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

const NAME = arg("name");
const EMAIL = arg("email");
const AMOUNT = Number(arg("amount") ?? 1600);
const CHANNEL = (arg("channel") ?? "cash") as "cash" | "eft" | "card" | "other";

const initials = (s: string | null) =>
  (s ?? "").trim().split(/\s+/).filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join("") || "?";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!NAME && !EMAIL) throw new Error("Pass --name=Firstname or --email=someone@example.com");
  if (!Number.isInteger(AMOUNT) || AMOUNT < 1) throw new Error("--amount must be whole cents, e.g. 1600");
  if (!["cash", "eft", "card", "other"].includes(CHANNEL)) throw new Error("--channel must be cash, eft, card or other");

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  const members = EMAIL
    ? await q<{ id: number; name: string | null }[]>(
        "SELECT id, CONCAT_WS(' ', firstName, lastName) AS name FROM users WHERE lower(trim(email)) = ?",
        [EMAIL.toLowerCase().trim()],
      )
    : await q<{ id: number; name: string | null }[]>(
        `SELECT id, CONCAT_WS(' ', firstName, lastName) AS name FROM users
          WHERE lower(CONCAT_WS(' ', firstName, lastName)) LIKE lower(?)
             OR lower(name) LIKE lower(?)`,
        [`%${NAME}%`, `%${NAME}%`],
      );

  if (!members.length) throw new Error(`No member matched. Check the spelling.`);
  if (members.length > 1) {
    throw new Error(
      `${members.length} members match "${NAME}" (${members.map((m) => initials(m.name)).join(", ")}) — use --email= instead.`,
    );
  }
  const member = members[0];
  console.log(`Member ${initials(member.name)} (#${member.id})\n`);

  // Every single session, and what has already been taken for that rehearsal.
  const rows = await q<{ sessionId: number; title: string; d: string; paidCents: number }[]>(
    `SELECT a.sessionId,
            s.title,
            DATE_FORMAT(DATE_ADD(s.sessionDate, INTERVAL 10 HOUR), '%Y-%m-%d') AS d,
            (SELECT COALESCE(SUM(o.amountCents), 0) FROM pass_orders o
              WHERE o.userId = a.userId AND o.sessionId = a.sessionId AND o.status = 'paid') AS paidCents
       FROM attendance a
       JOIN sessions s ON s.id = a.sessionId
      WHERE a.userId = ? AND a.attended = 1 AND a.sessionType = 'single'
      ORDER BY s.sessionDate`,
    [member.id],
  );

  if (!rows.length) {
    console.log("No attended single sessions on record for them. Nothing to do.");
    await conn.end();
    process.exit(0);
  }

  const owing = rows.filter((r) => Number(r.paidCents) === 0);
  const already = rows.filter((r) => Number(r.paidCents) > 0);

  for (const r of already) {
    console.log(`  skip  ${r.d}  ${r.title} — $${(Number(r.paidCents) / 100).toFixed(2)} already recorded`);
  }
  for (const r of owing) {
    console.log(`  ${APPLY ? "RECORD" : "would"}  ${r.d}  ${r.title} — $${(AMOUNT / 100).toFixed(2)} ${CHANNEL}`);
  }

  if (!owing.length) {
    console.log("\nEvery single session already has a payment against it. Nothing to do.");
    await conn.end();
    process.exit(0);
  }

  if (!APPLY) {
    console.log(`\n${owing.length} session(s) would be recorded, $${((owing.length * AMOUNT) / 100).toFixed(2)} in total.`);
    console.log("Re-run with --apply to write them.");
    await conn.end();
    process.exit(0);
  }

  // Card settles through Square and is counted from Square's own API, so it
  // goes on that rail to stay out of the cash total. Everything else is only
  // in this table.
  const rail = CHANNEL === "card" ? "square" : "cash";

  for (const r of owing) {
    await conn.query(
      `INSERT INTO pass_orders
         (userId, stripeSessionId, passType, sessionCount, amountCents, currency,
          paymentMethod, paymentChannel, sessionId, notes, status, createdAt)
       VALUES (?, NULL, 'single', 0, ?, 'aud', ?, ?, ?, ?, 'paid',
               (SELECT sessionDate FROM sessions WHERE id = ?))`,
      [member.id, AMOUNT, rail, CHANNEL, r.sessionId,
       `Paid at the door on the night; recorded later.`, r.sessionId],
    );
    await conn.query(
      `INSERT INTO user_activity_log (userId, actorId, action, detail)
       VALUES (?, NULL, 'cash_payment', ?)`,
      [member.id,
       `Paid at the door for ${r.title}: $${(AMOUNT / 100).toFixed(2)} (${CHANNEL}). Recorded later. No session granted — it was used on the night.`],
    );
    console.log(`  ok    ${r.d}  recorded`);
  }

  // Say what is there now rather than what was asked for.
  const [after] = await q<{ n: number; cents: number }[]>(
    `SELECT count(*) AS n, COALESCE(SUM(amountCents), 0) AS cents
       FROM pass_orders WHERE userId = ? AND passType = 'single' AND status = 'paid'`,
    [member.id],
  );
  console.log(`\n${owing.length} recorded. ${initials(member.name)} now has ${after.n} single-session payment(s) totalling $${(Number(after.cents) / 100).toFixed(2)}.`);

  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
