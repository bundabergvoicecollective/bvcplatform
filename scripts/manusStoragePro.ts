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

    console.log(`${label}  key starts "${key.split("/")[0]}/"`);

    const url = `${HOST}/manus-storage/${key.split("/").map(encodeURIComponent).join("/")}`;

    // Step one: ask Manus, but do not follow. The Location it gives is the
    // whole question — a signed URL carries its signature in the query.
    try {
      const first = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: COOKIE ? { cookie: COOKIE } : {},
        signal: AbortSignal.timeout(30_000),
      });
      const location = first.headers.get("location");
      console.log(`   manus  → ${first.status}${location ? `, redirects to ${describe(location)}` : ", no redirect"}`);

      if (!location) {
        console.log(`          content-type ${first.headers.get("content-type") ?? "none"}`);
        continue;
      }

      // Step two: the CDN, with no Manus cookie — it would never receive one
      // from a browser either, the host does not match.
      const second = await fetch(location, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      });
      const len = second.headers.get("content-length");
      console.log(
        `   cdn    → ${second.status} ${second.headers.get("content-type") ?? "no type"}` +
          (len ? `, ${len} bytes` : ""),
      );
      if (!second.ok) {
        const body = (await second.text()).replace(/\s+/g, " ").trim().slice(0, 140);
        console.log(`          ${body}`);
      }
    } catch (err) {
      console.log(`   failed: ${(err as Error).message.slice(0, 80)}`);
    }
    console.log("");
  }

  console.log(
    "Reading this:\n" +
      "  A signed URL has Expires / Signature / Key-Pair-Id (or X-Amz-…) in its\n" +
      "  query. If the refused ones get a BARE url and the working ones do too,\n" +
      "  the difference is the object, not the permission — and AccessDenied is\n" +
      "  S3's way of saying the key is not there.\n" +
      "  If the refused ones get no redirect at all, Manus itself is the gate.",
  );

  await conn.end();
}

main().catch((err) => {
  console.error("\nStorage probe FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
