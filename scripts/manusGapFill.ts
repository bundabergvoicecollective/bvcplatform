/**
 * Fills the two gaps the coverage check found: the RSVPs that never came
 * across with their performances, and a live stream Manus has that we do not.
 *
 * The Carols performance imported cleanly as a row and arrived with 3 RSVPs
 * against 28 in Manus, because event_rsvps was on nobody's list. Live streams
 * were 14 here against 15 there.
 *
 * ── matching people ──
 *
 * By EMAIL, lower(trim(...)) on both sides, the same way the app looks members
 * up and the same way importManusDelta.ts does it. NOT by Manus's user id:
 * nothing guarantees their ids and ours are the same numbers, and an RSVP
 * attached to the wrong member is worse than a missing one — it tells somebody
 * they are singing at a concert they never agreed to.
 *
 * If a row cannot be matched to a member here, it is reported and skipped. No
 * guessing by name.
 *
 * Events are matched by title and date, not by id, for the same reason.
 *
 * Nothing is updated and nothing is deleted. A member who already has an RSVP
 * for an event is left exactly as they are, including if they have since
 * changed their answer on this site — their latest answer here is the real one.
 *
 * Reports by default. Writes only with --apply.
 *
 * Usage:
 *   DATABASE_URL=... MANUS_HOST=... MANUS_COOKIE=... tsx scripts/manusGapFill.ts [--apply]
 */
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const SHOW_EMAILS = process.argv.includes("--show-emails");
const HOST = (process.env.MANUS_HOST ?? "").replace(/\/+$/, "");
const COOKIE = process.env.MANUS_COOKIE ?? "";

type Row = Record<string, unknown>;

const key = (e: unknown) => String(e ?? "").toLowerCase().trim();
const shown = (e: string) => (SHOW_EMAILS ? e : e.replace(/^(.{2})[^@]*(@.*)$/, "$1…$2"));
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const toSql = (v: unknown) => {
  const d = v ? new Date(v as string) : new Date();
  return (isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 19).replace("T", " ");
};
const dayOf = (v: unknown) => toSql(v).slice(0, 10);

async function call(proc: string, input: unknown = null): Promise<unknown> {
  const q = encodeURIComponent(JSON.stringify({ json: input }));
  const res = await fetch(`${HOST}/api/trpc/${proc}?input=${q}`, {
    headers: { cookie: COOKIE, accept: "application/json" },
    signal: AbortSignal.timeout(45_000),
    redirect: "follow",
  });
  if (res.status === 401 || res.status === 403) throw new Error(`HTTP ${res.status} — not signed in`);
  if ((res.headers.get("content-type") ?? "").includes("text/html"))
    throw new Error("a web page, not JSON — not signed in");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  if ((body as { error?: unknown }).error) throw new Error("tRPC error");
  const result = (body as { result?: { data?: unknown } }).result?.data;
  return (result as { json?: unknown })?.json ?? result ?? body;
}

function asList(data: unknown): Row[] | null {
  if (Array.isArray(data)) return data as Row[];
  if (data && typeof data === "object") {
    const inner = Object.values(data).find((v) => Array.isArray(v));
    if (inner) return inner as Row[];
  }
  return null;
}

