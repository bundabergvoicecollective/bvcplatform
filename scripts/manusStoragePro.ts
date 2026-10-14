/**
 * Why does Manus hand over some files and not others?
 *
 * /manus-storage/<key> on Manus is a redirect to a CloudFront distribution.
 * Avatars, performance images and documents came through anonymously; library
 * and gallery answer 403 AccessDenied from CloudFront even with a valid Manus
 * session cookie. Two very different causes produce that same 403:
 *
 *   signed cookies  CloudFront is serving private content and wants
 *                   CloudFront-Policy / -Signature / -Key-Pair-Id cookies,
 *                   which are scoped to the CDN host and so are NOT in a
 *                   Cookie header copied from a manus.space request.
 *   missing object  S3 answers AccessDenied, not NotFound, when the caller
 *                   has no s3:ListBucket. A key that was never uploaded looks
 *                   exactly like one we are not allowed to read.
 *
 * The fix for the first is another secret. The fix for the second is that
 * there is nothing to copy and the files are gone. Worth ten minutes to tell
 * them apart before asking Andy for anything else.
 *
 * So: follow the redirect by hand and report its shape. One key per table,
 * including a table that WORKS, because the difference between the two is
 * the whole answer.
 *
 * Hosts, paths, status codes and query parameter NAMES only — never a
 * signature value. This log is public.
 *
 * Usage: DATABASE_URL=... MANUS_HOST=... MANUS_COOKIE=... tsx scripts/manusStoragePro.ts
 */
import mysql from "mysql2/promise";

const HOST = (process.env.MANUS_HOST ?? "").replace(/\/+$/, "");
const COOKIE = process.env.MANUS_COOKIE ?? "";

/** table, url column, key column, label — one known-good and the failures. */
const SAMPLES: [table: string, urlCol: string, keyCol: string | null, label: string][] = [
  ["users", "avatarUrl", null, "an avatar (known to work)"],
  ["documents", "fileUrl", "fileKey", "a document (known to work)"],
  ["library_items", "fileUrl", "fileKey", "a library item (refused)"],
  ["gallery_posts", "imageUrl", "imageKey", "a gallery post (refused)"],
];

function keyFrom(url: string | null, stored: string | null): string | null {
  if (stored) return stored;
  if (!url) return null;
  const m = /^\/(?:manus-storage|r2-storage)\/(.+)$/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/** A URL reduced to what is safe to print: host, path shape, parameter names. */
function describe(raw: string): string {
  try {
    const u = new URL(raw);
    const params = [...u.searchParams.keys()];
    const depth = u.pathname.split("/").filter(Boolean).length;
    return `${u.host} (${depth} path segments)` + (params.length ? ` ?${params.join("&")}` : " (no query)");
  } catch {
    return "(not a url)";
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set.");
  if (!HOST) throw new Error("MANUS_HOST is not set.");
  console.log(COOKIE ? "Sending the MANUS_COOKIE session.\n" : "No cookie — anonymous.\n");

  const conn = await mysql.createConnection(dbUrl);
  const query = async <T>(sql: string): Promise<T> => (await conn.query(sql))[0] as T;

  for (const [table, urlCol, keyCol, label] of SAMPLES) {
    let rows: { u: string | null; k: string | null }[] = [];
    try {
      rows = await query(
        `SELECT \`${urlCol}\` AS u, ${keyCol ? `\`${keyCol}\`` : "NULL"} AS k FROM \`${table}\`
          WHERE \`${urlCol}\` LIKE '/manus-storage/%' LIMIT 1`,
      );
    } catch (err) {
      console.log(`${label}: could not read (${(err as Error).message.slice(0, 50)})`);
      continue;
    }
    const key = rows[0] ? keyFrom(rows[0].u, rows[0].k) : null;
    if (!key) {
      console.log(`${label}: no sample row`);
      continue;
    }

    const stored = rows[0].u ?? "";
    // Two candidate URLs for the same file:
    //   rebuilt  the key from the database, re-encoded a path segment at a
    //            time — what mediaBackfill has been asking for
    //   asStored the fileUrl column verbatim, which is the exact string the
    //            Manus UI puts in its own links
    // They are the same string for a key like avatars/9f3c21.jpg and NOT the
    // same for "library/Angels We Have Heard On High - Bass.mp3", which is
    // the shape the refusals all have.
    const rebuilt = `${HOST}/manus-storage/${key.split("/").map(encodeURIComponent).join("/")}`;
    const asStored = `${HOST}${stored.startsWith("/") ? stored : `/${stored}`}`;

    console.log(`${label}  key starts "${key.split("/")[0]}/"`);
    console.log(`   the two URLs are ${rebuilt === asStored ? "IDENTICAL" : "DIFFERENT"}`);

    for (const [which, url] of [["rebuilt ", rebuilt], ["asStored", asStored]] as const) {
      if (which === "asStored" && rebuilt === asStored) continue;
      try {
        // Ask Manus but do not follow: the Location it hands back is the
        // whole question, and a signed URL carries its signature in the query.
        const first = await fetch(url, {
          method: "GET",
          redirect: "manual",
          headers: COOKIE ? { cookie: COOKIE } : {},
          signal: AbortSignal.timeout(30_000),
        });
        const location = first.headers.get("location");
        console.log(
          `   ${which} manus → ${first.status}` +
            (location ? `, redirects to ${describe(location)}` : ", no redirect"),
        );
        if (!location) {
          console.log(`            content-type ${first.headers.get("content-type") ?? "none"}`);
          continue;
        }

        // The CDN, with no Manus cookie — a browser would not send one to a
        // different host either.
        const second = await fetch(location, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(60_000),
        });
        const len = second.headers.get("content-length");
        console.log(
          `   ${which} cdn   → ${second.status} ${second.headers.get("content-type") ?? "no type"}` +
            (len ? `, ${len} bytes` : ""),
        );
        if (!second.ok) {
          const body = (await second.text()).replace(/\s+/g, " ").trim().slice(0, 120);
          console.log(`            ${body}`);
        }
      } catch (err) {
        console.log(`   ${which} failed: ${(err as Error).message.slice(0, 80)}`);
      }
    }
    console.log("");
  }

  console.log(
    "Reading this:\n" +
      "  Download works in the Manus UI, so the files ARE there and the\n" +
      "  signature IS valid. Then the only thing left that can differ is the\n" +
      "  URL itself. If `asStored` succeeds where `rebuilt` gets 403, the key\n" +
      "  was being re-encoded into a key that does not exist, and S3 said\n" +
      "  AccessDenied because it cannot admit to a missing object.",
  );

  await conn.end();
}

main().catch((err) => {
  console.error("\nStorage probe FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
