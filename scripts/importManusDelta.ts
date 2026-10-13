/**
 * Brings across what happened in Manus after the migration snapshot.
 *
 * The import on 29 September copied everything up to that date and stopped.
 * Manus kept being used: rehearsals were held, attendance was marked, passes
 * were bought and deducted. This database does not know about any of it, and
 * the damage is not cosmetic — a member whose pass was deducted in Manus still
 * shows the un-deducted balance here, so switching over without this would
 * hand out free sessions and under-report income.
 *
 * It reads a JSON export produced by `scripts/manusExport.js` (pasted into the
 * console of the Manus admin, which is the only place that data is reachable)
 * and applies the difference. Nothing is deleted, ever. Rows that already
 * exist are left alone, so running it twice is harmless.
 *
 * What it does NOT do: create member accounts. A user row written straight
 * into the table has no openId, no password set-up email and no invite — an
 * account nobody can log into. Missing members are reported so they can be
 * invited through the app, which is the only path that sends them a password.
 *
 * Matching is by email, lower(trim(...)) on both sides, the same way the app
 * looks members up — see the note in db.ts about addresses from Manus.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/importManusDelta.ts --file=manus-delta.json
 *   ... --apply       write the changes, in one transaction
 *   ... --actor=<email>   admin recorded as createdBy/assignedBy (default: lowest-id admin)
 *   ... --show-emails     print member addresses in full; local runs only, never CI
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const arg = (flag: string) =>
  process.argv.find((a) => a.startsWith(`--${flag}=`))?.slice(flag.length + 3);

const APPLY = process.argv.includes("--apply");
const FILE = arg("file");
const ACTOR_EMAIL = (arg("actor") ?? "").toLowerCase().trim();
const SHOW_EMAILS = process.argv.includes("--show-emails");

/** MySQL timestamp columns want 'YYYY-MM-DD HH:MM:SS' in UTC, not an ISO string. */
const toSql = (iso: string) => new Date(iso).toISOString().slice(0, 19).replace("T", " ");
const key = (email: string | null | undefined) => (email ?? "").toLowerCase().trim();

/**
 * This repository is public, and so are its Actions logs. Member addresses are
 * masked unless --show-emails is passed, which is for a local run only. The
 * other scripts here keep to counts and dates for the same reason.
 */
const shown = (email: string) =>
  SHOW_EMAILS ? email : email.replace(/^(.{2})[^@]*(@.*)$/, "$1\u2026$2");

