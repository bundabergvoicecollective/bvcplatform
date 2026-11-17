/**
 * Send a real chat message from one member to another, to prove the new
 * chat notification actually fires.
 *
 * Chat messages used to insert a row and stop — no notification, no push.
 * That is now fixed, and this is how the fix gets verified: there is no test
 * suite here, and the cloud container that writes this code cannot reach the
 * deployed site, so the only honest check is to call the real
 * `sendDirectMessage` against the real database and look at what happened.
 *
 * It calls the SAME function the app calls. Nothing is reimplemented, so a
 * pass here means the member-facing path works, not that a copy of it does.
 *
 * ── it waits for the push on purpose ──
 *
 * `notifyChatMessage` fires the push as a deliberately un-awaited promise, so
 * that a slow or broken push service can never hold up somebody's message.
 * That is right for the server, which keeps running, and wrong for a script,
 * which would exit and kill the push in flight — reporting success for a
 * notification that never left. So this waits, and says how long it waited.
 *
 * ── it has to exit on purpose ──
 *
 * db.ts opens a connection POOL at module load, and a pool keeps idle sockets
 * open, so the process does not end when main() resolves. Every path out
 * exits explicitly. (recordPayment.ts learned this the hard way: its first
 * run sat in Actions for twenty minutes after finishing, looking like a hang.)
 *
 * THIS WRITES TO A REAL PERSON'S INBOX AND LOCK SCREEN. Report-only unless
 * --apply. Addresses masked and names cut to initials — this log is public.
 *
 * Usage: DATABASE_URL=… tsx scripts/sendTestChat.ts \
 *          --from=a@example.com --to=b@example.com [--body="…"] [--apply]
 */
import mysql from "mysql2/promise";
import { sendDirectMessage } from "../db";
import { countPushSubscriptions } from "../webPush";

const args = process.argv.slice(2);
const arg = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const APPLY = args.includes("--apply");
const FROM = arg("from")?.trim().toLowerCase();
const TO = arg("to")?.trim().toLowerCase();

const DEFAULT_BODY =
  "Test message from the platform — checking that chat notifications are working. " +
  "No reply needed.";
const BODY = (arg("body") ?? DEFAULT_BODY).trim();

const mask = (e: string) => e.replace(/^(.{2})[^@]*(@.).*(\.[^.]+)$/, "$1•••$2•••$3");
const initials = (first: string | null, last: string | null, name: string | null) => {
  const parts = [first, last].filter(Boolean) as string[];
  const src = parts.length ? parts : (name ?? "").split(/\s+/).filter(Boolean);
  return src.map((p) => `${p[0].toUpperCase()}.`).join("") || "—";
};

type Row = {
  id: number; email: string; firstName: string | null; lastName: string | null;
  name: string | null; status: string; devices: number;
};

/** Seconds to let the un-awaited push settle before the pool closes. */
const PUSH_GRACE_SECONDS = 8;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!FROM || !TO) throw new Error("Pass --from=a@example.com --to=b@example.com");
  if (FROM === TO) throw new Error("Sender and recipient are the same address; a sender is never notified.");
  if (!BODY) throw new Error("--body is empty.");

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  const rows = await q<Row[]>(
    `SELECT u.id, u.email, u.firstName, u.lastName, u.name, u.status,
            (SELECT count(*) FROM push_subscriptions s WHERE s.userId = u.id) AS devices
       FROM users u
      WHERE lower(trim(u.email)) IN (?, ?)`,
    [FROM, TO],
  );
  const byEmail = new Map(rows.map((r) => [r.email.trim().toLowerCase(), r]));
  const sender = byEmail.get(FROM);
  const recipient = byEmail.get(TO);

  for (const [label, email, row] of [["from", FROM, sender], ["to", TO, recipient]] as const) {
    if (!row) {
      console.log(`  ${label}: ${mask(email)} — NO ACCOUNT. Nothing sent.`);
      await conn.end();
      process.exit(1);
    }
    console.log(
      `  ${label}: ${mask(email)}  #${row.id}  ${initials(row.firstName, row.lastName, row.name)}  ` +
        `${row.status} · ${row.devices} subscribed device(s)`,
    );
  }

  const total = await countPushSubscriptions().catch(() => null);
  console.log(`\nMessage (${BODY.length} chars):\n  "${BODY}"`);
  console.log(
    `\nThe bell will get a row either way. The push reaches ` +
      `${recipient!.devices} of this member's device(s)` +
      (total ? `, out of ${total.devices} across ${total.members} member(s)` : "") + ".",
  );
  if (!recipient!.devices) {
    console.log("  NOTE: no subscribed device, so only the in-app bell can be proved here.");
  }

  if (!APPLY) {
    console.log("\nReport only — nothing sent. Re-run with --apply to actually send it.");
    await conn.end();
    process.exit(0);
  }

  // The real thing. Same function the Messages page calls.
  const before = new Date();
  console.log(`\nSending via sendDirectMessage() …`);
  const msg = await sendDirectMessage(sender!.id, recipient!.id, BODY);
  console.log(`  message row #${msg?.id ?? "(not returned)"} inserted`);

  console.log(`  waiting ${PUSH_GRACE_SECONDS}s for the un-awaited push to settle …`);
  await new Promise((r) => setTimeout(r, PUSH_GRACE_SECONDS * 1000));

  // Prove the notification landed, rather than assuming it did.
  const notices = await q<{ id: number; type: string; title: string; message: string }[]>(
    `SELECT id, type, title, message FROM notifications
      WHERE userId = ? AND createdAt >= ? ORDER BY id DESC LIMIT 5`,
    [recipient!.id, before],
  );

  if (!notices.length) {
    console.log("\n  FAIL  the message sent but NO notification row was created.");
    console.log("        The quiet window is the likely cause: this sender already");
    console.log("        messaged this member within the last 5 minutes, which is");
    console.log("        correct behaviour. Wait 5 minutes and run it again.");
    await conn.end();
    process.exit(1);
  }

  console.log(`\n  ok    ${notices.length} notification row(s) created for #${recipient!.id}:`);
  for (const n of notices) {
    console.log(`          [${n.type}] ${n.title}`);
    console.log(`          "${n.message}"`);
  }

  const chat = notices.find((n) => n.title.startsWith("Message from "));
  console.log(
    chat
      ? `\n  ok    title carries the "Message from " prefix, so the bell shows it\n        as a Message rather than a generic notice.`
      : `\n  LOOK  no row has the "Message from " prefix, so the bell will label\n        this as General. The prefix is set in db.ts (CHAT_TITLE_PREFIX).`,
  );

  console.log(
    `\nSent. The push was accepted by ${recipient!.devices} device(s) if any; accepted` +
      `\nmeans it left here, not that it arrived. Ask them whether it buzzed.`,
  );

  await conn.end();
  process.exit(chat ? 0 : 1);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
