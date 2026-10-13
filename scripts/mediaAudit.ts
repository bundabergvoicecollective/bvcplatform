/**
 * Read-only: do the files behind library items, gallery posts and event
 * images actually live in OUR bucket?
 *
 * Every one of those rows carries both a key and a URL. The 29 September
 * import copied rows; whether it copied the objects they point at is a
 * separate question, and the answer decides what a second migration has to do.
 * A row whose URL points at the Manus host works only while that site is up
 * and dies with it; a row pointing at /r2-storage/<key> works only if the
 * object is in our bucket under that key.
 *
 * Shapes and hosts only — no file names, no captions, no member data. GitHub
 * Actions logs on a public repository are readable by anyone.
 *
 * Usage: DATABASE_URL=... tsx scripts/mediaAudit.ts
 */
import mysql from "mysql2/promise";

/** table → the column holding the URL, and the one holding the storage key */
const MEDIA: [table: string, urlColumn: string, keyColumn: string | null, label: string][] = [
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
  if (url.startsWith("/")) return "(relative path)";
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m ? m[1] : "(not a url)";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const conn = await mysql.createConnection(url);
  const query = async <T>(sql: string): Promise<T> => (await conn.query(sql))[0] as T;

  const [server] = await query<{ db: string }[]>("SELECT DATABASE() AS db");
  console.log(`Connected to \`${server.db}\`\n`);
  console.log("Where the files behind each table are pointed:\n");

  for (const [table, urlCol, keyCol, label] of MEDIA) {
    let rows: { u: string | null; k: string | null }[];
    try {
      rows = await query<{ u: string | null; k: string | null }[]>(
        `SELECT \`${urlCol}\` AS u, ${keyCol ? `\`${keyCol}\`` : "NULL"} AS k FROM \`${table}\``,
      );
    } catch (err) {
      console.log(`  ${label.padEnd(24)} — could not read (${(err as Error).message.slice(0, 60)})`);
      continue;
    }

    if (!rows.length) {
      console.log(`  ${label.padEnd(24)} 0 rows`);
      continue;
    }

    const byHost = new Map<string, number>();
    let noKey = 0;
    for (const r of rows) {
      byHost.set(hostOf(r.u ?? ""), (byHost.get(hostOf(r.u ?? "")) ?? 0) + 1);
      if (keyCol && !r.k) noKey++;
    }
    const hosts = [...byHost.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([h, n]) => `${n}× ${h}`)
      .join(", ");
    console.log(`  ${label.padEnd(24)} ${String(rows.length).padStart(4)} rows — ${hosts}`);
    if (noKey) console.log(`  ${"".padEnd(24)}      ${noKey} with no storage key at all`);
  }

  console.log(
    "\nReading this:\n" +
      "  (relative path)   — served from OUR bucket through /r2-storage. Works only\n" +
      "                      if the object is actually there under that key.\n" +
      "  a manus host      — still served by the OLD site. Works today, dies the day\n" +
      "                      that site is switched off. These need the file copying.\n" +
      "  an r2.dev or\n" +
      "  pub-… host        — a public R2 URL; check which account's bucket it is.",
  );

  await conn.end();
}

main().catch((err) => {
  console.error("\nMedia audit FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
