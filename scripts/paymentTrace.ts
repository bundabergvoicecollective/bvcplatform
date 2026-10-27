/**
 * Read-only: has a given payment already been credited, and to whom?
 *
 * Two payments from the 13 October rehearsal need recording by hand — a $75
 * five-pass and a $16 single. Before writing anything to a balance it has to
 * be settled whether they were already granted, because the dashboard tile
 * shows them as Square transactions with addresses against them while the
 * pass_orders table has nothing at all for that date. Both cannot be the
 * whole story, and granting a pass twice is worse than granting it late.
 *
 * Takes --email= (repeatable) or --amount= (cents, repeatable) and reports,
 * for each member it finds: their pass balance, their recent orders, and the
 * activity log entries that would show a pass being credited.
 *
 * Addresses masked and names cut to initials unless --show-emails, which is
 * for a local run. The Actions log is public.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/paymentTrace.ts --email=someone@example.com
 *   DATABASE_URL=... tsx scripts/paymentTrace.ts --amount=7500 --amount=1600
 */
import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const SHOW = args.includes("--show-emails");
const emails = args.filter((a) => a.startsWith("--email=")).map((a) => a.slice(8).toLowerCase().trim());
const amounts = args.filter((a) => a.startsWith("--amount=")).map((a) => Number(a.slice(9)));
const userIds = args.filter((a) => a.startsWith("--user=")).map((a) => Number(a.slice(7)));

const shown = (e: string | null) =>
  !e ? "(no address)" : SHOW ? e : e.replace(/^(.{2})[^@]*(@.*)$/, "$1…$2");
const initials = (n: string | null) =>
  SHOW ? (n ?? "?") : (n ?? "").trim().split(/\s+/).filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join("") || "?";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!emails.length && !amounts.length && !userIds.length) {
    throw new Error("Pass at least one --email=, --amount= or --user=.");
  }
  // An amount search finds the member but prints only the order line, which
  // never answers the question that follows it — was the pass granted? The
  // ids it finds are carried into the per-member detail below.
  const found = new Set<number>(userIds);

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  if (amounts.length) {
    console.log(`Any paid order matching ${amounts.map((a) => `$${(a / 100).toFixed(2)}`).join(" or ")}, ever:\n`);
    const rows = await q<
      { d: string; cents: number; method: string; passType: string; email: string | null; name: string | null; stripeSessionId: string | null; userId: number }[]
    >(
      `SELECT DATE_FORMAT(o.createdAt, '%Y-%m-%d %H:%i') AS d, o.amountCents AS cents,
              o.paymentMethod AS method, o.passType, o.stripeSessionId,
              o.userId, u.email, u.name
         FROM pass_orders o LEFT JOIN users u ON u.id = o.userId
        WHERE o.status = 'paid' AND o.amountCents IN (${amounts.map(() => "?").join(",")})
        ORDER BY o.createdAt DESC`,
      amounts,
    );
    if (!rows.length) console.log("  none at all.");
    for (const r of rows) {
      found.add(Number(r.userId));
      console.log(
        `  ${r.d} UTC  $${(Number(r.cents) / 100).toFixed(2).padStart(7)}  ${r.method.padEnd(13)} ${r.passType.padEnd(14)} ${initials(r.name).padEnd(6)} ${shown(r.email)}` +
          (r.stripeSessionId ? `  ref ${r.stripeSessionId.slice(0, 10)}…` : "  no payment ref"),
      );
    }
    console.log("");
  }

  const byEmail = await Promise.all(
    emails.map(async (email) => {
      const [m] = await q<{ id: number; name: string | null; email: string }[]>(
        "SELECT id, name, email FROM users WHERE lower(trim(email)) = ?",
        [email],
      );
      if (!m) console.log(`${shown(email)} — no member with that address.\n`);
      return m ?? null;
    }),
  );
  for (const m of byEmail) if (m) found.add(m.id);

  const members = found.size
    ? await q<{ id: number; name: string | null; email: string }[]>(
        `SELECT id, name, email FROM users WHERE id IN (${[...found].map(() => "?").join(",")})`,
        [...found],
      )
    : [];

  for (const member of members) {
    console.log(`${initials(member.name)}  ${shown(member.email)}`);

    const passes = await q<{ total: number; remaining: number; active: number; d: string }[]>(
      `SELECT totalSessions AS total, remainingSessions AS remaining, active,
              DATE_FORMAT(assignedAt, '%Y-%m-%d %H:%i') AS d
         FROM passes WHERE userId = ? ORDER BY assignedAt DESC LIMIT 5`,
      [member.id],
    );
    console.log("  passes:");
    if (!passes.length) console.log("    none");
    for (const p of passes) {
      console.log(`    ${p.d} UTC  ${p.remaining}/${p.total} remaining  ${p.active ? "active" : "spent"}`);
    }

    const orders = await q<{ d: string; cents: number; method: string; passType: string; status: string }[]>(
      `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i') AS d, amountCents AS cents,
              paymentMethod AS method, passType, status
         FROM pass_orders WHERE userId = ? ORDER BY createdAt DESC LIMIT 8`,
      [member.id],
    );
    console.log("  orders:");
    if (!orders.length) console.log("    none");
    for (const o of orders) {
      console.log(`    ${o.d} UTC  $${(Number(o.cents) / 100).toFixed(2).padStart(7)}  ${o.method.padEnd(13)} ${o.passType.padEnd(14)} ${o.status}`);
    }

    const log = await q<{ d: string; action: string; before: number | null; after: number | null }[]>(
      `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i') AS d, action,
              balanceBefore AS \`before\`, balanceAfter AS \`after\`
         FROM user_activity_log WHERE userId = ? ORDER BY createdAt DESC LIMIT 8`,
      [member.id],
    );
    console.log("  recent activity:");
    if (!log.length) console.log("    none");
    for (const l of log) {
      const move = l.before !== null && l.after !== null ? `  ${l.before} → ${l.after}` : "";
      console.log(`    ${l.d} UTC  ${l.action}${move}`);
    }
    console.log("");
  }

  await conn.end();
}

main().catch((err) => {
  console.error("\nPayment trace FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
