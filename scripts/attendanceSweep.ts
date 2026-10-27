/**
 * Who might be missing from a roll that was never fully marked?
 *
 * Until 27 October 2026 the attendance checkbox was disabled for the whole
 * list while any single write was in flight, so taps during a roll landed on
 * dead controls and did nothing. One member turned out to have no attendance
 * row for any rehearsal in four months despite attending four of them.
 *
 * WHAT THIS CANNOT DO. Nothing in the data distinguishes a swallowed tap from
 * somebody who genuinely stayed home. "No row" is not evidence of anything on
 * its own — most members miss most nights. So this does not accuse: it shows
 * the three shapes that are worth a human look, and says which is which.
 *
 *   1. Rehearsals marked far more lightly than their neighbours. A roll that
 *      was half taken is the clearest sign taps went missing, and it points
 *      at a night rather than a person.
 *   2. Active members with no attendance row ever. The shape the one known
 *      case had.
 *   3. Members holding unused sessions who have not been marked present
 *      lately. They paid to come; worth asking whether they did.
 *
 * Read-only, and writes nothing anywhere. Member ids and initials only — the
 * repository is public.
 *
 * Usage: DATABASE_URL=… tsx scripts/attendanceSweep.ts [--recent=6]
 */
import mysql from "mysql2/promise";

const RECENT = Number(process.argv.find((a) => a.startsWith("--recent="))?.slice(9) ?? 6);

const initials = (first: string | null, last: string | null, name: string | null) => {
  const parts = [first, last].filter(Boolean) as string[];
  const src = parts.length ? parts : (name ?? "").split(/\s+/).filter(Boolean);
  return src.map((p) => `${p[0].toUpperCase()}.`).join("") || "?";
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!Number.isInteger(RECENT) || RECENT < 1 || RECENT > 52) throw new Error("--recent must be 1–52");

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  const [members] = await q<{ n: number }[]>("SELECT count(*) AS n FROM users WHERE status = 'active'");
  console.log(`${members.n} active members.\n`);

  // ── 1. Which nights look under-marked? ──────────────────────────────────
  console.log(`Attendance per rehearsal, most recent ${RECENT}`);
  const perSession = await q<{ id: number; d: string; title: string; present: number }[]>(
    `SELECT s.id, DATE_FORMAT(DATE_ADD(s.sessionDate, INTERVAL 10 HOUR), '%Y-%m-%d') AS d, s.title,
            (SELECT count(*) FROM attendance a WHERE a.sessionId = s.id AND a.attended = 1) AS present
       FROM sessions s
      WHERE s.sessionDate <= DATE_ADD(now(), INTERVAL 1 DAY)
      ORDER BY s.sessionDate DESC LIMIT ?`,
    [RECENT],
  );

  const counts = perSession.map((r) => Number(r.present)).filter((n) => n > 0).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;

  for (const r of perSession) {
    const n = Number(r.present);
    // Half the usual turnout is the line. Below it, either the choir had a
    // very thin night or the roll was not finished.
    const thin = median > 0 && n < median / 2;
    const bar = "█".repeat(Math.round((n / Math.max(median, 1)) * 20));
    console.log(`  ${r.d}  ${String(n).padStart(3)} present ${bar}${thin ? "   ← far below the usual turnout" : ""}`);
  }
  console.log(`  (the usual night is ${median})\n`);

  // ── 2. Active members with no attendance ever ───────────────────────────
  const never = await q<{
    id: number; firstName: string | null; lastName: string | null; name: string | null;
    joined: string; lastSeen: string; hasPassword: number; remaining: number;
  }[]>(
    `SELECT u.id, u.firstName, u.lastName, u.name,
            DATE_FORMAT(DATE_ADD(u.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS joined,
            DATE_FORMAT(DATE_ADD(u.lastSignedIn, INTERVAL 10 HOUR), '%Y-%m-%d') AS lastSeen,
            (u.passwordHash IS NOT NULL AND u.passwordHash <> '') AS hasPassword,
            COALESCE((SELECT SUM(p.remainingSessions) FROM passes p WHERE p.userId = u.id AND p.active = 1), 0) AS remaining
       FROM users u
      WHERE u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.userId = u.id AND a.attended = 1)
      ORDER BY u.createdAt`,
  );
  console.log(`Active members never marked present at anything: ${never.length}`);
  for (const m of never) {
    console.log(
      `  #${String(m.id).padEnd(8)} ${initials(m.firstName, m.lastName, m.name).padEnd(6)}` +
      ` joined ${m.joined}, last signed in ${m.lastSeen}, ${m.remaining} session(s) on their pass` +
      `${Number(m.hasPassword) ? "" : ", no password set"}`,
    );
  }
  console.log(
    never.length
      ? "\n  Some of these have never come. The ones to look at are those holding\n" +
        "  sessions, or signing in recently — they are here and not being ticked.\n"
      : "",
  );

  // ── 3. Paid up, but not marked present lately ───────────────────────────
  const ids = perSession.slice(0, 3).map((r) => r.id);
  if (ids.length) {
    const quiet = await q<{
      id: number; firstName: string | null; lastName: string | null; name: string | null;
      remaining: number; lastPresent: string | null;
    }[]>(
      `SELECT u.id, u.firstName, u.lastName, u.name,
              SUM(p.remainingSessions) AS remaining,
              (SELECT DATE_FORMAT(DATE_ADD(MAX(s.sessionDate), INTERVAL 10 HOUR), '%Y-%m-%d')
                 FROM attendance a JOIN sessions s ON s.id = a.sessionId
                WHERE a.userId = u.id AND a.attended = 1) AS lastPresent
         FROM users u JOIN passes p ON p.userId = u.id AND p.active = 1
        WHERE u.status = 'active'
        GROUP BY u.id, u.firstName, u.lastName, u.name
       HAVING remaining > 0
          AND NOT EXISTS (
                SELECT 1 FROM attendance a
                 WHERE a.userId = u.id AND a.attended = 1
                   AND a.sessionId IN (${ids.map(() => "?").join(",")}))
        ORDER BY remaining DESC`,
      ids,
    );
    console.log(`Holding unused sessions but not marked present at the last ${ids.length} rehearsals: ${quiet.length}`);
    for (const m of quiet.slice(0, 25)) {
      console.log(
        `  #${String(m.id).padEnd(8)} ${initials(m.firstName, m.lastName, m.name).padEnd(6)}` +
        ` ${String(m.remaining).padStart(3)} left, last seen at a rehearsal ${m.lastPresent ?? "never"}`,
      );
    }
    if (quiet.length > 25) console.log(`  …and ${quiet.length - 25} more`);
  }

  console.log(
    "\nNone of this is proof. A missing row means nobody ticked them, which is\n" +
    "what both a quiet night and a swallowed tap look like. Check the names\n" +
    "against the paper roll, then markattendance fixes the ones that are wrong.",
  );

  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
