/**
 * Read-only: do the files behind avatars, library items, gallery posts and
 * event images actually live in OUR bucket?
 *
 * Every one of those rows carries a URL, and most carry a storage key. The
 * 29 September import copied rows; whether it copied the objects they point
 * at is a separate question, and the answer decides what a second migration
 * has to do. A row whose URL points at the Manus host works only while that
 * site is up and dies with it. A row pointing at /manus-storage/<key> or
 * /r2-storage/<key> is served by us — server/storageProxy.ts redirects the
 * first to the second and presigns it against our bucket — and works only if
 * the object is actually in there under that key.
 *
 * With R2 credentials in the environment this asks the bucket directly,
 * which is the only way to tell a working path from a broken one: both look
 * identical in the database.
 *
 * Shapes, hosts and counts only — no file names, no captions, no member data.
 * GitHub Actions logs on a public repository are readable by anyone.
 *
 * Usage: DATABASE_URL=... [R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=...
 *        R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=...] tsx scripts/mediaAudit.ts
 */
import mysql from "mysql2/promise";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** table → the column holding the URL, and the one holding the storage key */
const MEDIA: [table: string, urlColumn: string, keyColumn: string | null, label: string][] = [
  ["users", "avatarUrl", null, "member avatars"],
  ["library_items", "fileUrl", "fileKey", "library items"],
  ["gallery_posts", "imageUrl", "imageKey", "gallery posts"],
  ["gallery_media", "mediaUrl", "mediaKey", "gallery media"],
  ["events", "imageUrl", "imageKey", "performances (images)"],
  ["rehearsal_recordings", "fileUrl", "fileKey", "rehearsal recordings"],
  ["documents", "fileUrl", "fileKey", "documents"],
];

/** Everything before the first single slash, so a host can be seen at a glance. */
function hostOf(url: string): string {
  if (!url) return "(empty)";
  if (url.startsWith("/")) {
    const m = /^\/([^/]+)\//.exec(url);
    return m ? `/${m[1]}/…` : "(relative path)";
  }
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m ? m[1] : "(not a url)";
}

/**
 * The bucket key a URL resolves to, or null if the URL is not ours to serve.
 * /manus-storage/<key> and /r2-storage/<key> both end up presigned against
 * our bucket under <key> — the first via a 301 in storageProxy.ts.
 */
function keyFromUrl(url: string | null, storedKey: string | null): string | null {
  if (storedKey) return storedKey;
  if (!url) return null;
  const m = /^\/(?:manus-storage|r2-storage)\/(.+)$/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

function makeS3(): { s3: S3Client; bucket: string } | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return {
    s3: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket: process.env.R2_BUCKET_NAME ?? "bvc-storage",
  };
}

/** HEAD every key, a few at a time, and count what came back. */
async function countPresent(
  r2: { s3: S3Client; bucket: string },
  keys: string[],
): Promise<{ present: number; missing: number; errored: number; firstMissing: string | null }> {
  let present = 0;
  let missing = 0;
  let errored = 0;
  let firstMissing: string | null = null;

  const queue = [...keys];
  const worker = async () => {
    for (;;) {
      const key = queue.shift();
      if (key === undefined) return;
      try {
        await r2.s3.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: key }));
        present++;
      } catch (err) {
        const name = (err as { name?: string }).name ?? "";
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (name === "NotFound" || status === 404) {
          missing++;
          // The first missing key is worth seeing: it says whether the whole
          // prefix is absent or only some files. A key is a path, not member
          // data, but only one is printed and only its shape matters.
          if (!firstMissing) firstMissing = key.replace(/[^/]+$/, "…");
        } else {
          errored++;
          if (errored === 1) console.log(`       (lookup error: ${name || String(err).slice(0, 60)})`);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  return { present, missing, errored, firstMissing };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const conn = await mysql.createConnection(url);
  const query = async <T>(sql: string): Promise<T> => (await conn.query(sql))[0] as T;

  const [server] = await query<{ db: string }[]>("SELECT DATABASE() AS db");
  console.log(`Connected to \`${server.db}\``);

  const r2 = makeS3();
  console.log(
    r2
      ? `Bucket \`${r2.bucket}\` will be asked whether each file is really there.\n`
      : "No R2 credentials in the environment — reporting where rows POINT only,\nnot whether the files exist.\n",
  );

  for (const [table, urlCol, keyCol, label] of MEDIA) {
    let rows: { u: string | null; k: string | null }[];
    try {
      rows = await query<{ u: string | null; k: string | null }[]>(
        `SELECT \`${urlCol}\` AS u, ${keyCol ? `\`${keyCol}\`` : "NULL"} AS k FROM \`${table}\`
          WHERE \`${urlCol}\` IS NOT NULL AND \`${urlCol}\` <> ''`,
      );
    } catch (err) {
      console.log(`  ${label.padEnd(24)} — could not read (${(err as Error).message.slice(0, 60)})`);
      continue;
    }

    if (!rows.length) {
      console.log(`  ${label.padEnd(24)} 0 rows with a file`);
      continue;
    }

    const byHost = new Map<string, number>();
    let noKey = 0;
    for (const r of rows) {
      const h = hostOf(r.u ?? "");
      byHost.set(h, (byHost.get(h) ?? 0) + 1);
      if (keyCol && !r.k) noKey++;
    }
    const hosts = [...byHost.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([h, n]) => `${n}× ${h}`)
      .join(", ");
    console.log(`  ${label.padEnd(24)} ${String(rows.length).padStart(4)} rows — ${hosts}`);
    if (noKey) console.log(`  ${"".padEnd(24)}      ${noKey} with no storage key at all`);

    if (r2) {
      const keys = [...new Set(rows.map((r) => keyFromUrl(r.u, r.k)).filter((k): k is string => !!k))];
      if (!keys.length) {
        console.log(`  ${"".padEnd(24)}      nothing here resolves to a key in our bucket`);
        continue;
      }
      const { present, missing, errored, firstMissing } = await countPresent(r2, keys);
      const verdict = missing === 0 ? "all there" : present === 0 ? "NONE of them are there" : "partly there";
      console.log(
        `  ${"".padEnd(24)}      ${keys.length} distinct key(s): ${present} present, ${missing} MISSING` +
          (errored ? `, ${errored} could not be checked` : "") +
          ` — ${verdict}`,
      );
      if (firstMissing) console.log(`  ${"".padEnd(24)}      missing keys look like: ${firstMissing}`);
    }
  }

  console.log(
    "\nReading this:\n" +
      "  /manus-storage/… or\n" +
      "  /r2-storage/…    — served by US. storageProxy.ts presigns the key against\n" +
      "                     our bucket, so the row works only if the object is in\n" +
      "                     there. MISSING means a broken image on the live site.\n" +
      "  a manus host     — still served by the OLD site. Works today, dies the day\n" +
      "                     that site is switched off. These need the file copying.\n" +
      "  an r2.dev or\n" +
      "  pub-… host       — a public R2 URL; check which account's bucket it is.",
  );

  await conn.end();
}

main().catch((err) => {
  console.error("\nMedia audit FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
