/**
 * Mark a member present at rehearsals that were never recorded.
 *
 * For attendance that happened and was never ticked. Until 27 October 2026
 * the attendance checkbox was disabled for the whole list while any single
 * write was in flight, so taps during a roll could land on a dead control and
 * do nothing — a member could be at a rehearsal and end the night with no row
 * at all, which is different from a row saying they were absent.
 *
 * --count=N takes the N most recent past rehearsals that have no row for this
 * member, which is the shape of the usual request: "they were at three, the
 * dates do not matter". --sessions=1,2,3 names them exactly when it does.
 *
 * It only ever writes rows that are missing. A rehearsal that already has one,
 * present or absent, is left alone and named, so this cannot overwrite a
 * considered answer with a guess.
 *
 * Deducts nothing. These are recorded as single sessions, which is what a
 * member with no pass is: the money is recorded separately by
 * scripts/doorPayments.ts, which will find these once they exist.
 *
 * Report-only unless --apply. Names cut to initials; the log is public.
 *
 * Usage: DATABASE_URL=… tsx scripts/markAttendance.ts --name=Carolyn --count=3 [--apply]
 */
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

const NAME = arg("name");
const EMAIL = arg("email");
const COUNT = arg("count") ? Number(arg("count")) : null;
const SESSIONS = arg("sessions")?.split(",").map((x) => Number(x.trim())).filter(Boolean) ?? [];
const TYPE = (arg("type") ?? "single") as "pass" | "single" | "complimentary" | "online";

const initials = (s: string | null) =>
  (s ?? "").trim().split(/\s+/).filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join("") || "?";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!NAME && !EMAIL) throw new Error("Pass --name=Firstname or --email=someone@example.com");
  if (!COUNT && !SESSIONS.length) throw new Error("Pass --count=N or --sessions=id,id");
  if (COUNT && (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 50)) throw new Error("--count must be 1–50");
  if (!["pass", "single", "complimentary", "online"].includes(TYPE)) throw new Error("--type is not valid");

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  const members = EMAIL
    ? await q<{ id: number; name: string | null }[]>(
        "SELECT id, CONCAT_WS(' ', firstName, lastName) AS name FROM users WHERE lower(trim(email)) = ?",
        [EMAIL.toLowerCase().trim()],
      )
    : await q<{ id: number; name: string | null }[]>(
        `SELECT id, CONCAT_WS(' ', firstName, lastName) AS name FROM users
          WHERE lower(CONCAT_WS(' ', firstName, lastName)) LIKE lower(?) OR lower(name) LIKE lower(?)`,
        [`%${NAME}%`, `%${NAME}%`],
      );
  if (!members.length) throw new Error("No member matched.");
  if (members.length > 1) {
    throw new Error(`${members.length} members match — use --email= instead.`);
  }
  const member = members[0];
  console.log(`Member ${initials(member.name)} (#${member.id})\n`);

  // Past rehearsals only, newest first, and only the ones with no row.
  const candidates = await q<{ id: number; title: string; d: string; hasRow: number }[]>(
    `SELECT s.id, s.title,
            DATE_FORMAT(DATE_ADD(s.sessionDate, INTERVAL 10 HOUR), '%Y-%m-%d') AS d,
            EXISTS(SELECT 1 FROM attendance a WHERE a.sessionId = s.id AND a.userId = ?) AS hasRow
       FROM sessions s
      WHERE s.sessionDate < (
              SELECT MAX(s2.sessionDate) FROM sessions s2
               WHERE DATE(DATE_ADD(s2.sessionDate, INTERVAL 10 HOUR))
                     <= DATE(DATE_ADD(now(), INTERVAL 10 HOUR)))
      ORDER BY s.sessionDate DESC`,
    [member.id],
  );

  const targets = SESSIONS.length
    ? candidates.filter((c) => SESSIONS.includes(c.id))
    : candidates.filter((c) => !Number(c.hasRow)).slice(0, COUNT ?? 0);

  const skipped = targets.filter((t) => Number(t.hasRow));
  const toWrite = targets.filter((t) => !Number(t.hasRow));

  for (const t of skipped) console.log(`  skip  ${t.d}  ${t.title} — already has a row`);
  for (const t of toWrite) console.log(`  ${APPLY ? "MARK " : "would"}  ${t.d}  ${t.title} — present (${TYPE})`);

  if (!toWrite.length) {
    console.log("\nNothing to write.");
    await conn.end();
    process.exit(0);
  }
  if (!APPLY) {
    console.log(`\n${toWrite.length} row(s) would be written. Re-run with --apply.`);
    await conn.end();
    process.exit(0);
  }

  for (const t of toWrite) {
    await conn.query(
      `INSERT INTO attendance (sessionId, userId, attended, passUsed, sessionType, markedAt)
       VALUES (?, ?, 1, 0, ?, (SELECT sessionDate FROM sessions WHERE id = ?))`,
      [t.id, member.id, TYPE, t.id],
    );
    await conn.query(
      `INSERT INTO user_activity_log (userId, actorId, action, detail)
       VALUES (?, NULL, 'attendance_marked', ?)`,
      [member.id, `Marked attended at ${t.title} (${TYPE}) — recorded later, not on the night. No pass deducted.`],
    );
    console.log(`  ok    ${t.d}  marked`);
  }

  const [total] = await q<{ n: number }[]>(
    "SELECT count(*) AS n FROM attendance WHERE userId = ? AND attended = 1",
    [member.id],
  );
  console.log(`\n${toWrite.length} written. ${initials(member.name)} now shows ${total.n} session(s) attended.`);

  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