/** The id parameter's name is not in the bundle, so try the plausible ones. */
async function listFor(proc: string, id: number, keys: string[], remember: { key?: string }) {
  const order = remember.key ? [remember.key, ...keys.filter((k) => k !== remember.key)] : keys;
  for (const k of order) {
    try {
      const rows = asList(await call(proc, { [k]: id }));
      if (rows) {
        remember.key = k;
        return rows;
      }
    } catch {
      /* next */
    }
  }
  return null;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set.");
  if (!HOST) throw new Error("MANUS_HOST is not set.");
  if (!COOKIE) throw new Error("MANUS_COOKIE is not set. Manus will not answer without a session.");

  const conn = await mysql.createConnection(dbUrl);
  const q = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
    (await conn.query(sql, params))[0] as T;

  console.log(APPLY ? "APPLYING — rows will be inserted.\n" : "Dry run. Nothing will be written.\n");

  const [admin] = await q<{ id: number }[]>("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  if (!admin) throw new Error("No admin user to attribute imported rows to.");

  const members = await q<{ id: number; email: string | null }[]>("SELECT id, email FROM users");
  const byEmail = new Map(members.filter((m) => m.email).map((m) => [key(m.email), m.id]));

  // ── 1. The missing live stream ────────────────────────────────────────────
  console.log("Live streams");
  const theirStreams = asList(await call("liveStreams.list")) ?? [];
  const ourStreams = await q<{ id: number; title: string; d: string }[]>(
    "SELECT id, title, DATE_FORMAT(scheduledAt, '%Y-%m-%d') AS d FROM live_streams",
  );
  const haveStream = new Set(ourStreams.map((s) => `${s.title}|${s.d}`));
  const missingStreams = theirStreams.filter(
    (s) => !haveStream.has(`${str(pickAny(s, "title", "name")) ?? ""}|${dayOf(pickAny(s, "scheduledAt", "startsAt", "date"))}`),
  );
  console.log(`  Manus has ${theirStreams.length}, we have ${ourStreams.length}, ${missingStreams.length} to add`);
  if (missingStreams.length && !APPLY) {
    console.log(`  fields: ${Object.keys(missingStreams[0]).sort().join(", ")}`);
    for (const s of missingStreams) {
      console.log(`  → "${str(pickAny(s, "title", "name"))}"  ${dayOf(pickAny(s, "scheduledAt", "startsAt", "date"))}`);
    }
  }
  if (APPLY) {
    let added = 0;
    for (const s of missingStreams) {
      const url = str(pickAny(s, "streamUrl", "url", "link"));
      if (!url) {
        console.log(`  skipped "${str(pickAny(s, "title", "name"))}" — no stream URL to copy`);
        continue;
      }
      await q(
        `INSERT INTO live_streams (title, description, streamUrl, recordingUrl, scheduledAt, endsAt, createdBy, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          str(pickAny(s, "title", "name")) ?? "Untitled",
          str(pickAny(s, "description")),
          url,
          str(pickAny(s, "recordingUrl")),
          toSql(pickAny(s, "scheduledAt", "startsAt", "date")),
          pickAny(s, "endsAt") ? toSql(pickAny(s, "endsAt")) : null,
          admin.id,
          toSql(pickAny(s, "createdAt")),
        ],
      );
      added++;
    }
    console.log(`  ${added} added`);
  }

  // ── 2. RSVPs, per performance ─────────────────────────────────────────────
  console.log("\nRSVPs");
  const ourEvents = await q<{ id: number; title: string; d: string }[]>(
    "SELECT id, title, DATE_FORMAT(eventDate, '%Y-%m-%d') AS d FROM events ORDER BY eventDate",
  );
  const theirEvents = asList(await call("events.list")) ?? [];
  // Match events by what they are, not by id.
  const theirByKey = new Map(
    theirEvents.map((e) => [`${str(pickAny(e, "title", "name")) ?? ""}|${dayOf(pickAny(e, "eventDate", "date"))}`, e]),
  );

  const remember: { key?: string } = {};
  let totalToAdd = 0;
  let totalAdded = 0;
  const unmatched: string[] = [];
  let fieldsShown = false;

  for (const ev of ourEvents) {
    const theirs = theirByKey.get(`${ev.title}|${ev.d}`);
    if (!theirs) {
      console.log(`  ${ev.title.slice(0, 40).padEnd(42)} not in Manus — nothing to copy`);
      continue;
    }
    const theirId = Number(pickAny(theirs, "id"));
    const rows = (await listFor("events.rsvpList", theirId, ["eventId", "id", "eventID"], remember)) ?? [];

    const existing = await q<{ userId: number }[]>("SELECT userId FROM event_rsvps WHERE eventId = ?", [ev.id]);
    const have = new Set(existing.map((r) => r.userId));

    const toAdd: { userId: number; status: string; createdAt: unknown }[] = [];
    for (const r of rows) {
      if (!fieldsShown && !APPLY) {
        console.log(`  fields Manus returns: ${Object.keys(r).sort().join(", ")}`);
        fieldsShown = true;
      }
      const email = key(pickAny(r, "email", "userEmail", "memberEmail"));
      if (!email) {
        unmatched.push(`${ev.title}: a row with no address to match on`);
        continue;
      }
      const userId = byEmail.get(email);
      if (!userId) {
        unmatched.push(`${ev.title}: ${shown(email)} is not a member here`);
        continue;
      }
      if (have.has(userId)) continue;

      const raw = String(pickAny(r, "status", "response", "rsvp") ?? "").toLowerCase();
      // Anything that is not plainly a yes is recorded as not attending. A
      // wrong "attending" puts somebody on a concert list who never said yes.
      const status = /^(attending|yes|going|true|1)$/.test(raw) ? "attending" : "not_attending";
      toAdd.push({ userId, status, createdAt: pickAny(r, "createdAt", "respondedAt") });
    }

    totalToAdd += toAdd.length;
    console.log(
      `  ${ev.title.slice(0, 40).padEnd(42)} ${String(existing.length).padStart(3)} here, ${String(rows.length).padStart(3)} there, ${String(toAdd.length).padStart(3)} to add`,
    );

    if (APPLY) {
      for (const a of toAdd) {
        await q(
          "INSERT INTO event_rsvps (eventId, userId, status, createdAt) VALUES (?, ?, ?, ?)",
          [ev.id, a.userId, a.status, toSql(a.createdAt)],
        );
        totalAdded++;
      }
    }
  }

  console.log("");
  if (APPLY) console.log(`${totalAdded} RSVP(s) added.`);
  else console.log(`${totalToAdd} RSVP(s) would be added. Nothing was written.`);

  if (unmatched.length) {
    console.log(`\n${unmatched.length} row(s) could not be matched to a member here:`);
    for (const u of unmatched.slice(0, 15)) console.log(`  ${u}`);
    if (unmatched.length > 15) console.log(`  …and ${unmatched.length - 15} more`);
    console.log("  These are skipped, never guessed at.");
  }

  await conn.end();
}

/** The first of these keys that carries a value. */
function pickAny(row: Row, ...names: string[]): unknown {
  for (const n of names) if (row[n] !== undefined && row[n] !== null && row[n] !== "") return row[n];
  return null;
}

main().catch((err) => {
  console.error("\nGap fill FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
