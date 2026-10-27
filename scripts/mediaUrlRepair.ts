/**
 * The URL in the row and the key in the row disagree, and the file is only
 * at one of them.
 *
 * server/storageProxy.ts presigns the key it parses out of the URL — it never
 * reads fileKey. So a row can audit as perfect (mediaAudit.ts asks the bucket
 * about fileKey, and the object is there) while the page built from fileUrl
 * asks for a key that was never written and gets a 404. That is the state all
 * 110 library items and 12 photos were found in on 27 October: the URLs came
 * across from Manus carrying its own hash suffix, the objects were copied in
 * under the unsuffixed key the row stores, and nothing on the site opened.
 *
 * This asks the bucket which of the two keys actually holds the file and
 * repairs the row to agree with the answer:
 *
 *   object at the stored key  → rewrite the URL to /r2-storage/<storedKey>
 *   object at the URL's key   → rewrite the stored key to match the URL
 *   object at both            → leave it; both work
 *   object at neither         → report it, change nothing; the file is gone
 *                               and a backfill, not a rename, is the fix
 *
 * Report-only unless --apply. Only ever writes a URL or a key, never deletes.
 * Keys are paths, not member data, but the log is public, so only counts and
 * a couple of examples are printed.
 *
 * Usage: DATABASE_URL=… R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=…
 *        R2_SECRET_ACCESS_KEY=… R2_BUCKET_NAME=… tsx scripts/mediaUrlRepair.ts [--apply]
 */
import mysql from "mysql2/promise";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

const APPLY = process.argv.includes("--apply");

/** table, the URL column, the key column, what to call it */
const MEDIA: [table: string, urlColumn: string, keyColumn: string, label: string][] = [
  ["library_items", "fileUrl", "fileKey", "library items"],
  ["gallery_posts", "imageUrl", "imageKey", "gallery posts"],
  ["gallery_media", "mediaUrl", "mediaKey", "gallery media"],
  ["events", "imageUrl", "imageKey", "performance images"],
  ["rehearsal_recordings", "fileUrl", "fileKey", "rehearsal recordings"],
  ["documents", "fileUrl", "fileKey", "documents"],
  ["announcements", "attachmentUrl", "attachmentKey", "announcement attachments"],
  ["shop_products", "imageUrl", "imageKey", "shop product images"],
];

/** The key storageProxy.ts will presign for this URL, or null if not ours. */
function keyFromUrl(url: string): string | null {
  const m = /^\/(?:manus-storage|r2-storage)\/(.+)$/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function makeS3() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials are not set — this cannot tell which key holds the file without them.");
  }
  return {
    s3: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket: process.env.R2_BUCKET_NAME ?? "bvc-storage",
  };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set.");
  const r2 = makeS3();
  const conn = await mysql.createConnection(dbUrl);

  console.log(APPLY ? "Repairing rows whose URL and key disagree.\n" : "Report only — nothing will be written. Pass --apply to repair.\n");

  const exists = new Map<string, boolean>();
  async function present(key: string): Promise<boolean> {
    const cached = exists.get(key);
    if (cached !== undefined) return cached;
    let found = false;
    try {
      await r2.s3.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: key }));
      found = true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      const name = (err as { name?: string }).name ?? "";
      if (!(name === "NotFound" || status === 404)) throw err;
    }
    exists.set(key, found);
    return found;
  }

  let repaired = 0;
  let orphaned = 0;

  for (const [table, urlCol, keyCol, label] of MEDIA) {
    const rows = (await conn.query(
      `SELECT id, \`${urlCol}\` AS url, \`${keyCol}\` AS k FROM \`${table}\`
        WHERE \`${urlCol}\` IS NOT NULL AND \`${urlCol}\` <> ''
          AND \`${keyCol}\` IS NOT NULL AND \`${keyCol}\` <> ''`,
    ))[0] as { id: number; url: string; k: string }[];

    const mismatched = rows
      .map((r) => ({ ...r, urlKey: keyFromUrl(r.url) }))
      .filter((r) => r.urlKey !== null && r.urlKey !== r.k);

    if (!rows.length) { console.log(`  ${label.padEnd(26)} no rows with both a URL and a key`); continue; }
    if (!mismatched.length) { console.log(`  ${label.padEnd(26)} ${rows.length} rows, URL and key agree throughout`); continue; }

    let fixedUrl = 0;
    let fixedKey = 0;
    let bothWork = 0;
    let gone = 0;
    const examples: string[] = [];

    for (const row of mismatched) {
      const [atKey, atUrl] = await Promise.all([present(row.k), present(row.urlKey as string)]);

      if (atKey && atUrl) { bothWork++; continue; }

      if (atKey) {
        // The common case: the object was copied in under the row's own key
        // and the URL still carries Manus's suffixed one.
        if (APPLY) {
          await conn.query(`UPDATE \`${table}\` SET \`${urlCol}\` = ? WHERE id = ?`, [`/r2-storage/${row.k}`, row.id]);
        }
        fixedUrl++;
        if (examples.length < 2) examples.push(`#${row.id}: URL → the stored key`);
      } else if (atUrl) {
        // The reverse: uploaded through the site, which stores the key it
        // built rather than the suffixed one storagePut actually wrote to.
        if (APPLY) {
          await conn.query(`UPDATE \`${table}\` SET \`${keyCol}\` = ? WHERE id = ?`, [row.urlKey, row.id]);
        }
        fixedKey++;
        if (examples.length < 2) examples.push(`#${row.id}: key → the URL's key`);
      } else {
        gone++;
        if (examples.length < 2) examples.push(`#${row.id}: the file is at neither key`);
      }
    }

    repaired += fixedUrl + fixedKey;
    orphaned += gone;

    const parts = [
      `${mismatched.length} of ${rows.length} disagree`,
      fixedUrl ? `${fixedUrl} ${APPLY ? "URLs rewritten" : "need the URL rewritten"}` : "",
      fixedKey ? `${fixedKey} ${APPLY ? "keys rewritten" : "need the key rewritten"}` : "",
      bothWork ? `${bothWork} work either way` : "",
      gone ? `${gone} MISSING from the bucket entirely` : "",
    ].filter(Boolean);
    console.log(`  ${label.padEnd(26)} ${parts.join(", ")}`);
    for (const e of examples) console.log(`       ${e}`);
  }

  await conn.end();

  console.log("");
  if (!repaired && !orphaned) {
    console.log("Nothing to repair — every row's URL resolves to the key holding its file.");
  } else if (APPLY) {
    console.log(`${repaired} row(s) repaired.`);
    if (orphaned) console.log(`${orphaned} row(s) point at a file that is in neither place — those need the file, not a rename.`);
  } else {
    console.log(`${repaired} row(s) would be repaired. Re-run with --apply to write them.`);
    if (orphaned) console.log(`${orphaned} row(s) point at a file that is in neither place — a rename cannot fix those.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
