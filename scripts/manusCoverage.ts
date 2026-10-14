/**
 * Read-only: table by table, what does Manus hold and what do we?
 *
 * The migration has been done in pieces — members and attendance in
 * September, rehearsals and orders on 6 October, content and files on the
 * 14th — and each piece covered what it was asked to. Nobody has ever stood
 * back and compared the two systems as wholes.
 *
 * The RSVPs are why this exists. The Carols performance came across as a row
 * and arrived with none of its 28 responses, because event_rsvps was not in
 * anybody's list. A thing nobody listed is a thing nobody checked, and the
 * only cure is to enumerate every table and say, for each one, whether it was
 * looked at and what the two numbers are.
 *
 * Counts only — no names, no addresses, no message bodies. The repository is
 * public.
 *
 * Some of Manus's lists need a parent id (an event's RSVPs, a post's
 * comments), so those iterate the parents. That costs one request each, which
 * is why this is a report and not something to run in a loop.
 *
 * Usage: DATABASE_URL=... MANUS_HOST=... MANUS_COOKIE=... tsx scripts/manusCoverage.ts
 */
import mysql from "mysql2/promise";

const HOST = (process.env.MANUS_HOST ?? "").replace(/\/+$/, "");
const COOKIE = process.env.MANUS_COOKIE ?? "";

type Row = Record<string, unknown>;

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

/** Any array in the response, however it is wrapped. */
function asList(data: unknown): Row[] | null {
  if (Array.isArray(data)) return data as Row[];
  if (data && typeof data === "object") {
    const inner = Object.values(data).find((v) => Array.isArray(v));
    if (inner) return inner as Row[];
  }
  return null;
}

async function firstList(candidates: string[], input: unknown = null): Promise<{ proc: string; rows: Row[] } | null> {
  for (const proc of candidates) {
    try {
      const rows = asList(await call(proc, input));
      if (rows) return { proc, rows };
    } catch {
      /* try the next name */
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
  const count = async (table: string): Promise<number | null> => {
    try {
      const [r] = (await conn.query(`SELECT count(*) AS n FROM \`${table}\``))[0] as { n: number }[];
      return Number(r.n);
    } catch {
      return null;
    }
  };

  // Read our side first and close the connection: the Manus calls below take
  // minutes, and a connection held across them gets dropped (see the note in
  // mediaBackfill.ts).
  const TABLES = [
    "users", "sessions", "attendance", "passes", "pass_orders", "notifications",
    "announcements", "announcement_reads", "library_items", "documents",
    "events", "event_rsvps", "groups", "group_members", "group_messages",
    "direct_messages", "conversations", "conversation_participants", "conversation_messages",
    "live_streams", "live_stream_access", "rehearsal_recordings", "rehearsal_recording_access",
    "gallery_posts", "gallery_media", "gallery_reactions", "gallery_comments",
    "shop_products", "shop_product_variants", "shop_orders", "shop_order_items",
    "invite_tokens", "password_resets", "push_subscriptions", "user_activity_log",
  ];
  const ours = new Map<string, number | null>();
  for (const t of TABLES) ours.set(t, await count(t));

  const eventIds = ((await conn.query("SELECT id FROM events"))[0] as { id: number }[]).map((r) => r.id);
  const postIds = ((await conn.query("SELECT id FROM gallery_posts"))[0] as { id: number }[]).map((r) => r.id);
  await conn.end();

  console.log("Comparing Manus against this database, table by table.\n");
  console.log("table                        ours   manus   ");
  console.log("─".repeat(58));

  const report = (table: string, manus: number | string, note = "") => {
    const o = ours.get(table);
    const gap =
      typeof manus === "number" && typeof o === "number"
        ? manus > o
          ? `  ← ${manus - o} MISSING HERE`
          : manus < o
            ? `  (we have ${o - manus} more)`
            : "  ok"
        : "";
    console.log(
      `${table.padEnd(28)} ${String(o ?? "—").padStart(5)}   ${String(manus).padStart(5)}${gap}${note}`,
    );
  };

  /** A flat list from Manus, by whichever procedure name answers. */
  const flat = async (table: string, candidates: string[]) => {
    const got = await firstList(candidates);
    report(table, got ? got.rows.length : "?", got ? "" : "  (no procedure answered)");
    return got?.rows ?? [];
  };

  await flat("users", ["members.list", "users.list", "members.all", "admin.members"]);
  await flat("sessions", ["sessions.list", "rehearsals.list", "sessions.all"]);
  await flat("attendance", ["attendance.all", "attendance.list"]);
  await flat("passes", ["passes.all", "passes.list"]);
  await flat("pass_orders", ["passOrders.list", "orders.list", "passes.orders"]);
  await flat("announcements", ["announcements.list", "announcements.all"]);
  await flat("library_items", ["library.list", "library.all", "libraryItems.list"]);
  await flat("documents", ["documents.list", "documents.all"]);
  await flat("events", ["events.list", "events.all"]);
  await flat("gallery_posts", ["gallery.list", "gallery.feed", "gallery.posts", "gallery.all"]);
  await flat("live_streams", ["liveStreams.list"]);
  await flat("rehearsal_recordings", ["rehearsalRecordings.list", "recordings.list"]);
  await flat("groups", ["groups.list", "groups.all"]);
  await flat("shop_products", ["shop.products", "shop.list", "shop.listProducts"]);
  await flat("shop_orders", ["shop.orders", "shopOrders.list"]);

  // The ones that hang off a parent. These are what get forgotten, because
  // nothing lists them on their own — which is exactly how 28 RSVPs went
  // missing behind an event that imported cleanly.
  const perParent = async (
    table: string,
    parents: number[],
    candidates: string[],
    inputKey: string,
  ) => {
    if (!parents.length) {
      report(table, 0, "  (no parents to ask about)");
      return;
    }
    let total = 0;
    let answered = 0;
    for (const id of parents) {
      const got = await firstList(candidates, { [inputKey]: id });
      if (got) {
        total += got.rows.length;
        answered++;
      }
    }
    report(table, answered ? total : "?", answered ? `  (${answered}/${parents.length} asked)` : "  (no procedure answered)");
  };

  await perParent("event_rsvps", eventIds, ["events.rsvps", "events.getRsvps", "rsvps.list", "events.attendees"], "eventId");
  await perParent("gallery_reactions", postIds, ["gallery.reactions", "gallery.getReactions"], "postId");
  await perParent("gallery_comments", postIds, ["gallery.comments", "gallery.getComments"], "postId");

  console.log(
    "\nTables with no Manus equivalent to ask about — ours alone, nothing to compare:\n" +
      "  notifications, announcement_reads, invite_tokens, password_resets,\n" +
      "  push_subscriptions, user_activity_log, conversations and their messages\n" +
      "\nA '?' means no procedure name answered. That is NOT the same as zero: it\n" +
      "means we still do not know, and the table has to be checked by hand in the\n" +
      "Manus UI before anyone says the migration is complete.",
  );
}

main().catch((err) => {
  console.error("\nCoverage check FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
