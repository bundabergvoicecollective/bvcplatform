/**
 * Brings the CONTENT across from Manus: library items, documents,
 * performances and announcements — the rows, and the files behind them.
 *
 * Two different gaps, found on 14 October 2026 and easy to confuse:
 *
 *   1. Rows that were never copied. The 29 September import covered
 *      rehearsals, attendance, orders, passes and members. It did not touch
 *      content, so every content table stops dead on 29 September. Manus
 *      shows 110 library items; this database has 83. Tuesday's upload is
 *      not among them.
 *   2. Files that were never copied. Even the 83 rows we do have point at
 *      objects that are not in our bucket — scripts/mediaBackfill.ts and
 *      docs/media-files.md cover that half.
 *
 * This does both, in that order, because a row with no file is still a
 * broken link.
 *
 * Manus has no export and no API key, but its admin is a tRPC client, so the
 * same query procedures answer a plain GET with a signed-in cookie. Procedure
 * names are TRIED from a list rather than assumed: the Manus copy may be an
 * older build with different names, and one rename should cost a line in the
 * report rather than the whole run.
 *
 * Matching is on fileKey for anything with a file, because that is what an
 * upload makes unique. Performances and announcements have no file, so they
 * match on title plus date. Nothing is ever updated or deleted — a row that
 * matches is left exactly as it is, so running this twice is harmless.
 *
 * Reports by default. Writes only with --apply.
 *
 * Usage:
 *   DATABASE_URL=... MANUS_HOST=... MANUS_COOKIE=... R2_*=... \
 *     tsx scripts/manusContentSync.ts [--apply] [--only=library]
 */
import mysql from "mysql2/promise";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);

const HOST = (process.env.MANUS_HOST ?? "").replace(/\/+$/, "");
const COOKIE = process.env.MANUS_COOKIE ?? "";

/** MySQL timestamp columns want 'YYYY-MM-DD HH:MM:SS' in UTC, not an ISO string. */
function toSql(value: unknown): string {
  const d = value ? new Date(value as string) : new Date();
  return (isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 19).replace("T", " ");
}

/** A key is a file path and this log is public, so only its shape is printed. */
function shape(key: string): string {
  const slash = key.lastIndexOf("/");
  const dot = key.lastIndexOf(".");
  return `${key.slice(0, slash + 1)}…${dot > slash ? key.slice(dot) : ""}`;
}

type Row = Record<string, unknown>;

