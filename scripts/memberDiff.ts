/**
 * Read-only: who does Manus have that we do not, and the other way round?
 *
 * The Manus dashboard says 77 members; this database has 76. One person is
 * the difference, and "one of 77" is not an answer anyone can act on.
 *
 * Matching is by email, lower(trim(...)) on both sides, the same way the app
 * looks members up — see the note in db.ts about addresses from Manus.
 *
 * ── about what this prints ──
 *
 * This repository is public and so are its Actions logs. A member's name and
 * address together are theirs, not ours to publish, so addresses are masked
 * and names are reduced to initials. What is left — a masked address, the
 * date they joined, their status — is enough for an admin who already has the
 * member list to say who it is, and not enough for anyone else.
 *
 * --show-emails prints them in full. That is for a local run against a
 * DATABASE_URL on someone's own machine, never in CI.
 *
 * Usage:
 *   DATABASE_URL=... MANUS_HOST=... MANUS_COOKIE=... tsx scripts/memberDiff.ts
 */
import mysql from "mysql2/promise";

const HOST = (process.env.MANUS_HOST ?? "").replace(/\/+$/, "");
const COOKIE = process.env.MANUS_COOKIE ?? "";
const SHOW_EMAILS = process.argv.includes("--show-emails");

const key = (email: string | null | undefined) => (email ?? "").toLowerCase().trim();

/** de…@gmail.com — enough to recognise, not enough to harvest. */
const shown = (email: string) =>
  SHOW_EMAILS ? email : email.replace(/^(.{2})[^@]*(@.*)$/, "$1…$2");

/** "Jane Smith" → "J.S." */
const initials = (name: string | null | undefined) => {
  if (SHOW_EMAILS) return name ?? "(no name)";
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.map((p) => `${p[0].toUpperCase()}.`).join("") : "(no name)";
};

const day = (v: unknown) => {
  const d = v ? new Date(v as string) : null;
  return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "(no date)";
};

type Row = Record<string, unknown>;

async function call(proc: string): Promise<unknown> {
  const input = encodeURIComponent(JSON.stringify({ json: null }));
  const res = await fetch(`${HOST}/api/trpc/${proc}?input=${input}`, {
    headers: { cookie: COOKIE, accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
    redirect: "follow",
  });
  if (res.status === 401 || res.status === 403) throw new Error(`HTTP ${res.status} — not signed in`);
  if ((res.headers.get("content-type") ?? "").includes("text/html"))
    throw new Error("got a web page, not JSON — the session is not signed in");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  if ((body as { error?: unknown }).error) throw new Error("tRPC error");
  const result = (body as { result?: { data?: unknown } }).result?.data;
  return (result as { json?: unknown })?.json ?? result ?? body;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set.");
  if (!HOST) throw new Error("MANUS_HOST is not set.");
  if (!COOKIE) throw new Error("MANUS_COOKIE is not set. Manus will not list members without a session.");

  const candidates = [
    "members.list",
    "users.list",
    "members.all",
    "admin.members",
    "admin.listMembers",
    "users.all",
    "members.getAll",
  ];

  let manus: Row[] | null = null;
  let via = "";
  const tried: string[] = [];
  for (const proc of candidates) {
    try {
      const data = await call(proc);
      const list = Array.isArray(data)
        ? data
        : data && typeof data === "object"
          ? (Object.values(data).find((v) => Array.isArray(v)) as Row[] | undefined)
          : undefined;
      if (list) {
        manus = list as Row[];
        via = proc;
        break;
      }
      tried.push(`${proc}: not a list`);
    } catch (err) {
      tried.push(`${proc}: ${(err as Error).message}`);
    }
  }

  if (!manus) {
    console.error("::error::Could not read the member list from Manus.");
    for (const t of tried) console.error(`  ${t}`);
    process.exit(1);
  }

  const conn = await mysql.createConnection(dbUrl);
  const ours = (
    await conn.query("SELECT email, name, firstName, lastName, status, createdAt FROM users")
  )[0] as { email: string | null; name: string | null; firstName: string | null; lastName: string | null; status: string; createdAt: string }[];
  await conn.end();

  const ourByEmail = new Map(ours.map((u) => [key(u.email), u]));
  const theirByEmail = new Map<string, Row>();
  let theirsWithoutEmail = 0;
  for (const m of manus) {
    const e = key((m.email ?? m.emailAddress) as string | null);
    if (!e) {
      theirsWithoutEmail++;
      continue;
    }
    if (!theirByEmail.has(e)) theirByEmail.set(e, m);
  }

  console.log(`Manus lists ${manus.length} member(s) (via ${via}); this database has ${ours.length}.`);
  if (theirsWithoutEmail) console.log(`${theirsWithoutEmail} of theirs have no address to match on.`);
  if (theirByEmail.size !== manus.length)
    console.log(`${manus.length - theirByEmail.size - theirsWithoutEmail} duplicate address(es) in theirs.`);
  console.log("");

  const missingHere = [...theirByEmail.entries()].filter(([e]) => !ourByEmail.has(e));
  const missingThere = ours.filter((u) => key(u.email) && !theirByEmail.has(key(u.email)));

  if (!missingHere.length) {
    console.log("Everyone Manus lists is already here.");
  } else {
    console.log(`${missingHere.length} in Manus and NOT here:`);
    for (const [e, m] of missingHere) {
      const name = (m.name ?? `${m.firstName ?? ""} ${m.lastName ?? ""}`) as string;
      console.log(
        `  ${shown(e).padEnd(28)} ${initials(name).padEnd(8)} joined ${day(m.createdAt ?? m.memberSince)}` +
          `  status ${String(m.status ?? "?")}`,
      );
    }
  }

  console.log("");
  if (!missingThere.length) {
    console.log("And everyone here is in Manus.");
  } else {
    console.log(`${missingThere.length} here and NOT in Manus:`);
    for (const u of missingThere) {
      const name = u.name ?? `${u.firstName ?? ""} ${u.lastName ?? ""}`;
      console.log(
        `  ${shown(key(u.email)).padEnd(28)} ${initials(name).padEnd(8)} added  ${day(u.createdAt)}` +
          `  status ${u.status}`,
      );
    }
  }

  if (!SHOW_EMAILS && (missingHere.length || missingThere.length)) {
    console.log(
      "\nAddresses are masked and names cut to initials — this log is public.\n" +
        "Match them against the member export, or re-run with --show-emails\n" +
        "locally if that is not enough.",
    );
  }
}

main().catch((err) => {
  console.error("\nMember diff FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
