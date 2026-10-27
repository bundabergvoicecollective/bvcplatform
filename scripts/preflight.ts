/**
 * Pre-rehearsal check: is everything a Tuesday night needs actually working?
 *
 * Read-only throughout. It signs nobody in, sends no email, writes no row.
 * What it cannot do is click: there is no browser here, so this proves the
 * server answers and the data is sound, not that a button looks right.
 *
 * Grouped by what it would cost to find out at 6:30pm with 50 people waiting.
 *
 * Usage: SITE=https://… DATABASE_URL=… tsx scripts/preflight.ts
 */
import mysql from "mysql2/promise";

// --site=… wins, so the run.app host can be checked the same way when the
// subdomain is the thing under suspicion.
const SITE = (
  process.argv.find((a) => a.startsWith("--site="))?.slice(7) ??
  process.env.SITE ??
  "https://members.bundabergvoicecollective.com.au"
).replace(/\/+$/, "");

type Level = "critical" | "warn";
const fails: { level: Level; what: string; detail: string }[] = [];
let checks = 0;

function ok(what: string, detail = "") {
  checks++;
  console.log(`  ok    ${what}${detail ? `  — ${detail}` : ""}`);
}
function bad(level: Level, what: string, detail: string) {
  checks++;
  fails.push({ level, what, detail });
  console.log(`  ${level === "critical" ? "FAIL" : "warn"}  ${what}  — ${detail}`);
}

