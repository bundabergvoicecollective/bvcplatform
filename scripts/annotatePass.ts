/**
 * Write down why a pass exists.
 *
 * A pass carries a `notes` field that the member's Pass History shows, and
 * passes created before the activity log existed — or granted outside the
 * app — arrive with it empty. The result is a balance nobody can account
 * for: four sessions against a member with no order behind them, which looks
 * identical to money that went missing until somebody who was there confirms
 * it was a gift.
 *
 * That confirmation is worth keeping. Every audit that walks the passes will
 * otherwise raise the same question again, and the person who can answer it
 * will not always be around.
 *
 * Appends rather than replaces: whatever reason the pass already carries is
 * part of its history too.
 *
 * Report-only unless --apply.
 *
 * --note takes everything up to the next flag, because the audit workflow
 * passes its arguments unquoted and the shell splits a sentence into words.
 *
 * Usage: DATABASE_URL=… tsx scripts/annotatePass.ts --user=750005 \
 *          --note=Complimentary, confirmed 3 Nov 2026. --apply
 */
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

const USER = arg("user");
const PASS_ID = arg("pass");

/**
 * The note, reassembled.
 *
 * The audit workflow passes its arguments unquoted, so the shell splits a
 * note into one argv entry per word. Everything from --note= to the next
 * flag belongs to the note; joining it back is the difference between
 * "Complimentary" and "Complimentary — confirmed by Andy, 3 Nov 2026."
 */
function readNote(): string | undefined {
  const argv = process.argv.slice(2);
  const start = argv.findIndex((a) => a.startsWith("--note="));
  if (start === -1) return undefined;
  const parts = [argv[start].slice("--note=".length)];
  for (const a of argv.slice(start + 1)) {
    if (a.startsWith("--")) break;
    parts.push(a);
  }
  return parts.join(" ").trim() || undefined;
}
const NOTE = readNote();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!USER && !PASS_ID) throw new Error("Pass --user=<id> or --pass=<pass id>.");
  if (!NOTE) throw new Error('Pass --note="..." — the whole point is the reason.');

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  const passes = PASS_ID
    ? await q<{ id: number; userId: number; total: number; remaining: number; d: string; notes: string | null }[]>(
        `SELECT id, userId, totalSessions AS total, remainingSessions AS remaining,
                DATE_FORMAT(DATE_ADD(assignedAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS d, notes
           FROM passes WHERE id = ?`,
        [Number(PASS_ID)],
      )
    : await q<{ id: number; userId: number; total: number; remaining: number; d: string; notes: string | null }[]>(
        `SELECT id, userId, totalSessions AS total, remainingSessions AS remaining,
                DATE_FORMAT(DATE_ADD(assignedAt, INTERVAL 10 HOUR), '%Y-%m-%d') AS d, notes
           FROM passes WHERE userId = ? AND active = 1 ORDER BY assignedAt DESC`,
        [Number(USER)],
      );

  if (!passes.length) throw new Error("No matching pass.");
  if (passes.length > 1) throw new Error(`${passes.length} active passes — name one with --pass=<id>.`);
  const pass = passes[0];

  console.log(`Pass #${pass.id} for member #${pass.userId}`);
  console.log(`  assigned ${pass.d}, ${pass.remaining}/${pass.total} remaining`);
  console.log(`  note now:  ${pass.notes ? `"${pass.notes}"` : "(empty)"}`);
  console.log(`  note after: "${(pass.notes ? `${pass.notes} ` : "") + NOTE}"`);

  if (!APPLY) {
    console.log("\nReport only — nothing written. Re-run with --apply.");
    await conn.end();
    process.exit(0);
  }

  await conn.query(
    "UPDATE passes SET notes = TRIM(CONCAT(COALESCE(notes, ''), ' ', ?)) WHERE id = ?",
    [NOTE, pass.id],
  );
  // The same sentence in the member's activity trail, because that is where
  // anyone looking at the member — rather than at the pass — will look.
  await conn.query(
    `INSERT INTO user_activity_log (userId, actorId, action, detail) VALUES (?, NULL, 'comp_granted', ?)`,
    [pass.userId, `Pass #${pass.id} annotated: ${NOTE}`],
  );
  console.log("\nWritten. It will show in the member's Pass History and activity trail.");

  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