/** One tRPC query against Manus, with the admin's cookie. */
async function call(proc: string): Promise<unknown> {
  const input = encodeURIComponent(JSON.stringify({ json: null }));
  const res = await fetch(`${HOST}/api/trpc/${proc}?input=${input}`, {
    headers: COOKIE ? { cookie: COOKIE, accept: "application/json" } : { accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  if ((body as { error?: unknown }).error) throw new Error("tRPC error");
  const result = (body as { result?: { data?: unknown } }).result?.data;
  return (result as { json?: unknown })?.json ?? result ?? body;
}

/** Try each candidate until one answers with a list. */
async function firstList(candidates: string[]): Promise<{ proc: string | null; rows: Row[]; tried: string[] }> {
  const tried: string[] = [];
  for (const proc of candidates) {
    try {
      const data = await call(proc);
      if (Array.isArray(data)) return { proc, rows: data as Row[], tried };
      // Some procedures wrap the list, e.g. { items: [...] }.
      if (data && typeof data === "object") {
        const inner = Object.values(data).find((v) => Array.isArray(v));
        if (inner) return { proc, rows: inner as Row[], tried };
      }
      tried.push(`${proc}: not a list`);
    } catch (err) {
      tried.push(`${proc}: ${(err as Error).message}`);
    }
  }
  return { proc: null, rows: [], tried };
}

/** The first value present under any of these names. */
const pick = (row: Row, ...names: string[]): unknown => {
  for (const n of names) if (row[n] !== undefined && row[n] !== null && row[n] !== "") return row[n];
  return null;
};
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Library and documents use the same enum-free shape; events and announcements do not. */
const LIBRARY_TYPES = new Set(["sheet_music", "backing_track", "lyrics", "chord_chart"]);

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set.");
  if (!HOST) throw new Error("MANUS_HOST is not set — there is nowhere to read from.");
  if (!COOKIE) throw new Error("MANUS_COOKIE is not set. Manus will not hand over content without a signed-in session.");

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME ?? "bvc-storage";
  const s3 =
    accountId && accessKeyId && secretAccessKey
      ? new S3Client({
          region: "auto",
          endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId, secretAccessKey },
        })
      : null;
  if (!s3) console.log("No R2 credentials — rows can be imported but no file will be copied.\n");

  const conn = await mysql.createConnection(dbUrl);
  const query = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
    (await conn.query(sql, params))[0] as T;

  console.log(APPLY ? "APPLYING — rows will be inserted and files copied.\n" : "Dry run. Nothing will be written.\n");

  // Whoever is recorded as having uploaded an imported row. The lowest-id
  // admin, the same convention importManusDelta.ts uses.
  const [admin] = await query<{ id: number }[]>(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1",
  );
  if (!admin) throw new Error("No admin user to attribute imported rows to.");

  /** Fetch a file from Manus and put it in our bucket under the same key. */
  async function copyFile(key: string): Promise<"copied" | "present" | "refused" | "failed"> {
    if (!s3) return "failed";
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return "present";
    } catch {
      /* not there yet — fetch it */
    }
    try {
      const url = `${HOST}/manus-storage/${key.split("/").map(encodeURIComponent).join("/")}`;
      const res = await fetch(url, {
        headers: COOKIE ? { cookie: COOKIE } : {},
        redirect: "follow",
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 401 || res.status === 403) return "refused";
      if (!res.ok) return "failed";
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      if (contentType.includes("text/html")) return "refused";
      const body = Buffer.from(await res.arrayBuffer());
      if (!body.length) return "failed";
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
      return "copied";
    } catch {
      return "failed";
    }
  }

  let grandNewRows = 0;
  let grandCopied = 0;
  let grandRefused = 0;
  let grandFailed = 0;

  /** Everything a section needs: where to read it, how to identify it, how to write it. */
  type Section = {
    name: string;
    label: string;
    candidates: string[];
    /** The stable identity of a Manus row, and of one of ours. */
    identify: (row: Row) => string | null;
    existing: () => Promise<Set<string>>;
    /** The storage key behind the row, if it has one. */
    fileKey: (row: Row) => string | null;
    insert: (row: Row) => Promise<void>;
  };

  const sections: Section[] = [
    {
      name: "library",
      label: "library items",
      candidates: ["library.list", "library.all", "libraryItems.list", "library.getAll"],
      identify: (r) => str(pick(r, "fileKey", "key")),
      existing: async () => {
        const rows = await query<{ fileKey: string }[]>("SELECT fileKey FROM library_items");
        return new Set(rows.map((r) => r.fileKey));
      },
      fileKey: (r) => str(pick(r, "fileKey", "key")),
      insert: async (r) => {
        const key = str(pick(r, "fileKey", "key"))!;
        const rawType = String(pick(r, "type", "itemType") ?? "sheet_music");
        const type = LIBRARY_TYPES.has(rawType) ? rawType : "sheet_music";
        await query(
          `INSERT INTO library_items
             (title, artist, type, fileKey, fileUrl, fileName, mimeType, uploadedBy, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            str(pick(r, "title", "name")) ?? "Untitled",
            str(pick(r, "artist", "composer")),
            type,
            key,
            str(pick(r, "fileUrl", "url")) ?? `/manus-storage/${key}`,
            str(pick(r, "fileName", "filename")) ?? key.split("/").pop() ?? "file",
            str(pick(r, "mimeType", "contentType")),
            admin.id,
            toSql(pick(r, "createdAt", "uploadedAt")),
          ],
        );
      },
    },
    {
      name: "documents",
      label: "documents",
      candidates: ["documents.list", "documents.all", "documents.getAll"],
      identify: (r) => str(pick(r, "fileKey", "key")),
      existing: async () => {
        const rows = await query<{ fileKey: string }[]>("SELECT fileKey FROM documents");
        return new Set(rows.map((r) => r.fileKey));
      },
      fileKey: (r) => str(pick(r, "fileKey", "key")),
      insert: async (r) => {
        const key = str(pick(r, "fileKey", "key"))!;
        await query(
          `INSERT INTO documents
             (title, description, fileName, fileKey, fileUrl, mimeType, fileSizeBytes, uploadedBy, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            str(pick(r, "title", "name")) ?? "Untitled",
            str(pick(r, "description")),
            str(pick(r, "fileName", "filename")) ?? key.split("/").pop() ?? "file",
            key,
            str(pick(r, "fileUrl", "url")) ?? `/manus-storage/${key}`,
            str(pick(r, "mimeType", "contentType")) ?? "application/octet-stream",
            Number(pick(r, "fileSizeBytes", "size")) || null,
            admin.id,
            toSql(pick(r, "createdAt")),
          ],
        );
      },
    },
    {
      name: "events",
      label: "performances",
      candidates: ["events.list", "events.all", "calendar.events", "events.getAll"],
      // No file, so identity is the thing itself: what it is called and when.
      identify: (r) => `${str(pick(r, "title", "name")) ?? ""}|${toSql(pick(r, "eventDate", "date")).slice(0, 10)}`,
      existing: async () => {
        const rows = await query<{ title: string; d: string }[]>(
          "SELECT title, DATE_FORMAT(eventDate, '%Y-%m-%d') AS d FROM events",
        );
        return new Set(rows.map((r) => `${r.title}|${r.d}`));
      },
      fileKey: (r) => str(pick(r, "imageKey")),
      insert: async (r) => {
        const cat = String(pick(r, "category") ?? "other");
        await query(
          `INSERT INTO events
             (title, description, location, eventDate, endDate, category, createdBy, imageUrl, imageKey, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            str(pick(r, "title", "name")) ?? "Untitled",
            str(pick(r, "description")),
            str(pick(r, "location", "venue")),
            toSql(pick(r, "eventDate", "date")),
            pick(r, "endDate") ? toSql(pick(r, "endDate")) : null,
            ["concert", "rehearsal", "social", "workshop", "other"].includes(cat) ? cat : "other",
            admin.id,
            str(pick(r, "imageUrl")),
            str(pick(r, "imageKey")),
            toSql(pick(r, "createdAt")),
          ],
        );
      },
    },
    {
      name: "announcements",
      label: "announcements",
      candidates: ["announcements.list", "announcements.all", "announcements.getAll"],
      identify: (r) => `${str(pick(r, "title")) ?? ""}|${toSql(pick(r, "createdAt")).slice(0, 10)}`,
      existing: async () => {
        const rows = await query<{ title: string; d: string }[]>(
          "SELECT title, DATE_FORMAT(createdAt, '%Y-%m-%d') AS d FROM announcements",
        );
        return new Set(rows.map((r) => `${r.title}|${r.d}`));
      },
      fileKey: (r) => str(pick(r, "attachmentKey")),
      insert: async (r) => {
        const cat = String(pick(r, "category") ?? "general");
        await query(
          `INSERT INTO announcements
             (title, body, category, authorId, pinned, attachmentUrl, attachmentKey, attachmentType, attachmentName, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            str(pick(r, "title")) ?? "Untitled",
            str(pick(r, "body", "content", "message")) ?? "",
            ["event", "rehearsal", "general"].includes(cat) ? cat : "general",
            admin.id,
            pick(r, "pinned") ? 1 : 0,
            str(pick(r, "attachmentUrl")),
            str(pick(r, "attachmentKey")),
            str(pick(r, "attachmentType")),
            str(pick(r, "attachmentName")),
            toSql(pick(r, "createdAt")),
          ],
        );
      },
    },
  ];

  for (const section of sections) {
    if (ONLY && ONLY !== section.name) continue;

    const { proc, rows, tried } = await firstList(section.candidates);
    if (!proc) {
      console.log(`${section.label}: could not read from Manus`);
      for (const t of tried) console.log(`    ${t}`);
      continue;
    }

    const have = await section.existing();
    const seen = new Set<string>();
    const missing: Row[] = [];
    let unidentifiable = 0;

    for (const r of rows) {
      const id = section.identify(r);
      if (!id || id === "|") {
        unidentifiable++;
        continue;
      }
      // Manus can hold two rows that look identical to us; import one.
      if (seen.has(id)) continue;
      seen.add(id);
      if (!have.has(id)) missing.push(r);
    }

    console.log(
      `${section.label}: Manus has ${rows.length} (via ${proc}), we have ${have.size}, ${missing.length} to add` +
        (unidentifiable ? `, ${unidentifiable} with nothing to match on` : ""),
    );

    if (!APPLY) {
      // The shape of the first missing row is what says whether the field
      // names were guessed right, and it is the only thing that can be
      // checked before writing.
      if (missing.length) {
        console.log(`    fields Manus returns: ${Object.keys(missing[0]).sort().join(", ")}`);
        console.log(`    first to add: ${str(pick(missing[0], "title", "name")) ?? "(no title)"}`);
      }
      continue;
    }

    let inserted = 0;
    let failedRows = 0;
    for (const r of missing) {
      try {
        await section.insert(r);
        inserted++;
      } catch (err) {
        failedRows++;
        if (failedRows <= 3) console.log(`    could not insert: ${(err as Error).message.slice(0, 80)}`);
      }
    }
    grandNewRows += inserted;
    console.log(`    ${inserted} row(s) added` + (failedRows ? `, ${failedRows} failed` : ""));

    // Now the files — for every row of ours, new or not, since the 83 that
    // were already here are missing their files too.
    if (!s3) continue;
    const keys = [...new Set(rows.map((r) => section.fileKey(r)).filter((k): k is string => !!k))];
    let copied = 0;
    let refused = 0;
    let failedFiles = 0;
    let firstRefused: string | null = null;
    for (const key of keys) {
      const outcome = await copyFile(key);
      if (outcome === "copied") copied++;
      else if (outcome === "refused") {
        refused++;
        if (!firstRefused) firstRefused = shape(key);
      } else if (outcome === "failed") failedFiles++;
    }
    grandCopied += copied;
    grandRefused += refused;
    grandFailed += failedFiles;
    console.log(
      `    files: ${copied} copied, ${keys.length - copied - refused - failedFiles} already there` +
        (refused ? `, ${refused} refused by Manus` : "") +
        (failedFiles ? `, ${failedFiles} failed` : ""),
    );
    if (firstRefused) console.log(`    refused keys look like: ${firstRefused}`);
  }

  console.log("");
  if (APPLY) {
    console.log(`${grandNewRows} row(s) added, ${grandCopied} file(s) copied.`);
    if (grandRefused) {
      console.log(
        `${grandRefused} file(s) were refused even with the cookie — it may have expired.\n` +
          "Take a fresh one from a request in DevTools → Network and run this again.",
      );
    }
    if (grandFailed) console.log(`${grandFailed} file(s) failed for another reason.`);
  } else {
    console.log("Nothing was written. Check the field names above, then run with `apply` ticked.");
  }

  await conn.end();
}

main().catch((err) => {
  console.error("\nManus content sync FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