async function get(path: string, init: RequestInit = {}) {
  const started = Date.now();
  const res = await fetch(`${SITE}${path}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
    ...init,
  });
  return { res, ms: Date.now() - started };
}

/** A tRPC GET, unwrapped from superjson's envelope. */
async function trpc(proc: string): Promise<{ status: number; data?: unknown; raw: string }> {
  const input = encodeURIComponent(JSON.stringify({ json: null }));
  const { res } = await get(`/api/trpc/${proc}?input=${input}`);
  const raw = await res.text();
  if (!res.ok) return { status: res.status, raw: raw.slice(0, 200) };
  try {
    const body = JSON.parse(raw);
    const d = body?.result?.data;
    return { status: res.status, data: d?.json !== undefined ? d.json : d, raw: raw.slice(0, 200) };
  } catch {
    return { status: res.status, raw: raw.slice(0, 200) };
  }
}

async function main() {
  console.log(`Pre-rehearsal check — ${SITE}\n`);

  // ── 1. Is the site there at all? ────────────────────────────────────────
  console.log("The site answers");
  let html = "";
  try {
    const first = await get("/");
    html = await first.res.text();
    if (first.res.ok) {
      // min-instances=0, so the first request of the evening pays a cold
      // start. Worth seeing the number rather than being surprised by it.
      ok("home page", `${first.res.status} in ${(first.ms / 1000).toFixed(1)}s (cold)`);
      if (first.ms > 20_000) bad("warn", "cold start is slow", `${(first.ms / 1000).toFixed(1)}s — the first person in may wait`);
    } else {
      bad("critical", "home page", `HTTP ${first.res.status}`);
    }
    const second = await get("/");
    ok("home page again", `${(second.ms / 1000).toFixed(1)}s (warm)`);
  } catch (err) {
    bad("critical", "home page", `could not be reached: ${(err as Error).message}`);
  }

  if (html && !/<div id="root"|<div id="app"/.test(html)) {
    bad("critical", "home page content", "does not look like the app shell — is something else answering on this host?");
  } else if (html) {
    ok("home page content", "the app shell is being served");
  }

  // The hashed bundle. If this 404s the page loads blank, which is the worst
  // failure of the lot because it still returns 200.
  const bundle = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  if (!bundle) {
    bad("warn", "javascript bundle", "no /assets/*.js in the HTML to check");
  } else {
    try {
      const { res } = await get(bundle);
      res.ok ? ok("javascript bundle", `${bundle.slice(0, 34)}… ${res.status}`) : bad("critical", "javascript bundle", `HTTP ${res.status} — the app would load blank`);
    } catch (err) {
      bad("critical", "javascript bundle", (err as Error).message);
    }
  }

  // ── 2. The API ──────────────────────────────────────────────────────────
  console.log("\nThe API answers");
  const me = await trpc("auth.me");
  if (me.status === 200 && me.data === null) ok("auth.me", "200, nobody signed in — tRPC and superjson agree");
  else if (me.status === 200) ok("auth.me", "200");
  else bad("critical", "auth.me", `HTTP ${me.status} — the whole front end would fail. ${me.raw}`);

  const products = await trpc("payments.products");
  if (Array.isArray(products.data) && products.data.length) {
    const paid = (products.data as { name?: string; amountCents?: number }[])
      .filter((p) => (p.amountCents ?? 0) > 0)
      .map((p) => `$${((p.amountCents ?? 0) / 100).toFixed(0)}`)
      .join(" / ");
    ok("pass products", `${products.data.length} defined, priced ${paid}`);
  } else {
    bad("critical", "pass products", `nothing returned — buying a pass tonight would fail. HTTP ${products.status}`);
  }

  // The auth routes are mounted outside tRPC, so they can be absent on their
  // own. Signed out, this is meant to answer 401 — a 404 means they are gone.
  try {
    const { res } = await get("/api/auth/me");
    if (res.status === 401) ok("auth routes are mounted", "401 when signed out, as it should be");
    else if (res.status === 404) bad("critical", "auth routes", "404 — sign-in, password reset and invites are all unreachable");
    else bad("warn", "auth routes", `HTTP ${res.status} signed out, expected 401`);
  } catch (err) {
    bad("critical", "auth routes", (err as Error).message);
  }

  // Signing in, as far as it can go without a real password: a deliberately
  // unknown address should come back 401 from the database lookup. A 500 here
  // means the live app cannot reach the database, which no page would say.
  try {
    const { res } = await get("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "preflight-no-such-member@example.invalid", password: "not-a-password" }),
    });
    if (res.status === 401) ok("sign-in reaches the database", "an unknown address is refused, not errored");
    else if (res.status === 500) bad("critical", "sign-in", "HTTP 500 — the live app cannot query the database; nobody can log in");
    else bad("warn", "sign-in", `HTTP ${res.status} for an unknown address, expected 401`);
  } catch (err) {
    bad("critical", "sign-in", (err as Error).message);
  }

  // ── 3. The phone icon and manifest ──────────────────────────────────────
  console.log("\nAdded to a home screen");
  for (const [path, label] of [
    ["/manifest.json", "manifest"],
    ["/icons/apple-touch-icon.png", "iPhone icon"],
    ["/icons/icon-512.png", "Android icon"],
  ] as const) {
    try {
      const { res } = await get(path);
      if (!res.ok) { bad("warn", label, `HTTP ${res.status}`); continue; }
      const len = (await res.arrayBuffer()).byteLength;
      ok(label, `${res.status}, ${(len / 1024).toFixed(0)} KB`);
    } catch (err) {
      bad("warn", label, (err as Error).message);
    }
  }

  // ── 4. The database, and tonight specifically ───────────────────────────
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    bad("warn", "database checks", "DATABASE_URL is not set in this job — skipped");
  } else {
    const conn = await mysql.createConnection(dbUrl);
    const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

    console.log("\nThe data behind tonight");

    const [ver] = await q<{ v: string }[]>("SELECT version() AS v");
    ok("database", ver.v);

    // Brisbane's today, because the server keeps UTC and is ten hours behind.
    const [today] = await q<{ d: string; dow: string }[]>(
      `SELECT DATE_FORMAT(DATE_ADD(now(), INTERVAL 10 HOUR), '%Y-%m-%d') AS d,
              DATE_FORMAT(DATE_ADD(now(), INTERVAL 10 HOUR), '%W') AS dow`,
    );

    const tonight = await q<{ id: number; title: string; t: string }[]>(
      `SELECT id, title, DATE_FORMAT(DATE_ADD(sessionDate, INTERVAL 10 HOUR), '%H:%i') AS t
         FROM sessions
        WHERE DATE(DATE_ADD(sessionDate, INTERVAL 10 HOUR)) = ?`,
      [today.d],
    );
    if (tonight.length) {
      ok("tonight's rehearsal exists", `#${tonight[0].id} "${tonight[0].title}" at ${tonight[0].t}`);
    } else {
      bad(
        "critical",
        "tonight's rehearsal",
        `no session row for ${today.dow} ${today.d} — attendance cannot be marked until one is created under Attendance → New Session`,
      );
    }

    const [members] = await q<{ total: number; canSignIn: number }[]>(
      `SELECT count(*) AS total,
              sum(passwordHash IS NOT NULL AND passwordHash <> '') AS canSignIn
         FROM users WHERE status = 'active'`,
    );
    ok("members", `${members.total} active, ${members.canSignIn} have set a password`);

    const [passes] = await q<{ active: number; sessions: number }[]>(
      "SELECT count(*) AS active, COALESCE(sum(remainingSessions),0) AS sessions FROM passes WHERE active = 1",
    );
    ok("passes", `${passes.active} active, ${passes.sessions} sessions outstanding`);

    // The thing most likely to bite tonight: a mark that does not deduct.
    const drift = await q<{ userId: number; marks: number; deductions: number }[]>(
      `SELECT a.userId, count(*) AS marks,
              (SELECT count(*) FROM user_activity_log l
                WHERE l.userId = a.userId AND l.balanceBefore IS NOT NULL
                  AND l.balanceAfter < l.balanceBefore
                  AND DATE(DATE_ADD(l.createdAt, INTERVAL 10 HOUR)) = DATE(DATE_ADD(a.markedAt, INTERVAL 10 HOUR))
              ) AS deductions
         FROM attendance a
        WHERE a.attended = 1 AND a.passUsed = 1 AND a.markedAt >= DATE_SUB(now(), INTERVAL 21 DAY)
        GROUP BY a.userId, DATE(DATE_ADD(a.markedAt, INTERVAL 10 HOUR))
       HAVING deductions < marks`,
    );
    drift.length
      ? bad("warn", "attendance vs passes", `${drift.length} member-day(s) marked present with no deduction logged — run the passdrift audit`)
      : ok("attendance vs passes", "every mark in the last three weeks deducted correctly");

    // Does the schema the code expects actually exist? The sessionId column is
    // the newest, and cash recorded tonight depends on it.
    const [col] = await q<{ n: number }[]>(
      `SELECT count(*) AS n FROM information_schema.columns
        WHERE table_schema = database() AND table_name = 'pass_orders' AND column_name = 'sessionId'`,
    );
    Number(col.n) === 1
      ? ok("cash can be attributed to a rehearsal", "pass_orders.sessionId is there")
      : bad("critical", "pass_orders.sessionId is missing", "cash recorded tonight would attach to nothing");

    // What the members will actually open when they get home.
    const [content] = await q<{ library: number; photos: number; docs: number; notices: number }[]>(
      `SELECT (SELECT count(*) FROM library_items) AS library,
              (SELECT count(*) FROM gallery_posts WHERE status = 'approved') AS photos,
              (SELECT count(*) FROM documents) AS docs,
              (SELECT count(*) FROM announcements) AS notices`,
    );
    ok("content", `${content.library} library items, ${content.photos} photos, ${content.docs} documents, ${content.notices} announcements`);

    const upcoming = await q<{ id: number; title: string; d: string; rsvps: number }[]>(
      `SELECT e.id, e.title,
              DATE_FORMAT(DATE_ADD(e.eventDate, INTERVAL 10 HOUR), '%e %b') AS d,
              (SELECT count(*) FROM event_rsvps r WHERE r.eventId = e.id AND r.status = 'attending') AS rsvps
         FROM events e
        WHERE e.eventDate >= DATE_SUB(now(), INTERVAL 1 DAY)
        ORDER BY e.eventDate LIMIT 4`,
    );
    upcoming.length
      ? ok("upcoming events", upcoming.map((e) => `${e.title.slice(0, 24)} ${e.d} (${e.rsvps} yes)`).join("; "))
      : bad("warn", "upcoming events", "none in the diary");

    // Can members actually open the music? One real file, through our proxy.
    const [item] = await q<{ fileUrl: string; title: string }[]>(
      "SELECT fileUrl, title FROM library_items WHERE fileUrl LIKE '/%' ORDER BY createdAt DESC LIMIT 1",
    );
    const [photo] = await q<{ imageUrl: string }[]>(
      "SELECT imageUrl FROM gallery_posts WHERE status = 'approved' AND imageUrl LIKE '/%' ORDER BY createdAt DESC LIMIT 1",
    );
    await conn.end();

    for (const [url, label, level] of [
      [item?.fileUrl, item ? `the newest music ("${item.title.slice(0, 28)}")` : "", "critical"],
      [photo?.imageUrl, "the newest photo", "warn"],
    ] as [string | undefined, string, Level][]) {
      if (!url) { bad("warn", label || "a stored file", "nothing with a servable path to test"); continue; }
      try {
        // A range request: enough to prove the bytes are there without
        // pulling a 20 MB PDF through the runner.
        const { res } = await get(url, { headers: { range: "bytes=0-2047" } });
        const bytes = (await res.arrayBuffer()).byteLength;
        res.ok && bytes > 0
          ? ok(`${label} downloads`, `${res.status}, ${bytes} bytes read`)
          : bad(level, label, `HTTP ${res.status}, ${bytes} bytes — members cannot open it`);
      } catch (err) {
        bad(level, label, (err as Error).message);
      }
    }
  }

  // ── Verdict ─────────────────────────────────────────────────────────────
  const critical = fails.filter((f) => f.level === "critical");
  const warnings = fails.filter((f) => f.level === "warn");
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${checks} checks, ${critical.length} failed, ${warnings.length} worth a look.\n`);

  if (critical.length) {
    console.log("Needs fixing before tonight:");
    for (const f of critical) console.log(`  ${f.what} — ${f.detail}`);
  }
  if (warnings.length) {
    console.log(`${critical.length ? "\n" : ""}Worth a look:`);
    for (const f of warnings) console.log(`  ${f.what} — ${f.detail}`);
  }
  if (!fails.length) console.log("Everything checked is working.");

  if (critical.length) process.exit(1);
}

main().catch((err) => {
  console.error("\nPreflight FAILED to run:", err instanceof Error ? err.message : err);
  process.exit(1);
});
