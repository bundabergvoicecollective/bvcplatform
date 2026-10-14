/**
 * Records a payment that reached the bank but never reached this database,
 * and credits the sessions it bought.
 *
 * Square payments taken before the webhook existed, or through a link made in
 * the Square dashboard, arrive as money and never as sessions. Deb Dreaver's
 * $75 five-pass from the 13 October rehearsal is one: Square holds the
 * payment, we hold no order, and her pass reads 0 of 11.
 *
 * It is recorded with its real method — square, not cash. The income tile
 * sums Square from Square's own API and cash from this table, so filing a
 * card payment as cash counts the same money twice and overstates the night's
 * takings.
 *
 * ── it refuses to do it twice ──
 *
 * Before writing anything it looks for a paid order of the same amount for
 * the same member in the surrounding days. Crediting a pass twice gives
 * somebody sessions the choir was never paid for, and nobody finds out until
 * the numbers are counted months later. --force overrides, for the case where
 * a member really did buy two of the same thing in one week.
 *
 * Reports by default. Writes only with --apply.
 *
 * ── it has to exit on purpose ──
 *
 * This is the first script here to import db.ts, and db.ts opens a connection
 * POOL at module load. A pool keeps idle sockets open, so the process does not
 * end when main() resolves — the first apply run sat in Actions for twenty
 * minutes after finishing its work, looking exactly like a hang. Every path
 * out of main() therefore exits explicitly.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/recordPayment.ts \
 *     --email=someone@example.com --pass=5-pass --method=square [--apply]
 */
import mysql from "mysql2/promise";
import { logActivity, recordCashPayment } from "../db";
import { PASS_PRODUCTS } from "../products";

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const SHOW = args.includes("--show-emails");

const EMAIL = (arg("email") ?? "").toLowerCase().trim();
const PASS = arg("pass") ?? "";
const METHOD = (arg("method") ?? "square") as "square" | "cash" | "complimentary";
const NOTE = arg("note");
/** How far either side to look for the same payment already recorded. */
const WINDOW_DAYS = Number(arg("window") ?? 10);

const shown = (e: string) => (SHOW ? e : e.replace(/^(.{2})[^@]*(@.*)$/, "$1…$2"));
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!EMAIL) throw new Error("Pass --email=<address>.");
  if (!(PASS in PASS_PRODUCTS)) {
    throw new Error(`--pass must be one of: ${Object.keys(PASS_PRODUCTS).join(", ")}`);
  }
  if (!["square", "cash", "complimentary"].includes(METHOD)) {
    throw new Error(`--method must be square, cash or complimentary (got "${METHOD}")`);
  }

  const product = PASS_PRODUCTS[PASS as keyof typeof PASS_PRODUCTS];
  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  const [member] = await q<{ id: number; name: string | null; email: string }[]>(
    "SELECT id, name, email FROM users WHERE lower(trim(email)) = ?",
    [EMAIL],
  );
  if (!member) throw new Error(`No member with the address ${shown(EMAIL)}.`);

  const [admin] = await q<{ id: number }[]>("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  if (!admin) throw new Error("No admin user to record this against.");

  console.log(APPLY ? "APPLYING.\n" : "Dry run. Nothing will be written.\n");
  console.log(`Member   ${shown(member.email)}`);
  console.log(`Pass     ${PASS} — ${product.sessionCount} session(s), ${money(product.amountCents)}`);
  console.log(`Method   ${METHOD}\n`);

  const before = await q<{ remaining: number; total: number; active: number }[]>(
    "SELECT remainingSessions AS remaining, totalSessions AS total, active FROM passes WHERE userId = ? AND active = 1 ORDER BY assignedAt DESC LIMIT 1",
    [member.id],
  );
  console.log(
    before.length
      ? `Balance now  ${before[0].remaining} of ${before[0].total}`
      : "Balance now  no active pass",
  );

  // Would this be the second time?
  const already = await q<{ d: string; cents: number; method: string; passType: string }[]>(
    `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i') AS d, amountCents AS cents,
            paymentMethod AS method, passType
       FROM pass_orders
      WHERE userId = ? AND status = 'paid' AND amountCents = ?
        AND createdAt >= DATE_SUB(now(), INTERVAL ? DAY)`,
    [member.id, product.amountCents, WINDOW_DAYS],
  );
  if (already.length) {
    console.log(`\nAlready recorded, within the last ${WINDOW_DAYS} days:`);
    for (const a of already) console.log(`  ${a.d} UTC  ${money(Number(a.cents))}  ${a.method}  ${a.passType}`);
    if (!FORCE) {
      console.log(
        "\nStopping. Recording this again would credit sessions the choir was\n" +
          "never paid for. Pass --force if they genuinely bought two.",
      );
      await conn.end();
      process.exit(1);
    }
    console.log("\n--force given — recording it anyway.");
  } else {
    console.log(`No matching order in the last ${WINDOW_DAYS} days.`);
  }

  if (!APPLY) {
    console.log(
      `\nWould add ${product.sessionCount} session(s) and record a paid ${METHOD} order for ${money(product.amountCents)}.`,
    );
    await conn.end();
    process.exit(0);
  }

  await conn.end();

  const balanceBefore = before.length ? before[0].remaining : 0;

  await recordCashPayment({
    userId: member.id,
    passType: PASS,
    sessionCount: product.sessionCount,
    amountCents: product.amountCents,
    adminId: admin.id,
    paymentMethod: METHOD,
    notes: NOTE ?? `Recorded by hand: ${METHOD} payment taken outside the platform.`,
  });

  // The tRPC procedure writes this; calling the database function straight
  // does not. Without it the Members page shows a balance that grew by five
  // with nothing saying why, which is the question somebody will ask.
  await logActivity({
    userId: member.id,
    actorId: admin.id,
    action: "pass_credited",
    detail:
      `${METHOD} payment of ${money(product.amountCents)} recorded by hand (${PASS}). ` +
      `Balance: ${balanceBefore} → ${balanceBefore + product.sessionCount}.`,
    balanceBefore,
    balanceAfter: balanceBefore + product.sessionCount,
  }).catch(() => {});

  const after = await mysql.createConnection(url).then(async (c) => {
    const rows = (await c.query(
      "SELECT remainingSessions AS remaining, totalSessions AS total FROM passes WHERE userId = ? AND active = 1 ORDER BY assignedAt DESC LIMIT 1",
      [member.id],
    ))[0] as { remaining: number; total: number }[];
    await c.end();
    return rows[0];
  });
  console.log(`\nDone. Balance now ${after ? `${after.remaining} of ${after.total}` : "(no active pass — something is wrong)"}.`);

  // db.ts's pool holds the process open. The work is finished; say so and go.
  process.exit(0);
}

main().catch((err) => {
  console.error("\nRecord payment FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