type Delta = {
  source: string;
  exportedAt: string;
  cutoffs: Record<string, string>;
  sessions: { manusId: number; title: string; sessionDate: string; notes: string | null; createdAt: string }[];
  attendance: { sessionId: number; userEmail: string; userName: string; attended: boolean; passUsed: boolean; sessionType: string; markedAt: string }[];
  orders: { manusId: number; userEmail: string; paymentSessionId: string | null; passType: string; sessionCount: number; amountCents: number; currency: string; status: string; paymentMethod: string; notes: string | null; createdAt: string }[];
  members: { email: string; name: string | null; createdAt: string }[];
  activePasses: { userEmail: string; totalSessions: number; remainingSessions: number; assignedAt: string; active: boolean }[];
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!FILE) throw new Error("Pass --file=<export.json>. This script will not guess its input.");

  const delta: Delta = JSON.parse(readFileSync(FILE, "utf8"));
  if (!delta.source?.startsWith("manus:")) throw new Error(`${FILE} is not a Manus export.`);
  const ageHours = (Date.now() - new Date(delta.exportedAt).getTime()) / 3_600_000;
  console.log(`Export from ${delta.source}, taken ${delta.exportedAt} (${ageHours.toFixed(1)}h ago)`);
  if (ageHours > 24) console.log("  ! More than a day old. Re-export if anything has happened in Manus since.");

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await conn.query(sql, params))[0] as T;

  // ── who the writes are attributed to ────────────────────────────────────
  const admins = await q<{ id: number; email: string }[]>(
    "SELECT id, email FROM users WHERE role = 'admin' ORDER BY id",
  );
  if (!admins.length) throw new Error("No admin user to attribute these rows to.");
  const actor = ACTOR_EMAIL ? admins.find((a) => key(a.email) === ACTOR_EMAIL) : admins[0];
  if (!actor) throw new Error(`No admin with email ${ACTOR_EMAIL}. Known: ${admins.map((a) => a.email).join(", ")}`);
  console.log(`Attributing new rows to admin #${actor.id} (${actor.email})\n`);

  // ── email → user id ─────────────────────────────────────────────────────
  const users = await q<{ id: number; email: string | null }[]>("SELECT id, email FROM users");
  const byEmail = new Map<string, number>();
  for (const u of users) if (u.email) byEmail.set(key(u.email), u.id);

  const missing = new Set<string>();
  const resolve = (email: string) => {
    const id = byEmail.get(key(email));
    if (!id) missing.add(key(email));
    return id;
  };

  const plan: { table: string; sql: string; params: unknown[]; describe: string }[] = [];
  const skipped: string[] = [];

  // ── 1. sessions ─────────────────────────────────────────────────────────
  const haveSessions = await q<{ id: number; title: string; sessionDate: Date }[]>(
    "SELECT id, title, sessionDate FROM sessions",
  );
  const sessionIdFor = new Map<number, number>(); // manus id → local id
  for (const s of delta.sessions) {
    const when = toSql(s.sessionDate);
    const hit = haveSessions.find(
      (h) => h.title.trim() === s.title.trim() && toSql(h.sessionDate.toISOString()) === when,
    );
    if (hit) {
      sessionIdFor.set(s.manusId, hit.id);
      skipped.push(`session "${s.title}" already here as #${hit.id}`);
      continue;
    }
    plan.push({
      table: "sessions",
      sql: "INSERT INTO sessions (title, sessionDate, notes, createdBy, createdAt) VALUES (?, ?, ?, ?, ?)",
      params: [s.title, when, s.notes, actor.id, toSql(s.createdAt)],
      describe: `session "${s.title}" (${s.sessionDate.slice(0, 10)})`,
    });
  }

  // ── 2. attendance ───────────────────────────────────────────────────────
  // Sessions being inserted have no id yet, so attendance for them is planned
  // against the manus id and rewritten once the insert returns one.
  const haveAttendance = await q<{ sessionId: number; userId: number }[]>(
    "SELECT sessionId, userId FROM attendance",
  );
  const attendancePlan: { manusSessionId: number; userId: number; row: Delta["attendance"][0] }[] = [];
  for (const a of delta.attendance) {
    const userId = resolve(a.userEmail);
    if (!userId) continue;
    const localSession = sessionIdFor.get(a.sessionId);
    if (localSession && haveAttendance.some((h) => h.sessionId === localSession && h.userId === userId)) {
      skipped.push(`attendance for user #${userId} in session #${localSession}`);
      continue;
    }
    attendancePlan.push({ manusSessionId: a.sessionId, userId, row: a });
  }

  // ── 3. pass orders ──────────────────────────────────────────────────────
  const haveOrders = await q<{ userId: number; amountCents: number; createdAt: Date; paymentSessionId: string | null }[]>(
    "SELECT userId, amountCents, createdAt, paymentSessionId FROM pass_orders",
  );
  for (const o of delta.orders) {
    const userId = resolve(o.userEmail);
    if (!userId) continue;
    const dup = haveOrders.find((h) =>
      o.paymentSessionId && h.paymentSessionId
        ? h.paymentSessionId === o.paymentSessionId
        : h.userId === userId && h.amountCents === o.amountCents && toSql(h.createdAt.toISOString()) === toSql(o.createdAt),
    );
    if (dup) {
      skipped.push(`order ${o.passType} $${(o.amountCents / 100).toFixed(2)} for user #${userId}`);
      continue;
    }
    plan.push({
      table: "pass_orders",
      sql: `INSERT INTO pass_orders
              (userId, paymentSessionId, passType, sessionCount, amountCents, currency, status, paymentMethod, notes, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [userId, o.paymentSessionId, o.passType, o.sessionCount, o.amountCents,
        (o.currency ?? "aud").toLowerCase(), o.status, o.paymentMethod ?? "square",
        [o.notes, `imported from Manus order ${o.manusId}`].filter(Boolean).join(" · "), toSql(o.createdAt)],
      describe: `order ${o.passType} $${(o.amountCents / 100).toFixed(2)} ${o.status} (user #${userId})`,
    });
  }

  // ── 4. pass balances — the part that actually matters ───────────────────
  // Manus is authoritative: its remainingSessions already reflects every
  // deduction it made. Rather than replaying deductions here (and risking
  // double-counting the ones already imported), each active pass is set to
  // the figure Manus holds.
  const havePasses = await q<{ id: number; userId: number; totalSessions: number; remainingSessions: number; active: number }[]>(
    "SELECT id, userId, totalSessions, remainingSessions, active FROM passes WHERE active = 1",
  );
  const balanceChanges: string[] = [];
  for (const p of delta.activePasses) {
    const userId = resolve(p.userEmail);
    if (!userId) continue;
    const mine = havePasses.filter((h) => h.userId === userId);
    if (mine.length > 1) {
      skipped.push(`user #${userId} has ${mine.length} active passes — left alone, needs a human`);
      continue;
    }
    const existing = mine[0];
    if (!existing) {
      plan.push({
        table: "passes",
        sql: "INSERT INTO passes (userId, totalSessions, remainingSessions, assignedBy, assignedAt, active, notes) VALUES (?, ?, ?, ?, ?, 1, ?)",
        params: [userId, p.totalSessions, p.remainingSessions, actor.id, toSql(p.assignedAt), "imported from Manus"],
        describe: `pass for user #${userId}: ${p.remainingSessions}/${p.totalSessions} (new)`,
      });
      continue;
    }
    if (existing.remainingSessions === p.remainingSessions && existing.totalSessions === p.totalSessions) continue;
    balanceChanges.push(
      `user #${userId}: ${existing.remainingSessions}/${existing.totalSessions} → ${p.remainingSessions}/${p.totalSessions}`,
    );
    plan.push({
      table: "passes",
      sql: "UPDATE passes SET totalSessions = ?, remainingSessions = ? WHERE id = ?",
      params: [p.totalSessions, p.remainingSessions, existing.id],
      describe: `pass #${existing.id} (user #${userId}): ${existing.remainingSessions}/${existing.totalSessions} → ${p.remainingSessions}/${p.totalSessions}`,
    });
  }

  // The other direction, which the verification at the end does not cover: a
  // pass active here that the export does not list at all. Nothing in the
  // export speaks to these, so they are left alone — but an active pass Manus
  // has stopped treating as active is the shape a missed deduction takes, so
  // it is named rather than silently passed over.
  const exportedEmails = new Set(delta.activePasses.map((p) => key(p.userEmail)));
  const emailById = new Map(users.filter((u) => u.email).map((u) => [u.id, key(u.email)]));
  const unlisted = havePasses.filter((h) => {
    const email = emailById.get(h.userId);
    return !email || !exportedEmails.has(email);
  });

  // ── report ──────────────────────────────────────────────────────────────
  const counts = plan.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.table]: (acc[p.table] ?? 0) + 1 }), {});
  counts.attendance = attendancePlan.length;

  console.log("To apply:");
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(12)} ${n}`);
  console.log("");
  for (const p of plan) console.log(`  + ${p.describe}`);
  for (const a of attendancePlan) console.log(`  + attendance: user #${a.userId}, ${a.row.sessionType}${a.row.passUsed ? " (pass used)" : ""}`);

  if (balanceChanges.length) {
    console.log(`\n${balanceChanges.length} pass balances corrected:`);
    for (const c of balanceChanges) console.log(`  ${c}`);
  }
  if (unlisted.length) {
    const outstanding = unlisted.reduce((n, h) => n + h.remainingSessions, 0);
    console.log(
      `\n${unlisted.length} pass(es) active here that the export does not list, ` +
        `${outstanding} session(s) between them:`,
    );
    for (const h of unlisted) {
      const email = emailById.get(h.userId);
      console.log(
        `  ${email ? shown(email) : `user #${h.userId}`}  ` +
          `${h.remainingSessions}/${h.totalSessions} — left alone, nothing in the export covers it`,
      );
    }
  }
  if (missing.size) {
    console.log(`\n${missing.size} member(s) in the export with no account here:`);
    for (const m of missing) console.log(`  ${shown(m)}  — invite through the app; their rows above were skipped`);
  }
  if (skipped.length) console.log(`\n${skipped.length} already present, left alone.`);

  if (!APPLY) {
    console.log("\nReport only. Re-run with --apply to write it.");
    await conn.end();
    return;
  }

  // ── apply ───────────────────────────────────────────────────────────────
  await conn.beginTransaction();
  try {
    for (const p of plan) {
      const [res] = (await conn.query(p.sql, p.params)) as unknown as [{ insertId: number }];
      if (p.table === "sessions") {
        const source = delta.sessions.find((s) => p.describe.includes(`"${s.title}"`));
        if (source) sessionIdFor.set(source.manusId, res.insertId);
      }
    }
    let written = 0;
    for (const a of attendancePlan) {
      const sessionId = sessionIdFor.get(a.manusSessionId);
      if (!sessionId) {
        skipped.push(`attendance for user #${a.userId}: its session was not created`);
        continue;
      }
      await conn.query(
        "INSERT INTO attendance (sessionId, userId, attended, passUsed, sessionType, markedAt) VALUES (?, ?, ?, ?, ?, ?)",
        [sessionId, a.userId, a.row.attended ? 1 : 0, a.row.passUsed ? 1 : 0, a.row.sessionType, toSql(a.row.markedAt)],
      );
      written++;
    }
    await conn.commit();
    console.log(`\nApplied. ${plan.length} row(s) inserted or updated, ${written} attendance mark(s) written.`);
  } catch (err) {
    await conn.rollback();
    console.error("\nRolled back — nothing was written.");
    throw err;
  }

  // ── verify ──────────────────────────────────────────────────────────────
  const after = await q<{ email: string; remainingSessions: number }[]>(
    `SELECT u.email AS email, p.remainingSessions AS remainingSessions
       FROM passes p JOIN users u ON u.id = p.userId WHERE p.active = 1`,
  );
  const wrong = delta.activePasses.filter((p) => {
    const row = after.find((a) => key(a.email) === key(p.userEmail));
    return row && row.remainingSessions !== p.remainingSessions;
  });
  console.log(wrong.length
    ? `\n! ${wrong.length} balance(s) still disagree with Manus — look before switching over.`
    : "\nEvery active pass balance now matches Manus.");

  await conn.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
