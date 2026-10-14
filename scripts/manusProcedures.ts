/**
 * What tRPC procedures does the Manus app actually have?
 *
 * The coverage check guessed names from a candidate list and six tables came
 * back "no procedure answered" — attendance, passes, pass_orders, event_rsvps,
 * gallery_reactions, gallery_comments. That is not the same as zero, and
 * treating it as zero is how the Carols event imported cleanly and arrived
 * without its 28 RSVPs.
 *
 * Guessing harder is not the answer. The Manus front end calls these
 * procedures, so their names are in its JavaScript, which is served to anyone
 * without a login.
 *
 * A tRPC client builds the path from property access through a Proxy —
 * `trpc.events.list.useQuery()` — and a minifier leaves property names alone
 * because it cannot know they are not dynamic. So the chains survive bundling
 * and can be read straight out of the file.
 *
 * Read-only, and it reads only the public bundle. Procedure names are the
 * app's own API surface, not member data.
 *
 * Usage: MANUS_HOST=https://… tsx scripts/manusProcedures.ts
 */

// This file has no imports, so without an export TypeScript treats it as a
// script in the global scope — and its helpers then collide with identically
// named ones in the other scripts here. cloudflareDns.ts also has a `get`.
export {};

const HOST = (process.env.MANUS_HOST ?? "").replace(/\/+$/, "");

/** The React Query / vanilla client call sites that end a procedure path. */
const TERMINALS = [
  "useQuery",
  "useMutation",
  "useInfiniteQuery",
  "useSuspenseQuery",
  "useUtils",
  "query",
  "mutate",
  "mutateAsync",
  "fetch",
  "invalidate",
  "setData",
  "getData",
  "prefetch",
];

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function main() {
  if (!HOST) throw new Error("MANUS_HOST is not set.");

  console.log(`Reading ${HOST} …\n`);
  const html = await fetchText(HOST);

  // Every script the page loads, plus anything it modulepreloads.
  const srcs = new Set<string>();
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) srcs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/gi)) srcs.add(m[1]);
  if (!srcs.size) {
    console.log("No script tags found. The markup may be rendered another way.");
    return;
  }

  const found = new Map<string, Set<string>>(); // router → procedures
  let bytes = 0;
  const queue = [...srcs];
  const seen = new Set<string>();

  while (queue.length) {
    const src = queue.shift()!;
    if (seen.has(src)) continue;
    seen.add(src);
    const url = src.startsWith("http") ? src : `${HOST}${src.startsWith("/") ? "" : "/"}${src}`;
    let js: string;
    try {
      js = await fetchText(url);
    } catch (err) {
      console.log(`  could not read ${src.slice(-40)} — ${(err as Error).message}`);
      continue;
    }
    bytes += js.length;
    console.log(`  read ${src.slice(-48).padEnd(48)} ${(js.length / 1024).toFixed(0)} KB`);

    // `.router.procedure.useQuery(` and friends. Routers and procedures are
    // camelCase identifiers; the terminal is what proves it is a tRPC path
    // rather than any other property chain.
    const re = new RegExp(
      String.raw`\.([a-z][A-Za-z0-9]{1,30})\.([a-z][A-Za-z0-9]{1,40})\.(?:${TERMINALS.join("|")})\b`,
      "g",
    );
    for (const m of js.matchAll(re)) {
      const [, router, proc] = m;
      if (!found.has(router)) found.set(router, new Set());
      found.get(router)!.add(proc);
    }
  }

  console.log(`\nRead ${(bytes / 1024 / 1024).toFixed(1)} MB of JavaScript.\n`);

  if (!found.size) {
    console.log("No procedure chains matched. The client may build its paths another way.");
    return;
  }

  // Routers we care about first, then the rest — the point of this is the six
  // tables the coverage check could not read.
  const WANTED = [
    "attendance", "passes", "passOrders", "orders", "events", "rsvps",
    "gallery", "members", "users", "shop", "liveStreams", "sessions", "rehearsals",
  ];
  const routers = [...found.keys()].sort((a, b) => {
    const ai = WANTED.indexOf(a), bi = WANTED.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.localeCompare(b);
  });

  for (const router of routers) {
    const procs = [...found.get(router)!].sort();
    const mark = WANTED.includes(router) ? "* " : "  ";
    console.log(`${mark}${router}`);
    console.log(`    ${procs.join(", ")}`);
  }

  console.log(
    "\n* marks a router the coverage check needs. Feed the real names back into\n" +
      "scripts/manusCoverage.ts and the '?' rows become numbers.",
  );
}

main().catch((err) => {
  console.error("\nProcedure discovery FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
