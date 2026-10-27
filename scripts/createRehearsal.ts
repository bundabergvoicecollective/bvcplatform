/**
 * Create a rehearsal session row, for when the admin page will not.
 *
 * The dialog builds its date with `new Date(value)` from a datetime-local
 * input, which hands back an empty string until every segment of the field
 * is valid — so the page can show a complete-looking date while the button
 * stays dead. This does the same write without the form in the way.
 *
 * --date is read as Brisbane time, which is what anyone typing it means, and
 * stored as UTC, which is what the column holds. It refuses to write a second
 * session on a Brisbane day that already has one: a duplicate would split
 * tonight's attendance across two rows.
 *
 * Report-only unless --apply.
 *
 * Usage: DATABASE_URL=… tsx scripts/createRehearsal.ts \
 *          --date=2026-10-27T18:30 [--title="October 27 Rehearsal"] [--apply]
 */
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const BRISBANE_OFFSET_HOURS = 10;
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set.");

  const raw = arg("date");
  if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) {
    throw new Error(`--date must be YYYY-MM-DDTHH:MM in Brisbane time, got ${raw ?? "nothing"}`);
  }
  const [datePart, timePart] = raw.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);

  // Brisbane has no daylight saving, so the offset is a constant.
  const utc = new Date(Date.UTC(y, m - 1, d, hh - BRISBANE_OFFSET_HOURS, mm));
  const title = arg("title") ?? `${MONTHS[m - 1]} ${d} Rehearsal`;

  const conn = await mysql.createConnection(dbUrl);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  const clash = await q<{ id: number; title: string }[]>(
    `SELECT id, title FROM sessions
      WHERE DATE(DATE_ADD(sessionDate, INTERVAL ? HOUR)) = ?`,
    [BRISBANE_OFFSET_HOURS, datePart],
  );
  if (clash.length) {
    console.log(`There is already a session on ${datePart}: #${clash[0].id} "${clash[0].title}". Nothing to do.`);
    await conn.end();
    process.exit(0);
  }

  // Whoever the row is attributed to has to be a real admin; the column is
  // used for "created by" in the audit trail and nothing else.
  const [admin] = await q<{ id: number }[]>(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1",
  );
  if (!admin) throw new Error("No active admin to attribute the session to.");

  console.log(`Session    "${title}"`);
  console.log(`Brisbane   ${datePart} ${timePart}`);
  console.log(`Stored UTC ${utc.toISOString()}`);

  if (!APPLY) {
    console.log("\nReport only — nothing written. Re-run with --apply to create it.");
    await conn.end();
    process.exit(0);
  }

  await conn.query(
    "INSERT INTO sessions (title, sessionDate, createdBy) VALUES (?, ?, ?)",
    [title, utc, admin.id],
  );
  const [made] = await q<{ id: number; t: string }[]>(
    `SELECT id, DATE_FORMAT(DATE_ADD(sessionDate, INTERVAL ? HOUR), '%W %e %M, %l:%i %p') AS t
       FROM sessions WHERE DATE(DATE_ADD(sessionDate, INTERVAL ? HOUR)) = ?`,
    [BRISBANE_OFFSET_HOURS, BRISBANE_OFFSET_HOURS, datePart],
  );
  console.log(`\nCreated session #${made.id} — ${made.t} Brisbane. Attendance can be marked against it now.`);

  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
