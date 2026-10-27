/**
 * Is anyone short of sessions they paid for?
 *
 * The count of pass rows here (121) came out one below the count in Manus
 * (122) during the migration. Manus has since been retired, so that row can
 * no longer be looked up — and chasing it was never the point. The question
 * worth answering is whether the shortfall cost a member anything, and that
 * is answerable entirely from our own data.
 *
 * For each member: what they were given (the sessionCount on every pass row)
 * against what they have used (attendance marked with passUsed) and what they
 * have left (remainingSessions on the active pass). Those three have to
 * reconcile. Separately, every paid order should have produced a pass.
 *
 * Read-only. Member ids and initials only — no names, no addresses, because
 * this runs in Actions and the repository is public.
 *
 * Usage: DATABASE_URL=… tsx scripts/passReconcile.ts
 */
import mysql from "mysql2/promise";

/** "Deborah Dreaver" → "D.D." — enough to find the person, not to identify them. */
function initials(first: string | null, last: string | null, name: string | null): string {
  const parts = [first, last].filter(Boolean) as string[];
  const source = parts.length ? parts : (name ?? "").split(/\s+/).filter(Boolean);
  return source.map((p) => `${p[0].toUpperCase()}.`).join("") || "?";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  // ── The shape of what we hold ───────────────────────────────────────────
  const [totals] = await q<{ passes: number; granted: number; remaining: number; holders: number }[]>(
    `SELECT count(*) AS passes,
            COALESCE(sum(totalSessions), 0) AS granted,
            COALESCE(sum(remainingSessions), 0) AS remaining,
            count(DISTINCT userId) AS holders
       FROM passes`,
  );
  const [active] = await q<{ n: number; remaining: number }[]>(
    "SELECT count(*) AS n, COALESCE(sum(remainingSessions),0) AS remaining FROM passes WHERE active = 1",
  );
  console.log(`${totals.passes} pass rows across ${totals.holders} members.`);
  console.log(`  ${totals.granted} sessions granted in total, ${totals.remaining} still on the books.`);
  console.log(`  ${active.n} of those rows are active, holding ${active.remaining} sessions.\n`);

  // ── Does each member's arithmetic add up? ───────────────────────────────
  // granted − used should equal what is left. A member who comes out negative
  // has been charged for sessions nobody gave them.
  const perMember = await q<{
    userId: number; firstName: string | null; lastName: string | null; name: string | null;
    granted: number; remaining: number; used: number;
  }[]>(
    `SELECT u.id AS userId, u.firstName, u.lastName, u.name,
            COALESCE(p.granted, 0) AS granted,
            COALESCE(p.remaining, 0) AS remaining,
            COALESCE(a.used, 0) AS used
       FROM users u
       LEFT JOIN (SELECT userId, sum(totalSessions) AS granted, sum(remainingSessions) AS remaining
                    FROM passes GROUP BY userId) p ON p.userId = u.id
       LEFT JOIN (SELECT userId, count(*) AS used
                    FROM attendance WHERE attended = 1 AND passUsed = 1 GROUP BY userId) a ON a.userId = u.id
      WHERE u.status = 'active'`,
  );

  const off = perMember
    .map((m) => ({ ...m, drift: Number(m.granted) - Number(m.used) - Number(m.remaining) }))
    .filter((m) => m.drift !== 0);

  if (!off.length) {
    console.log("Every member's granted minus used equals what they have left. Nothing is missing.\n");
  } else {
    // Positive drift: sessions granted that are neither used nor on the books
    // — the member is SHORT. Negative: they have more than they were granted.
    const short = off.filter((m) => m.drift > 0);
    const over = off.filter((m) => m.drift < 0);
    console.log(`${off.length} member(s) whose pass arithmetic does not close:\n`);
    for (const m of off.sort((a, b) => b.drift - a.drift)) {
      const who = `#${m.userId} ${initials(m.firstName, m.lastName, m.name)}`.padEnd(14);
      console.log(
        `  ${who} granted ${String(m.granted).padStart(3)}, used ${String(m.used).padStart(3)}, ` +
        `left ${String(m.remaining).padStart(3)}  →  ${m.drift > 0 ? `${m.drift} SHORT` : `${-m.drift} extra`}`,
      );
    }
    console.log(
      `\n  ${short.length} short, ${over.length} with more than they were granted.` +
      "\n  A pass carried over from the paper system shows as extra: the balance came" +
      "\n  across without the sessions behind it. Short is the one that costs someone.\n",
    );
  }

  // ── Did every payment produce a pass? ───────────────────────────────────
  const unfulfilled = await q<{
    id: number; userId: number; firstName: string | null; lastName: string | null; name: string | null;
    passType: string; amountCents: number; method: string; when: string;
  }[]>(
    `SELECT o.id, o.userId, u.firstName, u.lastName, u.name, o.passType, o.amountCents,
            o.paymentMethod AS method,
            DATE_FORMAT(DATE_ADD(o.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS \`when\`
       FROM pass_orders o
       LEFT JOIN users u ON u.id = o.userId
      WHERE o.status = 'paid'
        AND NOT EXISTS (SELECT 1 FROM passes p
                         WHERE p.userId = o.userId
                           AND p.assignedAt >= DATE_SUB(o.createdAt, INTERVAL 1 DAY))
      ORDER BY o.createdAt`,
  );
  if (!unfulfilled.length) {
    console.log("Every paid order has a pass issued alongside it.");
  } else {
    console.log(`${unfulfilled.length} paid order(s) with no pass issued within a day:\n`);
    for (const o of unfulfilled) {
      console.log(
        `  order #${o.id}  ${initials(o.firstName, o.lastName, o.name).padEnd(6)} ` +
        `${o.passType.padEnd(16)} $${(o.amountCents / 100).toFixed(2).padStart(7)} ` +
        `${o.method.padEnd(13)} ${o.when}`,
      );
    }
    console.log("\n  Each of these is money taken for sessions that were never granted.");
  }

  // ── And is anyone holding a pass nobody paid for? ───────────────────────
  const [orphan] = await q<{ n: number }[]>(
    `SELECT count(*) AS n FROM passes p
      WHERE NOT EXISTS (SELECT 1 FROM pass_orders o WHERE o.userId = p.userId AND o.status = 'paid')`,
  );
  console.log(
    `\n${orphan.n} pass row(s) belong to a member with no paid order. That is expected for` +
    "\ncomplimentary passes and for balances carried over from the paper system.",
  );

  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
